// SMS settings per shop: as in .env (the default), the shop's own phone or
// SMSAPI details, or off. Two fake phones: the one in .env and the second
// shop's own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { loadApp, login, validTicket } = require('./helpers');
const { startFakeGateway } = require('./fake-sms-gateway');

const { app, systemDb } = loadApp(); // seeds "tester" (admin)
const stores = require('../lib/stores');
const center = stores.defaultStore();
const lozenets = stores.create({ name: 'Магазин Лозенец', prefix: 'Л' });
for (const [username, role] of [['boris', 'staff'], ['vera', 'shop_manager']]) {
  systemDb.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?, ?, ?, ?)')
    .run(username, bcrypt.hashSync('secret123', 4), role, lozenets.id);
}

let envPhone, ownPhone, inCenter, inLozenets, boris, vera;

test.before(async () => {
  envPhone = await startFakeGateway({ user: 'sms', password: 'secret' });
  ownPhone = await startFakeGateway({ user: 'lozenets', password: 'own-secret-pw' });
  process.env.SMS_GATEWAY_URL = envPhone.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';
  inCenter = await login(request.agent(app));
  inLozenets = await login(request.agent(app));
  await inLozenets.post('/api/auth/store').send({ storeId: lozenets.id }).expect(200);
  boris = await login(request.agent(app), 'boris');
  vera = await login(request.agent(app), 'vera');
});
test.after(() => {
  envPhone.close();
  ownPhone.close();
  for (const k of ['SMS_GATEWAY_URL', 'SMS_GATEWAY_USER', 'SMS_GATEWAY_PASSWORD']) delete process.env[k];
});

// Sends are throttled per order for 30 s; tests reuse nothing, but clear anyway.
const clearGuard = store => store.db.exec("UPDATE sms_messages SET created_at = datetime('now', '-1 hour')");

async function sendFrom(agent, store, expected = 201) {
  const t = (await agent.post('/api/tickets').send(validTicket()).expect(201)).body;
  clearGuard(store);
  return agent.post(`/api/tickets/${t.id}/sms`).send({}).expect(expected);
}

test('by default every shop sends as set in .env', async () => {
  assert.equal((await inLozenets.get('/api/sms/shop-settings').expect(200)).body.mode, 'env');
  await sendFrom(boris, lozenets);
  await sendFrom(inCenter, center);
  assert.equal(envPhone.sent.length, 2);
  assert.equal(ownPhone.sent.length, 0);
});

test('a shop with its own phone sends from it; the others still use .env', async () => {
  const saved = (await inLozenets.put('/api/sms/shop-settings').send({
    mode: 'own', SMS_GATEWAY_URL: ownPhone.url, SMS_GATEWAY_USER: 'lozenets', SMS_GATEWAY_PASSWORD: 'own-secret-pw'
  }).expect(200)).body;
  assert.equal(saved.provider, 'phone');
  assert.deepEqual(saved.secrets, { SMSAPI_TOKEN: false, SMS_GATEWAY_PASSWORD: true });
  assert.ok(!JSON.stringify(saved).includes('own-secret-pw'), 'the password is never sent back');
  assert.ok(!JSON.stringify((await inLozenets.get('/api/sms/shop-settings')).body).includes('own-secret-pw'));

  envPhone.sent = [];
  await sendFrom(boris, lozenets);
  await sendFrom(inCenter, center);
  assert.equal(ownPhone.sent.length, 1);
  assert.equal(envPhone.sent.length, 1);
});

test('each shop\'s phone status comes from its own phone', async () => {
  ownPhone.health = { mode: 'down' };
  try {
    assert.equal((await boris.get('/api/sms/status?fresh=1').expect(200)).body.state, 'offline');
    assert.equal((await inCenter.get('/api/sms/status?fresh=1').expect(200)).body.state, 'ready');
    // The 30-second cache is per shop too.
    assert.equal((await boris.get('/api/sms/status').expect(200)).body.state, 'offline');
    assert.equal((await inCenter.get('/api/sms/status').expect(200)).body.state, 'ready');
  } finally {
    ownPhone.health = { mode: 'ok', status: 200, body: { status: 'pass', checks: {} } };
  }
});

test('delivery states are asked from the phone that sent the message', async () => {
  const sent = (await sendFrom(boris, lozenets)).body;
  ownPhone.states.set(sent.gateway_id, { state: 'Delivered' });
  await app.pollSmsStates();
  const row = lozenets.db.prepare('SELECT state FROM sms_messages WHERE id = ?').get(sent.id);
  assert.equal(row.state, 'Delivered');
});

test('an empty password keeps the saved one; null removes it', async () => {
  await inLozenets.put('/api/sms/shop-settings').send({ SMS_GATEWAY_PASSWORD: '' }).expect(200);
  await sendFrom(boris, lozenets); // still authenticates
  const res = (await inLozenets.put('/api/sms/shop-settings').send({ SMS_GATEWAY_PASSWORD: null }).expect(200)).body;
  assert.equal(res.secrets.SMS_GATEWAY_PASSWORD, false);
  await inLozenets.put('/api/sms/shop-settings').send({ SMS_GATEWAY_PASSWORD: 'own-secret-pw' }).expect(200);
});

test('a shop with SMS off isn\'t offered SMS and can\'t send', async () => {
  await inLozenets.put('/api/sms/shop-settings').send({ mode: 'off' }).expect(200);
  assert.deepEqual((await boris.get('/api/sms/config')).body, { enabled: false, provider: null });
  await sendFrom(boris, lozenets, 503);
  assert.equal((await inCenter.get('/api/sms/config')).body.enabled, true);
  // Its own details are kept for when it's switched back.
  const back = (await inLozenets.put('/api/sms/shop-settings').send({ mode: 'own' }).expect(200)).body;
  assert.equal(back.provider, 'phone');
});

test('own SMSAPI details take priority over the shop\'s phone, like in .env', async () => {
  const s = (await inLozenets.put('/api/sms/shop-settings').send({ SMSAPI_TOKEN: 'token-1', SMSAPI_SENDER: 'Lozenets', SMSAPI_TEST: true }).expect(200)).body;
  assert.equal(s.provider, 'smsapi');
  assert.equal(s.SMSAPI_SENDER, 'Lozenets');
  assert.equal(s.SMSAPI_TEST, true);
  assert.ok(!JSON.stringify(s).includes('token-1'));
  const stored = JSON.parse(systemDb.prepare('SELECT sms FROM stores WHERE id = ?').get(lozenets.id).sms);
  assert.equal(stored.SMSAPI_TOKEN, 'token-1');
  await inLozenets.put('/api/sms/shop-settings').send({ SMSAPI_TOKEN: null, SMSAPI_SENDER: '', SMSAPI_TEST: false }).expect(200);
  assert.equal((await inLozenets.get('/api/sms/shop-settings')).body.provider, 'phone');
});

test('invalid SMS settings are refused', async () => {
  for (const [body, message] of [
    [{ mode: 'sometimes' }, /Невалиден избор/],
    [{ SMS_GATEWAY_URL: 'ftp://phone' }, /http:\/\/ или https:\/\//],
    [{ SMSAPI_SENDER: 'TooLongSender' }, /най-много 11/],
    [{ SMS_GATEWAY_USER: 5 }, /Невалидна стойност/],
    [{ SMS_GATEWAY_URL: null, SMSAPI_TOKEN: null }, /SMSAPI ключ или адрес на телефона/]
  ]) {
    const res = await inLozenets.put('/api/sms/shop-settings').send(body).expect(400);
    assert.match(res.body.error, message);
  }
  assert.equal((await inLozenets.get('/api/sms/shop-settings')).body.SMS_GATEWAY_URL, ownPhone.url, 'nothing saved');
});

test('only admins see or change SMS settings', async () => {
  for (const agent of [boris, vera]) {
    await agent.get('/api/sms/shop-settings').expect(403);
    await agent.put('/api/sms/shop-settings').send({ mode: 'off' }).expect(403);
  }
});
