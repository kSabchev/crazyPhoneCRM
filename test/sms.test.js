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

test('SMS is off without a gateway; demo mode simulates it instead of using the phone', async () => {
  const t = await create();
  const saved = process.env.SMS_GATEWAY_URL;
  try {
    delete process.env.SMS_GATEWAY_URL;
    assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: false, provider: null });
    await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(503);

    process.env.SMS_GATEWAY_URL = saved;
    process.env.DEMO_MODE = 'true';
    assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true, provider: 'demo' });
  } finally {
    process.env.SMS_GATEWAY_URL = saved;
    delete process.env.DEMO_MODE;
  }
  assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true, provider: 'phone' });
});

test('the SMS text is a setting with a default, and can be changed', async () => {
  const s = (await agent.get('/api/settings')).body;
  assert.equal(s.smsTemplate, require('../default-settings').smsTemplate);
  const saved = (await agent.put('/api/settings').send({ smsTemplate: '  Готово: №{номер}  ' }).expect(200)).body;
  assert.equal(saved.smsTemplate, 'Готово: №{номер}');
  await agent.put('/api/settings').send({ smsTemplate: '  ' }).expect(400);
  await agent.put('/api/settings').send({ smsTemplate: 'я'.repeat(601) }).expect(400);
});

// ---- Phone status ----
const setHealth = h => { gw.health = { mode: 'ok', status: 200, body: gw.health.body, ...h }; };
const status = async () => (await agent.get('/api/sms/status?fresh=1').expect(200)).body;

test('a healthy phone shows as ready, with battery, charging and network', async () => {
  const s = await status();
  assert.equal(s.state, 'ready');
  assert.equal(s.details.battery, 87);
  assert.equal(s.details.charging, 2);
  assert.equal(s.details.network, 'WiFi');
  assert.equal(s.details.failedLastHour, 0);
  assert.deepEqual(s.details.problems, []);
  assert.ok(s.checkedAt);
});

test('a phone reporting low battery is shown as a warning with the reason', async () => {
  const body = JSON.parse(JSON.stringify(gw.health.body));
  body.status = 'fail';
  body.checks['battery:level'] = { observedValue: 8, status: 'fail' };
  setHealth({ status: 503, body });
  try {
    const s = await status();
    assert.equal(s.state, 'warning');
    assert.deepEqual(s.details.problems, ['ниска батерия']);
    assert.equal(s.details.battery, 8);
  } finally {
    body.status = 'pass';
    body.checks['battery:level'] = { observedValue: 87, status: 'pass' };
    setHealth({ status: 200, body });
  }
});

test('an unreachable phone shows as offline; wrong credentials as auth', async () => {
  setHealth({ mode: 'down' });
  try {
    assert.equal((await status()).state, 'offline');
  } finally {
    setHealth({ mode: 'ok' });
  }
  process.env.SMS_GATEWAY_PASSWORD = 'wrong';
  try {
    assert.equal((await status()).state, 'auth');
  } finally {
    process.env.SMS_GATEWAY_PASSWORD = 'secret';
  }
  assert.equal((await status()).state, 'ready');
});

test('the status is cached for 30 seconds unless a fresh check is asked for', async () => {
  assert.equal((await status()).state, 'ready');
  setHealth({ mode: 'down' });
  try {
    assert.equal((await agent.get('/api/sms/status').expect(200)).body.state, 'ready'); // cached
    assert.equal((await status()).state, 'offline'); // fresh
  } finally {
    setHealth({ mode: 'ok' });
    await status();
  }
});

test('cloud mode and an unconfigured gateway are reported, not guessed', async () => {
  const saved = process.env.SMS_GATEWAY_URL;
  try {
    process.env.SMS_GATEWAY_URL = 'https://api.sms-gate.app/3rdparty/v1';
    assert.equal((await status()).state, 'cloud');
    delete process.env.SMS_GATEWAY_URL;
    assert.equal((await status()).state, 'off');
  } finally {
    process.env.SMS_GATEWAY_URL = saved;
  }
});

// ---- SMS in reports ----
test('reports list the period\'s SMS with counts and SMS parts used', async () => {
  db.exec('DELETE FROM sms_messages');
  const t = await create({ customerName: 'Отчет Клиент' });
  const add = db.prepare(`INSERT INTO sms_messages (ticket_id, ticket_no, phone, text, state, error, sent_by, created_at)
    VALUES (?, ?, '+359888123456', ?, ?, ?, 'tester', ?)`);
  add.run(t.id, t.ticket_no, 'кратко', 'Delivered', null, '2031-03-10 10:00:00');
  add.run(t.id, t.ticket_no, 'я'.repeat(100), 'Sent', null, '2031-03-11 10:00:00');       // 2 parts
  add.run(t.id, t.ticket_no, 'неуспешно', 'Failed', 'Invalid number', '2031-03-12 10:00:00'); // uses none
  add.run(9999, 42, 'към изтрита поръчка', 'Delivered', null, '2031-03-13 10:00:00');
  add.run(t.id, t.ticket_no, 'извън периода', 'Delivered', null, '2031-05-01 10:00:00');

  const r = (await agent.get('/api/reports?from=2031-03-01&to=2031-03-31').expect(200)).body.sms;
  assert.equal(r.total, 4);
  assert.equal(r.parts, 1 + 2 + 1);
  assert.deepEqual(r.byState, { Delivered: 2, Sent: 1, Failed: 1 });
  assert.equal(r.truncated, false);
  assert.deepEqual(r.messages.map(m => m.text), ['към изтрита поръчка', 'неуспешно', 'я'.repeat(100), 'кратко']);
  assert.equal(r.messages[0].customerName, null);
  assert.equal(r.messages[1].error, 'Invalid number');
  assert.equal(r.messages[3].customerName, 'Отчет Клиент');
  assert.equal(r.messages[2].parts, 2);
});

test('the SMS list in reports is capped at the newest 200', async () => {
  db.exec('DELETE FROM sms_messages');
  const add = db.prepare(`INSERT INTO sms_messages (ticket_id, ticket_no, phone, text, state, sent_by, created_at)
    VALUES (1, 1, '+359888123456', ?, 'Delivered', 'tester', '2032-01-15 10:00:00')`);
  for (let i = 1; i <= 205; i++) add.run(`съобщение ${i}`);
  const r = (await agent.get('/api/reports?from=2032-01-01&to=2032-01-31').expect(200)).body.sms;
  assert.equal(r.total, 205);
  assert.equal(r.messages.length, 200);
  assert.equal(r.truncated, true);
  assert.equal(r.messages[0].text, 'съобщение 205');
  db.exec('DELETE FROM sms_messages');
});

test('SMS routes need a login', async () => {
  await request(app).get('/api/sms/status').expect(401);
  await request(app).get('/api/sms/config').expect(401);
  await request(app).post('/api/tickets/1/sms').send({}).expect(401);
  await request(app).get('/api/tickets/1/sms').expect(401);
  await request(app).get('/api/tickets/1/sms/preview').expect(401);
});
