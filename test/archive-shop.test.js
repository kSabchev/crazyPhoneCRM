// Archiving a shop: out of the picker, the lists, new orders and accounts;
// its data kept (backups, Справки); restorable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { loadApp, login, validTicket, runScript } = require('./helpers');

const { app, systemDb, dataRoot } = loadApp(); // seeds "tester" (admin)
const stores = require('../lib/stores');
let admin, lozenetsId, order;

test.before(async () => {
  admin = await login(request.agent(app));
  lozenetsId = (await admin.post('/api/stores').send({ name: 'Лозенец', prefix: 'Л' }).expect(201)).body.id;
  await admin.post('/api/auth/store').send({ storeId: lozenetsId }).expect(200);
  order = (await admin.post('/api/tickets').send(validTicket({ customerName: 'Клиент Лозенец', status: 'издаден', customerPrice: '70' })).expect(201)).body;
  await admin.post('/api/users').send({ username: 'boris', password: 'password1', role: 'staff', storeId: lozenetsId }).expect(201);
});

test('a shop with accounts can\'t be archived: they\'d be locked out', async () => {
  const res = await admin.post(`/api/stores/${lozenetsId}/archive`).expect(400);
  assert.match(res.body.error, /профилите му: boris/);
  const boris = systemDb.prepare("SELECT id FROM users WHERE username = 'boris'").get().id;
  await admin.put(`/api/users/${boris}`).send({ storeId: 1 }).expect(200);
});

test('archiving takes a shop out of the picker, the all-shops view and new orders', async () => {
  const shop = (await admin.post(`/api/stores/${lozenetsId}/archive`).expect(200)).body;
  assert.equal(shop.archived, true);

  // The admin was working on it: back on the first shop.
  const me = (await admin.get('/api/auth/me').expect(200)).body;
  assert.equal(me.store.id, 1);
  assert.deepEqual(me.stores.map(s => s.name), ['CrazyPhone']);
  assert.deepEqual(me.archivedStores.map(s => s.name), ['Лозенец']);
  await admin.post('/api/auth/store').send({ storeId: lozenetsId }).expect(400);

  await admin.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  const list = (await admin.get('/api/tickets').expect(200)).body;
  assert.ok(!list.some(t => t.customer_name === 'Клиент Лозенец'));
  await admin.put(`/api/tickets/${lozenetsId}:${order.id}`).send({ comment: 'x' }).expect(404);
  await admin.post('/api/tickets').send(validTicket({ storeId: lozenetsId })).expect(400);
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);

  // No accounts can be put in it.
  const res = await admin.post('/api/users').send({ username: 'nova', password: 'password1', role: 'staff', storeId: lozenetsId }).expect(400);
  assert.match(res.body.error, /архивиран/);
});

test('an archived shop keeps its data: backed up, and its figures can be picked in Справки', async () => {
  const shop = stores.get(lozenetsId);
  assert.equal(shop.tickets.get(order.id).customer_name, 'Клиент Лозенец');

  assert.equal(runScript('backup.js', [], dataRoot).status, 0);
  assert.ok(fs.readdirSync(path.join(dataRoot, 'backups')).some(f => f.startsWith(`shop-${lozenetsId}_`)));

  const report = (await admin.get(`/api/reports?shops=${lozenetsId}`).expect(200)).body;
  assert.equal(report.revenue.totals.revenue, 70);
  // Not in the all-shops reports by default.
  await admin.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  const everything = (await admin.get('/api/reports').expect(200)).body;
  assert.deepEqual(everything.shops, [1]);
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);

  // Still listed in Магазини, marked, and its prefix stays taken.
  const listed = (await admin.get('/api/stores').expect(200)).body.find(s => s.id === lozenetsId);
  assert.deepEqual([listed.archived, listed.orders], [true, 1]);
  assert.match((await admin.post('/api/stores').send({ name: 'Друг', prefix: 'Л' }).expect(400)).body.error, /вече се използва/);
});

test('a staff account of an archived shop can\'t log in or work', async () => {
  // E.g. put back by hand in the database.
  systemDb.prepare("UPDATE users SET store_id = ? WHERE username = 'boris'").run(lozenetsId);
  const res = await request(app).post('/api/auth/login').send({ username: 'boris', password: 'password1' }).expect(403);
  assert.match(res.body.error, /не е свързан с магазин/);
  systemDb.prepare("UPDATE users SET store_id = 1 WHERE username = 'boris'").run();
});

test('the last shop in use can\'t be archived', async () => {
  const res = await admin.post('/api/stores/1/archive').expect(400);
  assert.match(res.body.error, /поне един магазин/);
  await admin.post(`/api/stores/${lozenetsId}/archive`).expect(400); // already archived
  await admin.post('/api/stores/99/archive').expect(404);
});

test('restoring brings it back as it was', async () => {
  const shop = (await admin.post(`/api/stores/${lozenetsId}/restore`).expect(200)).body;
  assert.equal(shop.archived, false);
  await admin.post(`/api/stores/${lozenetsId}/restore`).expect(400);
  assert.deepEqual((await admin.get('/api/auth/me')).body.stores.map(s => s.name), ['CrazyPhone', 'Лозенец']);
  await admin.post('/api/auth/store').send({ storeId: lozenetsId }).expect(200);
  assert.ok((await admin.get('/api/tickets')).body.some(t => t.customer_name === 'Клиент Лозенец'));
  await admin.post('/api/auth/store').send({ storeId: 1 }).expect(200);
});

test('archived shops don\'t count towards the 10 in use, but restoring respects it', async () => {
  for (let i = 3; i <= 10; i++) await admin.post('/api/stores').send({ name: `Магазин ${i}` }).expect(201);
  await admin.post('/api/stores').send({ name: 'Единайсети' }).expect(400);
  await admin.post('/api/stores/10/archive').expect(200);
  await admin.post('/api/stores').send({ name: 'Единайсети' }).expect(201);
  const res = await admin.post('/api/stores/10/restore').expect(400);
  assert.match(res.body.error, /най-много 10/);
});

test('only admins archive or restore', async () => {
  const boris = await login(request.agent(app), 'boris', 'password1');
  await boris.post(`/api/stores/${lozenetsId}/archive`).expect(403);
  await boris.post(`/api/stores/${lozenetsId}/restore`).expect(403);
});
