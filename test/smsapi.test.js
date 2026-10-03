// SMS through SMSAPI.bg, against a fake SMSAPI server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { startFakeSmsapi } = require('./fake-smsapi');
const sms = require('../sms');

const { app, db } = loadApp();
let api, agent;

test.before(async () => {
  api = await startFakeSmsapi({ token: 'test-token' });
  process.env.SMSAPI_URL = api.url;
  process.env.SMSAPI_TOKEN = 'test-token';
  agent = await login(request.agent(app));
});
test.after(() => api.close());

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}
const clearGuard = () => db.exec("UPDATE sms_messages SET created_at = datetime('now', '-1 hour')");
const status = async () => (await agent.get('/api/sms/status?fresh=1').expect(200)).body;

test('with SMSAPI_TOKEN set, SMS goes through SMSAPI', async () => {
  assert.equal(sms.provider(), 'smsapi');
  assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true, provider: 'smsapi' });
});

test('SMSAPI takes precedence over a configured phone gateway', async () => {
  process.env.SMS_GATEWAY_URL = 'http://127.0.0.1:1';
  try {
    assert.equal(sms.provider(), 'smsapi');
  } finally {
    delete process.env.SMS_GATEWAY_URL;
  }
});

test('sending passes number (digits only), Cyrillic text and UTF-8 to SMSAPI', async () => {
  const t = await create({ phoneContact: '0888 123 456' });
  const res = await agent.post(`/api/tickets/${t.id}/sms`).send({ text: 'Телефонът е готов.' }).expect(201);
  assert.equal(res.body.state, 'Pending');
  assert.equal(res.body.phone, '+359888123456');
  assert.match(res.body.gateway_id, /^\d+$/);

  const last = api.sent[api.sent.length - 1];
  assert.equal(last.to, '359888123456');
  assert.equal(last.message, 'Телефонът е готов.');
  assert.equal(last.encoding, 'utf-8');
  assert.equal(last.format, 'json');
  assert.equal(last.from, undefined); // no sender name configured
  assert.equal(last.test, undefined);
});

test('the sender name and test mode are passed when configured', async () => {
  process.env.SMSAPI_SENDER = 'CrazyPhone';
  process.env.SMSAPI_TEST = 'true';
  try {
    const t = await create();
    await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201);
    const last = api.sent[api.sent.length - 1];
    assert.equal(last.from, 'CrazyPhone');
    assert.equal(last.test, '1');
  } finally {
    delete process.env.SMSAPI_SENDER;
    delete process.env.SMSAPI_TEST;
  }
});

test('SMSAPI errors are explained in Bulgarian, with SMSAPI\'s own message', async () => {
  const cases = [
    [{ error: 103, message: 'Insufficient credits' }, /няма достатъчно кредит.*Insufficient credits.*код 103/],
    [{ error: 14, message: 'Invalid sender field' }, /името на подателя.*не е одобрено/],
    [{ error: 999, message: 'Something new' }, /SMSAPI: Something new \(код 999\)/]
  ];
  for (const [error, pattern] of cases) {
    const t = await create();
    api.nextError = error;
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, pattern);
    assert.equal(res.body.sms.state, 'Failed');
  }
});

test('a wrong token and an unreachable SMSAPI give clear messages', async () => {
  const t = await create();
  process.env.SMSAPI_TOKEN = 'wrong';
  try {
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, /грешен или изтекъл API ключ/);
  } finally {
    process.env.SMSAPI_TOKEN = 'test-token';
  }
  clearGuard();
  process.env.SMSAPI_URL = 'http://127.0.0.1:1';
  try {
    const res = await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(502);
    assert.match(res.body.error, /SMSAPI не отговаря/);
  } finally {
    process.env.SMSAPI_URL = api.url;
  }
});

test('delivery status is picked up from SMSAPI and mapped to the app\'s states', async () => {
  const t = await create();
  const sent = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  api.statuses.set(sent.gateway_id, 'SENT');
  await app.pollSmsStates();
  assert.equal(db.prepare('SELECT state FROM sms_messages WHERE id = ?').get(sent.id).state, 'Sent');

  api.statuses.set(sent.gateway_id, 'DELIVERED');
  await app.pollSmsStates();
  assert.equal(db.prepare('SELECT state FROM sms_messages WHERE id = ?').get(sent.id).state, 'Delivered');

  clearGuard();
  const second = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  api.statuses.set(second.gateway_id, 'UNDELIVERED');
  await app.pollSmsStates();
  const row = db.prepare('SELECT state, error FROM sms_messages WHERE id = ?').get(second.id);
  assert.equal(row.state, 'Failed');
  assert.match(row.error, /не е доставено/);
});

test('an unknown status answer leaves the SMS as it was', async () => {
  const t = await create();
  const sent = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  api.statuses.delete(sent.gateway_id); // SMSAPI answers with an error
  await app.pollSmsStates();
  assert.equal(db.prepare('SELECT state FROM sms_messages WHERE id = ?').get(sent.id).state, 'Pending');
});

test('the header status shows SMSAPI ready with the credit left', async () => {
  api.points = 42.5;
  const s = await status();
  assert.equal(s.state, 'ready');
  assert.equal(s.provider, 'smsapi');
  assert.equal(s.details.credit, 42.5);
  assert.equal(s.details.sender, null);
});

test('low credit and test mode are shown as warnings', async () => {
  api.points = 2;
  try {
    const s = await status();
    assert.equal(s.state, 'warning');
    assert.match(s.details.problems.join(' '), /малко кредит/);
  } finally {
    api.points = 42.5;
  }
  process.env.SMSAPI_TEST = 'true';
  try {
    const s = await status();
    assert.equal(s.state, 'warning');
    assert.match(s.details.problems.join(' '), /тестов режим/);
  } finally {
    delete process.env.SMSAPI_TEST;
  }
});

test('a wrong token shows as auth; an unreachable SMSAPI as offline', async () => {
  process.env.SMSAPI_TOKEN = 'wrong';
  try {
    assert.equal((await status()).state, 'auth');
  } finally {
    process.env.SMSAPI_TOKEN = 'test-token';
  }
  process.env.SMSAPI_URL = 'http://127.0.0.1:1';
  try {
    assert.equal((await status()).state, 'offline');
  } finally {
    process.env.SMSAPI_URL = api.url;
  }
  assert.equal((await status()).state, 'ready');
});

test('SMSAPI is not used in demo mode (SMS is simulated instead)', async () => {
  process.env.DEMO_MODE = 'true';
  try {
    assert.equal(sms.provider(), 'demo');
    assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true, provider: 'demo' });
  } finally {
    delete process.env.DEMO_MODE;
  }
});
