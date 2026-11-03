// The admin log: changes to shops, accounts and settings, with who and
// when; secrets are never written.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { ROOT, loadApp, login } = require('./helpers');
const { diffSettings } = require('../lib/settings-diff');

const { app, systemDb, dataRoot } = loadApp(); // seeds "tester" (admin)
let admin;

test.before(async () => {
  admin = await login(request.agent(app));
});

const latest = async () => (await admin.get('/api/admin-log').expect(200)).body[0];
const everything = () => JSON.stringify(systemDb.prepare('SELECT * FROM admin_log').all());

test('shops: added, renamed, prefix changed, archived, restored', async () => {
  const id = (await admin.post('/api/stores').send({ name: 'Лозенец', prefix: 'Л' }).expect(201)).body.id;
  let e = await latest();
  assert.deepEqual([e.action, e.performed_by, e.store_id, e.store_name, e.details], ['shop_added', 'tester', id, 'Лозенец', { name: 'Лозенец', prefix: 'Л' }]);

  await admin.put(`/api/stores/${id}`).send({ name: 'Лозенец 2', prefix: 'ЛЗ' }).expect(200);
  e = await latest();
  assert.equal(e.action, 'shop_changed');
  assert.deepEqual(e.details.changes, { name: { from: 'Лозенец', to: 'Лозенец 2' }, prefix: { from: 'Л', to: 'ЛЗ' } });

  // Saving without a change logs nothing.
  const count = systemDb.prepare('SELECT COUNT(*) n FROM admin_log').get().n;
  await admin.put(`/api/stores/${id}`).send({ name: 'Лозенец 2', prefix: 'ЛЗ' }).expect(200);
  assert.equal(systemDb.prepare('SELECT COUNT(*) n FROM admin_log').get().n, count);

  await admin.post(`/api/stores/${id}/archive`).expect(200);
  assert.equal((await latest()).action, 'shop_archived');
  await admin.post(`/api/stores/${id}/restore`).expect(200);
  assert.equal((await latest()).action, 'shop_restored');
});

test('accounts: added, changed, password reset, removed, own password; never the passwords', async () => {
  const u = (await admin.post('/api/users').send({ username: 'ivan', password: 'secretpass1', role: 'staff', storeId: 1 }).expect(201)).body;
  let e = await latest();
  assert.deepEqual([e.action, e.details], ['user_added', { username: 'ivan', role: 'staff', store: 'CrazyPhone' }]);

  await admin.put(`/api/users/${u.id}`).send({ role: 'shop_manager', storeId: 2, password: 'anotherpass9' }).expect(200);
  e = await latest();
  assert.equal(e.action, 'user_changed');
  assert.deepEqual(e.details.changes, {
    role: { from: 'staff', to: 'shop_manager' }, store: { from: 'CrazyPhone', to: 'Лозенец 2' }, password: 'reset'
  });

  await admin.post('/api/auth/password').send({ currentPassword: 'secret123', newPassword: 'mynewpass77' }).expect(200);
  assert.deepEqual([(await latest()).action, (await latest()).details], ['password_changed', { username: 'tester' }]);

  await admin.delete(`/api/users/${u.id}`).expect(200);
  e = await latest();
  assert.deepEqual([e.action, e.details], ['user_removed', { username: 'ivan', role: 'shop_manager', store: 'Лозенец 2' }]);

  for (const secret of ['secretpass1', 'anotherpass9', 'mynewpass77']) assert.ok(!everything().includes(secret), secret);
});

test('settings: what changed, from what to what', async () => {
  const s = (await admin.get('/api/settings')).body;
  await admin.put('/api/settings').send({
    shopTagline: 'нов слоган',
    statuses: [...s.statuses, 'чака части'],
    statusColors: { 'за сервиз': '#000000' },
    devices: s.devices.filter(d => d !== 'iPhone XR')
  }).expect(200);
  const e = await latest();
  assert.equal(e.action, 'settings_changed');
  assert.equal(e.store_id, 1);
  assert.deepEqual(e.details.changes.shopTagline, { from: 'аксесоари и сервиз', to: 'нов слоган' });
  assert.deepEqual(e.details.changes.statuses, { added: ['чака части'], removed: [] });
  assert.deepEqual(e.details.changes.statusColors, { 'за сервиз': { from: '#7C3AED', to: '#000000' } });
  assert.deepEqual(e.details.changes.devices, { added: [], removed: ['iPhone XR'] });
  assert.equal(Object.keys(e.details.changes).length, 4);

  // The settings page sends everything on every save: unchanged, nothing logged.
  const before = systemDb.prepare('SELECT COUNT(*) n FROM admin_log').get().n;
  const current = (await admin.get('/api/settings')).body;
  await admin.put('/api/settings').send(current).expect(200);
  assert.equal(systemDb.prepare('SELECT COUNT(*) n FROM admin_log').get().n, before);
});

test('the settings comparison: texts, lists (added, removed, reordered), footer', () => {
  assert.deepEqual(diffSettings({ statuses: ['a', 'b'] }, { statuses: ['b', 'a'] }), { statuses: { added: [], removed: [], reordered: true } });
  assert.deepEqual(diffSettings({ printCustomer: { footer: 'x' } }, { printCustomer: { footer: 'y' } }), { printFooter: { from: 'x', to: 'y' } });
  assert.deepEqual(diffSettings({ phone: undefined }, { phone: '' }), {});
  assert.deepEqual(diffSettings({ columns: ['a'] }, { columns: ['a', 'b'] }), { columns: { added: ['b'], removed: [] } });
});

test('SMS settings: values from → to, but only that a token or password was set', async () => {
  await admin.put('/api/sms/shop-settings').send({
    mode: 'own', SMS_GATEWAY_URL: 'http://127.0.0.1:1', SMS_GATEWAY_USER: 'u', SMS_GATEWAY_PASSWORD: 'phone-pass-123'
  }).expect(200);
  let e = await latest();
  assert.equal(e.action, 'sms_settings_changed');
  assert.deepEqual(e.details.changes, {
    mode: { from: 'env', to: 'own' },
    SMS_GATEWAY_URL: { from: '', to: 'http://127.0.0.1:1' },
    SMS_GATEWAY_USER: { from: '', to: 'u' },
    SMS_GATEWAY_PASSWORD: { secret: 'set' }
  });
  await admin.put('/api/sms/shop-settings').send({ SMS_GATEWAY_PASSWORD: 'phone-pass-456' }).expect(200);
  assert.deepEqual((await latest()).details.changes, { SMS_GATEWAY_PASSWORD: { secret: 'changed' } });
  await admin.put('/api/sms/shop-settings').send({ mode: 'env', SMS_GATEWAY_PASSWORD: null }).expect(200);
  e = await latest();
  assert.deepEqual(e.details.changes.SMS_GATEWAY_PASSWORD, { secret: 'removed' });
  assert.ok(!everything().includes('phone-pass'));
});

test('create-admin.js logs as itself', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'create-admin.js'), ...args], {
    cwd: ROOT, env: { ...process.env, DATA_ROOT: dataRoot }, encoding: 'utf8'
  });
  assert.equal(run('cli-user', 'clipass123', '--staff').status, 0);
  assert.equal(run('cli-user', 'clipass456', '--manager').status, 0);
  const rows = systemDb.prepare("SELECT action, details FROM admin_log WHERE performed_by = 'create-admin.js' ORDER BY id").all();
  assert.deepEqual(rows.map(r => r.action), ['user_added', 'user_changed']);
  assert.deepEqual(JSON.parse(rows[1].details).changes, { password: 'reset', role: { from: 'staff', to: 'shop_manager' } });
  assert.ok(!everything().includes('clipass'));
});

test('newest first, and only admins can read it', async () => {
  const entries = (await admin.get('/api/admin-log').expect(200)).body;
  const times = entries.map(e => e.performed_at);
  assert.deepEqual(times, [...times].sort().reverse());
  systemDb.prepare("UPDATE users SET role = 'shop_manager', store_id = 1 WHERE username = 'cli-user'").run();
  const manager = await login(request.agent(app), 'cli-user', 'clipass456');
  await manager.get('/api/admin-log').expect(403);
  await request(app).get('/api/admin-log').expect(401);
});
