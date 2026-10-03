// SMS in the public demo (DEMO_MODE=true): simulated inside the app. Both
// real ways to send are configured here too, to prove neither is contacted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { startFakeGateway } = require('./fake-sms-gateway');
const { startFakeSmsapi } = require('./fake-smsapi');
const smsDemo = require('../sms-demo');

const { app, db } = loadApp();
let gw, api, agent;

test.before(async () => {
  gw = await startFakeGateway();
  api = await startFakeSmsapi();
  process.env.SMS_GATEWAY_URL = gw.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';
  process.env.SMSAPI_URL = api.url;
  process.env.SMSAPI_TOKEN = 'token';
  process.env.DEMO_MODE = 'true';
  agent = await login(request.agent(app));
});
test.after(() => {
  delete process.env.DEMO_MODE;
  gw.close();
  api.close();
});

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}
// Pretends the message was sent long enough ago to be "delivered".
const age = id => {
  const row = db.prepare('SELECT gateway_id FROM sms_messages WHERE id = ?').get(id);
  const old = row.gateway_id.replace(/^demo-\d+/, `demo-${Date.now() - smsDemo.DELIVER_AFTER_MS - 1000}`);
  db.prepare('UPDATE sms_messages SET gateway_id = ? WHERE id = ?').run(old, id);
};

test('in demo mode SMS is on, through the simulated provider', async () => {
  assert.deepEqual((await agent.get('/api/sms/config')).body, { enabled: true, provider: 'demo' });
  const s = (await agent.get('/api/sms/status?fresh=1').expect(200)).body;
  assert.equal(s.state, 'ready');
  assert.equal(s.provider, 'demo');
});

test('a demo SMS is saved like a real one, then reported as delivered', async () => {
  const t = await create({ phoneContact: '0888 123 456' });
  const sent = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  assert.equal(sent.state, 'Pending');
  assert.equal(sent.phone, '+359888123456');
  assert.match(sent.gateway_id, /^demo-/);

  // Too soon: still waiting.
  assert.equal(await app.pollSmsStates(), 0);
  age(sent.id);
  assert.equal(await app.pollSmsStates(), 1);
  const row = db.prepare('SELECT state, error FROM sms_messages WHERE id = ?').get(sent.id);
  assert.deepEqual({ ...row }, { state: 'Delivered', error: null });
});

test('a number ending in 000 shows what a failed SMS looks like', async () => {
  const t = await create({ phoneContact: '0888 123 000' });
  const sent = (await agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(201)).body;
  age(sent.id);
  await app.pollSmsStates();
  const row = db.prepare('SELECT state, error FROM sms_messages WHERE id = ?').get(sent.id);
  assert.equal(row.state, 'Failed');
  assert.match(row.error, /Демо/);
});

test('nothing ever reaches the phone or SMSAPI', () => {
  assert.equal(gw.sent.length, 0);
  assert.equal(api.sent.length, 0);
});
