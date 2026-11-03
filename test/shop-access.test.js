// Several shops: shop accounts (staff, shop managers) only ever reach their
// own shop; admins pick the shop they work on. Two shops whose orders have
// the same ids, so a request reaching the wrong database would show.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const bcrypt = require('bcrypt');
const STATUSES = require('../public/statuses');
const { loadApp, login, validTicket } = require('./helpers');

const { app, systemDb } = loadApp(); // seeds "tester" (admin)
const stores = require('../lib/stores');
const center = stores.defaultStore();
const lozenets = stores.create({ name: 'Магазин Лозенец', prefix: 'Л' });

function addAccount(username, role, storeId) {
  systemDb.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?, ?, ?, ?)')
    .run(username, bcrypt.hashSync('secret123', 4), role, storeId);
}
addAccount('ana', 'staff', center.id);
addAccount('boris', 'staff', lozenets.id);
addAccount('vera', 'shop_manager', lozenets.id);

let server, base, admin, ana, boris, vera, anaOrder, borisOrder;

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login(request.agent(base));
  ana = await login(request.agent(base), 'ana');
  boris = await login(request.agent(base), 'boris');
  vera = await login(request.agent(base), 'vera');
  anaOrder = (await ana.post('/api/tickets').send(validTicket({ customerName: 'Клиент Център', phoneModel: 'Nokia 3310' })).expect(201)).body;
  borisOrder = (await boris.post('/api/tickets').send(validTicket({ customerName: 'Клиент Лозенец', phoneModel: 'Pixel 9' })).expect(201)).body;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

const names = async (agent) => (await agent.get('/api/tickets').expect(200)).body.map(t => t.customer_name);

test('a new shop has its own database and settings', () => {
  assert.equal(lozenets.prefix, 'Л');
  assert.notEqual(lozenets.db, center.db);
  assert.equal(systemDb.prepare('SELECT db_file FROM stores WHERE id = ?').get(lozenets.id).db_file, `shop-${lozenets.id}.db`);
  assert.equal(JSON.parse(lozenets.db.prepare('SELECT data FROM settings').get().data).shopName, 'Магазин Лозенец');
  // The two orders have the same id, each in its own shop.
  assert.equal(anaOrder.id, borisOrder.id);
});

test('login and /me tell a shop account its shop, and nothing about other shops', async () => {
  const me = (await boris.get('/api/auth/me').expect(200)).body;
  assert.deepEqual(me, { username: 'boris', role: 'staff', store: { id: lozenets.id, name: 'Магазин Лозенец', prefix: 'Л' } });
  const adminMe = (await admin.get('/api/auth/me').expect(200)).body;
  assert.deepEqual(adminMe.stores.map(s => s.name), ['CrazyPhone', 'Магазин Лозенец']);
});

test('shop accounts only see and change their own shop\'s orders', async () => {
  assert.deepEqual(await names(ana), ['Клиент Център']);
  assert.deepEqual(await names(boris), ['Клиент Лозенец']);
  assert.deepEqual(await names(vera), ['Клиент Лозенец']);

  // The same id means a different order in each shop.
  await boris.put(`/api/tickets/${borisOrder.id}`).send({ comment: 'от Лозенец' }).expect(200);
  assert.equal(center.tickets.get(anaOrder.id).comment, '');
  assert.equal(lozenets.tickets.get(borisOrder.id).comment, 'от Лозенец');

  const history = (await boris.get(`/api/tickets/${borisOrder.id}/history`).expect(200)).body;
  assert.ok(history.every(h => h.performed_by === 'boris'), JSON.stringify(history));
  const activity = (await ana.get('/api/audit').expect(200)).body;
  assert.ok(activity.length > 0 && activity.every(h => h.performed_by === 'ana'), JSON.stringify(activity));

  // The phone-model suggestions learn from the shop's own orders only.
  const devices = (await boris.get('/api/devices').expect(200)).body;
  assert.ok(devices.includes('Pixel 9') && !devices.includes('Nokia 3310'));
  assert.equal((await boris.get('/api/settings').expect(200)).body.shopName, 'Магазин Лозенец');

  // An order only in the other shop is not found.
  const onlyCenter = (await ana.post('/api/tickets').send(validTicket({ customerName: 'Само Център' })).expect(201)).body;
  await boris.get(`/api/tickets/${onlyCenter.id}/history`).expect(404);
  await boris.put(`/api/tickets/${onlyCenter.id}`).send({ comment: 'x' }).expect(404);
  await vera.delete(`/api/tickets/${onlyCenter.id}`).expect(404);
  assert.ok(center.tickets.get(onlyCenter.id));
});

test('shop accounts can\'t pick another shop', async () => {
  for (const agent of [boris, vera]) {
    await agent.post('/api/auth/store').send({ storeId: center.id }).expect(403);
    assert.deepEqual(await names(agent), ['Клиент Лозенец']);
  }
});

test('shop managers delete orders and see their shop\'s reports, but not Settings, accounts or backups', async () => {
  const issued = (await boris.post('/api/tickets').send(validTicket({
    customerName: 'Издаден', status: STATUSES.COMPLETED, customerPrice: '120'
  })).expect(201)).body;
  const report = (await vera.get('/api/reports').expect(200)).body;
  assert.equal(report.revenue.totals.returned, 1);
  assert.equal(report.revenue.totals.revenue, 120);
  // The other shop's report doesn't include it.
  assert.equal((await admin.get('/api/reports').expect(200)).body.revenue.totals.returned, 0);

  await vera.delete(`/api/tickets/${issued.id}`).expect(200);
  assert.equal(lozenets.tickets.get(issued.id), null);

  for (const res of [
    await vera.put('/api/settings').send({ shopTagline: 'x' }),
    await vera.get('/api/users'),
    await vera.post('/api/users').send({ username: 'newone', password: 'password1', role: 'staff' }),
    await vera.get('/api/backups')
  ]) {
    assert.equal(res.status, 403, `${res.req.method} ${res.req.path}`);
  }
  // Staff still can't delete or see reports.
  await boris.delete(`/api/tickets/${borisOrder.id}`).expect(403);
  await boris.get('/api/reports').expect(403);
});

test('admins pick the shop they work on', async () => {
  const picker = await login(request.agent(base)); // its own session
  assert.equal((await picker.get('/api/auth/me')).body.store.id, center.id, 'the first shop until one is picked');

  const picked = (await picker.post('/api/auth/store').send({ storeId: lozenets.id }).expect(200)).body;
  assert.equal(picked.store.name, 'Магазин Лозенец');
  assert.deepEqual(await names(picker), ['Клиент Лозенец']);
  await picker.put(`/api/tickets/${borisOrder.id}`).send({ comment: 'от администратора' }).expect(200);
  assert.equal(lozenets.tickets.get(borisOrder.id).comment, 'от администратора');
  assert.notEqual(center.tickets.get(anaOrder.id).comment, 'от администратора');

  // Another admin session is unaffected.
  assert.ok((await names(admin)).includes('Клиент Център'));

  await picker.post('/api/auth/store').send({ storeId: 999 }).expect(400);
  await picker.post('/api/auth/store').send({}).expect(400);
  assert.equal((await picker.get('/api/auth/me')).body.store.id, lozenets.id);
});

test('accounts: shop accounts get a shop, admins none', async () => {
  const shopOf = username => systemDb.prepare('SELECT store_id FROM users WHERE username = ?').get(username).store_id;

  // A shop given...
  let u = (await admin.post('/api/users').send({ username: 'galya', password: 'password1', role: 'shop_manager', storeId: lozenets.id }).expect(201)).body;
  assert.equal(u.store_id, lozenets.id);
  // ...or else the shop the admin works on.
  await admin.post('/api/users').send({ username: 'dimo', password: 'password1', role: 'staff' }).expect(201);
  assert.equal(shopOf('dimo'), center.id);
  // Admins have none, even if one is sent.
  await admin.post('/api/users').send({ username: 'boss2', password: 'password1', role: 'admin', storeId: lozenets.id }).expect(201);
  assert.equal(shopOf('boss2'), null);

  const bad = await admin.post('/api/users').send({ username: 'nobody', password: 'password1', role: 'staff', storeId: 999 }).expect(400);
  assert.match(bad.body.error, /Невалиден магазин/);
  await admin.put(`/api/users/${u.id}`).send({ storeId: 999 }).expect(400);

  // Role changes: to admin drops the shop; back to staff gets the admin's shop.
  u = (await admin.put(`/api/users/${u.id}`).send({ role: 'admin' }).expect(200)).body;
  assert.equal(u.store_id, null);
  u = (await admin.put(`/api/users/${u.id}`).send({ role: 'staff' }).expect(200)).body;
  assert.equal(u.store_id, center.id);
  u = (await admin.put(`/api/users/${u.id}`).send({ storeId: lozenets.id }).expect(200)).body;
  assert.equal(u.store_id, lozenets.id);
  assert.equal((await admin.get('/api/users').expect(200)).body.find(x => x.username === 'galya').store_id, lozenets.id);
});

test('moving an account to another shop applies to its open session at once', async () => {
  addAccount('mila', 'staff', center.id);
  const mila = await login(request.agent(base), 'mila');
  assert.ok((await names(mila)).includes('Клиент Център'));

  const id = systemDb.prepare("SELECT id FROM users WHERE username = 'mila'").get().id;
  await admin.put(`/api/users/${id}`).send({ storeId: lozenets.id }).expect(200);
  assert.deepEqual(await names(mila), ['Клиент Лозенец']);
});

test('a shop account without a shop can\'t log in or work', async () => {
  addAccount('lost', 'staff', 999);
  const res = await request(base).post('/api/auth/login').send({ username: 'lost', password: 'secret123' }).expect(403);
  assert.match(res.body.error, /не е свързан с магазин/);

  addAccount('orphan', 'staff', center.id);
  const orphan = await login(request.agent(base), 'orphan');
  systemDb.prepare("UPDATE users SET store_id = NULL WHERE username = 'orphan'").run();
  const denied = await orphan.get('/api/tickets').expect(403);
  assert.match(denied.body.error, /не е свързан с магазин/);
});

// ---- Live updates and "who's viewing" ----

function openStream(agent) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { Cookie: agent.sessionCookie } }, res => {
      assert.equal(res.statusCode, 200);
      const messages = [];
      res.setEncoding('utf8');
      res.on('data', chunk => {
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) messages.push(line.slice(6));
      });
      resolve({ messages, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}
const settle = () => new Promise(resolve => setTimeout(resolve, 150));

test('live updates only reach the screens of the shop that changed', async () => {
  const centerScreen = await openStream(ana);
  const lozenetsScreen = await openStream(boris);
  try {
    await boris.put(`/api/tickets/${borisOrder.id}`).send({ comment: 'промяна' }).expect(200);
    await settle();
    assert.deepEqual(lozenetsScreen.messages, ['tickets']);
    assert.deepEqual(centerScreen.messages, []);

    await ana.put(`/api/tickets/${anaOrder.id}`).send({ comment: 'промяна' }).expect(200);
    await settle();
    assert.deepEqual(centerScreen.messages, ['tickets']);
    assert.deepEqual(lozenetsScreen.messages, ['tickets']);

    // Settings saved by an admin working on the first shop.
    await admin.put('/api/settings').send({ shopTagline: 'нов слоган' }).expect(200);
    await settle();
    assert.deepEqual(centerScreen.messages, ['tickets', 'settings']);
    assert.deepEqual(lozenetsScreen.messages, ['tickets']);
    assert.equal((await boris.get('/api/settings')).body.shopTagline === 'нов слоган', false);
  } finally {
    centerScreen.close();
    lozenetsScreen.close();
  }
});

test('"who\'s viewing" an order is per shop, though order ids repeat', async () => {
  await ana.post(`/api/tickets/${anaOrder.id}/editing/start`).expect(200);
  try {
    const seenByAdmin = (await admin.get('/api/tickets').expect(200)).body.find(t => t.id === anaOrder.id);
    assert.equal(seenByAdmin.editing_by, 'ana');
    const seenByBoris = (await boris.get('/api/tickets').expect(200)).body.find(t => t.id === borisOrder.id);
    assert.equal(seenByBoris.editing_by, null);
  } finally {
    await ana.post(`/api/tickets/${anaOrder.id}/editing/stop`).expect(200);
  }
});
