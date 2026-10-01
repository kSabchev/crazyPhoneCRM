// SMS notifications through the shop phone, against a fake gateway.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { startFakeGateway } = require('./fake-sms-gateway');
const sms = require('../sms');

const { app, db } = loadApp();
let gw, agent;

test.before(async () => {
  gw = await startFakeGateway();
  process.env.SMS_GATEWAY_URL = gw.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';
  agent = await login(request.agent(app));
});
test.after(() => gw.close());

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}
// Sends are throttled per order for 30 s; tests reuse orders, so clear it.
const clearGuard = () => db.exec("UPDATE sms_messages SET created_at = datetime('now', '-1 hour')");

test('phone numbers are converted to +359 form; anything else is rejected', () => {
  assert.equal(sms.toInternationalBg('0888 123 456'), '+359888123456');
  assert.equal(sms.toInternationalBg('+359 88 812 3456'), '+359888123456');
  assert.equal(sms.toInternationalBg('0888-123-456'), '+359888123456');
  assert.equal(sms.toInternationalBg('0888 123 45'), null);
  assert.equal(sms.toInternationalBg('+49 30 1234567'), null);
});

test('the SMS part counter knows Cyrillic fits 70 characters per SMS', () => {
  assert.equal(sms.smsParts('а'.repeat(70)), 1);
  assert.equal(sms.smsParts('а'.repeat(71)), 2);
  assert.equal(sms.smsParts('а'.repeat(134)), 2);
  assert.equal(sms.smsParts('а'.repeat(135)), 3);
  assert.equal(sms.smsParts('a'.repeat(160)), 1);
  assert.equal(sms.smsParts('a'.repeat(161)), 2);
});

test('the default text fits in a single SMS, even with 5-digit order numbers', () => {
  const text = sms.renderTemplate(require('../default-settings').smsTemplate, { ticket_no: 12345 }, 'CrazyPhone');
  assert.equal(text, 'Здравейте! Телефонът Ви по поръчка №12345 е готов. CrazyPhone');
  assert.equal(sms.smsParts(text), 1);
});

test('the template fills in all placeholders', () => {
  const text = sms.renderTemplate('{клиент}, {модел} №{номер} — {магазин} {друго}',
    { ticket_no: 7, customer_name: 'Мария', phone_model: 'iPhone 13' }, 'CrazyPhone');
  assert.equal(text, 'Мария, iPhone 13 №7 — CrazyPhone {друго}');
});

test('the preview shows the number and the text from the template', async () => {
  const t = await create({ phoneContact: '0888 123 456' });
  const p = (await agent.get(`/api/tickets/${t.id}/sms/preview`).expect(200)).body;
  assert.equal(p.enabled, true);
  assert.equal(p.phone, '+359888123456');
  assert.match(p.text, new RegExp(`№${t.ticket_no} е готов`));
});

test('sending passes the text to the phone and records it', async () => {
  const t = await create({ phoneContact: '0888 123 456' });
  const res = await agent.post(`/api/tickets/${t.id}/sms`).send({ text: 'Готово е!' }).expect(201);
  assert.equal(res.body.state, 'Pending');
  assert.equal(res.body.phone, '+359888123456');
  assert.equal(res.body.sent_by, 'tester');

  const last = gw.sent[gw.sent.length - 1];
  assert.deepEqual(last.phoneNumbers, ['+359888123456']);
  assert.equal(last.text, 'Готово е!');
  assert.equal(last.withDeliveryReport, true);

  const list = (await agent.get(`/api/tickets/${t.id}/sms`).expect(200)).body;
  assert.equal(list.length, 1);
  const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
  assert.deepEqual(history[0].changes, { phone: '+359888123456', ok: true });
  assert.equal(history[0].action, 'sms');
});

test('without a text it sends the template', async () => {
  const t = await create();
  await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201);
  assert.match(gw.sent[gw.sent.length - 1].text, new RegExp(`№${t.ticket_no} е готов. `));
});

test('a second send for the same order within 30 seconds is refused', async () => {
  const t = await create();
  await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201);
  const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(409);
  assert.match(res.body.error, /току-що/);
  clearGuard();
  await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201);
});

test('a nonstandard number, empty or overlong text are rejected without sending', async () => {
  const before = gw.sent.length;
  const bad = await create({ phoneContact: '0888 12' });
  const res = await agent.post(`/api/tickets/${bad.id}/sms`).send({}).expect(400);
  assert.match(res.body.error, /не е валиден/);
  const ok = await create();
  await agent.post(`/api/tickets/${ok.id}/sms`).send({ text: '   ' }).expect(400);
  await agent.post(`/api/tickets/${ok.id}/sms`).send({ text: 'я'.repeat(601) }).expect(400);
  assert.equal(gw.sent.length, before);
});

test('a gateway error is shown to staff and recorded as Failed', async () => {
  const t = await create();
  gw.mode = 'error';
  try {
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, /грешка \(500\)/);
    assert.equal(res.body.sms.state, 'Failed');
  } finally {
    gw.mode = 'ok';
  }
  const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
  assert.deepEqual(history[0].changes.ok, false);
});

test('wrong gateway credentials and an unreachable phone give clear messages', async () => {
  const t = await create();
  process.env.SMS_GATEWAY_PASSWORD = 'wrong';
  try {
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, /Грешно потребителско име или парола/);
  } finally {
    process.env.SMS_GATEWAY_PASSWORD = 'secret';
  }

  clearGuard();
  process.env.SMS_GATEWAY_URL = 'http://127.0.0.1:1';
  try {
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, /не отговаря/);
  } finally {
    process.env.SMS_GATEWAY_URL = gw.url;
  }
});

test('the status check picks up Sent, Delivered and Failed from the phone', async () => {
  const t = await create();
  const sent = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;

  gw.states.set(sent.gateway_id, { state: 'Delivered' });
  assert.ok(await app.pollSmsStates() >= 1);
  let row = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(sent.id);
  assert.equal(row.state, 'Delivered');

  // Delivered is final: not asked about again.
  gw.states.set(sent.gateway_id, { state: 'Failed', error: 'x' });
  await app.pollSmsStates();
  row = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(sent.id);
  assert.equal(row.state, 'Delivered');

  clearGuard();
  const second = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  gw.states.set(second.gateway_id, { state: 'Failed', error: 'Invalid number' });
  await app.pollSmsStates();
  row = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(second.id);
  assert.equal(row.state, 'Failed');
  assert.equal(row.error, 'Invalid number');
});

test('SMS is off without a gateway and always off in demo mode', async () => {
  const t = await create();
  const saved = process.env.SMS_GATEWAY_URL;
  try {
    delete process.env.SMS_GATEWAY_URL;
    assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: false });
    await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(503);

    process.env.SMS_GATEWAY_URL = saved;
    process.env.DEMO_MODE = 'true';
    assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: false });
  } finally {
    process.env.SMS_GATEWAY_URL = saved;
    delete process.env.DEMO_MODE;
  }
  assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true });
});

test('the SMS text is a setting with a default, and can be changed', async () => {
  const s = (await agent.get('/api/settings')).body;
  assert.equal(s.smsTemplate, require('../default-settings').smsTemplate);
  const saved = (await agent.put('/api/settings').send({ smsTemplate: '  Готово: №{номер}  ' }).expect(200)).body;
  assert.equal(saved.smsTemplate, 'Готово: №{номер}');
  await agent.put('/api/settings').send({ smsTemplate: '  ' }).expect(400);
  await agent.put('/api/settings').send({ smsTemplate: 'я'.repeat(601) }).expect(400);
});

test('SMS routes need a login', async () => {
  await request(app).get('/api/sms/config').expect(401);
  await request(app).post('/api/tickets/1/sms').send({}).expect(401);
  await request(app).get('/api/tickets/1/sms').expect(401);
  await request(app).get('/api/tickets/1/sms/preview').expect(401);
});
