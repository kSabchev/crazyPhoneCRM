// Adding shops and changing their name or prefix (Настройки → Магазини).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { loadApp, login, validTicket, runScript } = require('./helpers');

const { app, systemDb, dataRoot } = loadApp(); // seeds "tester" (admin)
let admin;

test.before(async () => {
  admin = await login(request.agent(app));
});

test('admins list the shops, with how many orders each has', async () => {
  await admin.post('/api/tickets').send(validTicket()).expect(201);
  assert.deepEqual((await admin.get('/api/stores').expect(200)).body, [{ id: 1, name: 'CrazyPhone', prefix: '', archived: false, orders: 1 }]);
});

test('adding a shop gives it an empty database, its settings and a place in the picker', async () => {
  const shop = (await admin.post('/api/stores').send({ name: ' Магазин Лозенец ', prefix: 'Л' }).expect(201)).body;
  assert.deepEqual(shop, { id: 2, name: 'Магазин Лозенец', prefix: 'Л', archived: false, orders: 0 });
  assert.ok(fs.existsSync(path.join(dataRoot, 'data', 'shop-2.db')));

  const me = (await admin.get('/api/auth/me')).body;
  assert.deepEqual(me.stores.map(s => s.name), ['CrazyPhone', 'Магазин Лозенец']);
  await admin.post('/api/auth/store').send({ storeId: 2 }).expect(200);
  assert.equal((await admin.get('/api/settings')).body.shopName, 'Магазин Лозенец');
  assert.deepEqual((await admin.get('/api/tickets')).body, []);

  // Orders there are numbered from 1, shown with the prefix.
  const t = (await admin.post('/api/tickets').send(validTicket()).expect(201)).body;
  assert.equal(t.ticket_no, 1);
  assert.equal(t.store_prefix, 'Л');
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);
});

test('its staff can be given accounts in it straight away', async () => {
  await admin.post('/api/users').send({ username: 'boris', password: 'password1', role: 'staff', storeId: 2 }).expect(201);
  const boris = await login(request.agent(app), 'boris', 'password1');
  assert.equal((await boris.get('/api/auth/me')).body.store.name, 'Магазин Лозенец');
});

test('renaming a shop also renames it in its settings (printed on its cards)', async () => {
  const shop = (await admin.put('/api/stores/2').send({ name: 'Лозенец' }).expect(200)).body;
  assert.equal(shop.name, 'Лозенец');
  assert.equal(shop.prefix, 'Л', 'unchanged');
  await admin.post('/api/auth/store').send({ storeId: 2 }).expect(200);
  assert.equal((await admin.get('/api/settings')).body.shopName, 'Лозенец');
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);
});

test('changing a prefix shows on the shop\'s orders at once', async () => {
  await admin.put('/api/stores/2').send({ prefix: 'ЛЗ' }).expect(200);
  await admin.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  const list = (await admin.get('/api/tickets')).body;
  assert.ok(list.some(t => t.store_id === 2 && t.store_prefix === 'ЛЗ'));
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);
  // The first shop can get one too, and drop it again.
  await admin.put('/api/stores/1').send({ prefix: 'Ц' }).expect(200);
  await admin.put('/api/stores/1').send({ prefix: '' }).expect(200);
});

test('names and prefixes are checked', async () => {
  for (const [send, message] of [
    [() => admin.post('/api/stores').send({ name: '  ' }), /не може да бъде празно/],
    [() => admin.post('/api/stores').send({}), /не може да бъде празно/],
    [() => admin.post('/api/stores').send({ name: 'x'.repeat(61) }), /твърде дълго/],
    [() => admin.post('/api/stores').send({ name: 'Трети', prefix: 'Л-1' }), /само букви и цифри/],
    [() => admin.post('/api/stores').send({ name: 'Трети', prefix: 'ABCDEF' }), /само букви и цифри/],
    [() => admin.post('/api/stores').send({ name: 'Трети', prefix: 'лз' }), /вече се използва от „Лозенец“/],
    [() => admin.put('/api/stores/1').send({ prefix: 'ЛЗ' }), /вече се използва/],
    [() => admin.put('/api/stores/2').send({ name: '' }), /не може да бъде празно/]
  ]) {
    const res = await send();
    assert.equal(res.status, 400, res.req.path);
    assert.match(res.body.error, message);
  }
  // A shop keeping its own prefix is fine.
  await admin.put('/api/stores/2').send({ prefix: 'ЛЗ', name: 'Лозенец' }).expect(200);
  await admin.put('/api/stores/99').send({ name: 'x' }).expect(404);
  assert.equal((await admin.get('/api/stores')).body.length, 2, 'nothing added');
});

test('at most 10 shops (the all-shops reports combine them)', async () => {
  for (let i = 3; i <= 10; i++) await admin.post('/api/stores').send({ name: `Магазин ${i}` }).expect(201);
  const res = await admin.post('/api/stores').send({ name: 'Магазин 11' }).expect(400);
  assert.match(res.body.error, /най-много 10/);
  await admin.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  await admin.get('/api/reports').expect(200);
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);
});

test('a new shop is in the next backup', () => {
  assert.equal(runScript('backup.js', [], dataRoot).status, 0);
  const files = fs.readdirSync(path.join(dataRoot, 'backups'));
  assert.ok(files.some(f => f.startsWith('shop-2_')), files.join(', '));
  assert.ok(files.some(f => f.startsWith('shop-10_')), files.join(', '));
});

test('only admins manage shops', async () => {
  systemDb.prepare("INSERT INTO users (username, password_hash, role, store_id) VALUES ('vera', ?, 'shop_manager', 1)")
    .run(bcrypt.hashSync('secret123', 4));
  const vera = await login(request.agent(app), 'vera');
  await vera.get('/api/stores').expect(403);
  await vera.post('/api/stores').send({ name: 'Нов' }).expect(403);
  await vera.put('/api/stores/1').send({ name: 'Нов' }).expect(403);
  await request(app).get('/api/stores').expect(401);
});
