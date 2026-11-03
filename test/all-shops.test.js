// The admins' all-shops view: every shop's orders together, editable, each
// with its shop; combined activity log and reports. Two shops whose orders
// have the same ids, so an edit reaching the wrong shop would show.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const bcrypt = require('bcrypt');
const STATUSES = require('../public/statuses');
const { loadApp, login, validTicket } = require('./helpers');
const { startFakeGateway } = require('./fake-sms-gateway');

const { app, systemDb } = loadApp(); // seeds "tester" (admin)
const stores = require('../lib/stores');
const center = stores.defaultStore();
const lozenets = stores.create({ name: 'Магазин Лозенец', prefix: 'Л' });
systemDb.prepare("INSERT INTO users (username, password_hash, role, store_id) VALUES ('boris', ?, 'staff', ?)")
  .run(bcrypt.hashSync('secret123', 4), lozenets.id);

let server, base, gw, all, inCenter, boris, centerOrder, lozenetsOrder;

test.before(async () => {
  gw = await startFakeGateway();
  process.env.SMS_GATEWAY_URL = gw.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  inCenter = await login(request.agent(base));
  boris = await login(request.agent(base), 'boris');
  centerOrder = (await inCenter.post('/api/tickets').send(validTicket({ customerName: 'Клиент Център', phoneModel: 'Nokia 3310' })).expect(201)).body;
  lozenetsOrder = (await boris.post('/api/tickets').send(validTicket({ customerName: 'Клиент Лозенец', phoneModel: 'Pixel 9' })).expect(201)).body;
  all = await login(request.agent(base));
  const me = (await all.post('/api/auth/store').send({ storeId: 'all' }).expect(200)).body;
  assert.equal(me.allShops, true);
});

test.after(() => {
  server.closeAllConnections();
  server.close();
  gw.close();
  for (const k of ['SMS_GATEWAY_URL', 'SMS_GATEWAY_USER', 'SMS_GATEWAY_PASSWORD']) delete process.env[k];
});

const listOf = async agent => (await agent.get('/api/tickets').expect(200)).body;
const byName = (list, name) => list.find(t => t.customer_name === name);

test('the all-shops view lists every shop\'s orders, each with its shop in the id', async () => {
  assert.equal(centerOrder.id, lozenetsOrder.id, 'the same id in both shops');
  const list = await listOf(all);
  const c = byName(list, 'Клиент Център');
  const l = byName(list, 'Клиент Лозенец');
  assert.equal(c.id, `${center.id}:${centerOrder.id}`);
  assert.equal(l.id, `${lozenets.id}:${lozenetsOrder.id}`);
  assert.deepEqual([l.store_id, l.store_name, l.store_prefix], [lozenets.id, 'Магазин Лозенец', 'Л']);
  // Elsewhere ids stay plain, with the shop alongside.
  const own = await listOf(boris);
  assert.deepEqual(own.map(t => [t.id, t.store_prefix]), [[lozenetsOrder.id, 'Л']]);
  assert.equal((await all.get('/api/auth/me')).body.allShops, true);
});

test('orders are edited in their own shop from the all-shops view', async () => {
  const id = `${lozenets.id}:${lozenetsOrder.id}`;
  const updated = (await all.put(`/api/tickets/${id}`).send({ comment: 'от всички' }).expect(200)).body;
  assert.equal(updated.id, id);
  assert.equal(lozenets.tickets.get(lozenetsOrder.id).comment, 'от всички');
  assert.equal(center.tickets.get(centerOrder.id).comment, '');

  const history = (await all.get(`/api/tickets/${id}/history`).expect(200)).body;
  assert.ok(history.some(h => h.changes.comment && h.changes.comment.to === 'от всички'));
  // The change is in the shop's own history, seen by its staff.
  const seen = (await boris.get(`/api/tickets/${lozenetsOrder.id}/history`).expect(200)).body;
  assert.equal(seen[0].performed_by, 'tester');

  const label = await all.get(`/api/tickets/${id}/service-label.lbx`).expect(200);
  assert.match(label.headers['content-disposition'], /poruchka-%D0%9B-1\.lbx|poruchka-Л-1\.lbx/);

  await all.put('/api/tickets/9:1').send({ comment: 'x' }).expect(404);
  await all.put(`/api/tickets/${lozenets.id}:999`).send({ comment: 'x' }).expect(404);
});

test('shop accounts can\'t reach another shop through such ids', async () => {
  await boris.put(`/api/tickets/${center.id}:${centerOrder.id}`).send({ comment: 'x' }).expect(404);
  await boris.get(`/api/tickets/${center.id}:${centerOrder.id}/history`).expect(404);
  await boris.post(`/api/tickets/${center.id}:${centerOrder.id}/editing/start`).expect(404);
  await boris.post('/api/auth/store').send({ storeId: 'all' }).expect(403);
  assert.equal(center.tickets.get(centerOrder.id).comment, '');
});

test('a new order in the all-shops view goes to the shop chosen for it', async () => {
  const missing = await all.post('/api/tickets').send(validTicket()).expect(400);
  assert.match(missing.body.error, /Изберете магазин/);
  await all.post('/api/tickets').send(validTicket({ storeId: 999 })).expect(400);

  const created = (await all.post('/api/tickets').send(validTicket({ customerName: 'Нов в Лозенец', storeId: lozenets.id })).expect(201)).body;
  assert.match(created.id, new RegExp(`^${lozenets.id}:\\d+$`));
  assert.equal(created.store_name, 'Магазин Лозенец');
  assert.ok(byName(await listOf(boris), 'Нов в Лозенец'));
  // A shop's own page ignores storeId: its orders stay in its shop.
  await inCenter.post('/api/tickets').send(validTicket({ customerName: 'Остава в Център', storeId: lozenets.id })).expect(201);
  assert.ok(!byName(await listOf(boris), 'Остава в Център'));
});

test('deleting from the all-shops view deletes in the order\'s shop', async () => {
  const t = (await boris.post('/api/tickets').send(validTicket({ customerName: 'За триене' })).expect(201)).body;
  await all.delete(`/api/tickets/${lozenets.id}:${t.id}`).expect(200);
  assert.equal(lozenets.tickets.get(t.id), null);
  assert.ok(center.tickets.get(t.id) === null || center.tickets.get(t.id).customer_name !== 'За триене');
});

test('"who\'s viewing" from the all-shops view shows in the order\'s shop', async () => {
  const id = `${lozenets.id}:${lozenetsOrder.id}`;
  await all.post(`/api/tickets/${id}/editing/start`).expect(200);
  try {
    assert.equal(byName(await listOf(boris), 'Клиент Лозенец').editing_by, 'tester');
    assert.equal(byName(await listOf(inCenter), 'Клиент Център').editing_by, null);
  } finally {
    await all.post(`/api/tickets/${id}/editing/stop`).expect(200);
  }
});

test('SMS from the all-shops view use the order\'s shop, with its prefixed number', async () => {
  await all.put('/api/settings').send({}).expect(200); // nothing changes
  const id = `${lozenets.id}:${lozenetsOrder.id}`;
  const preview = (await all.get(`/api/tickets/${id}/sms/preview`).expect(200)).body;
  assert.match(preview.text, /№Л-1\b/);
  assert.match(preview.text, /Магазин Лозенец/);
  const sent = (await all.post(`/api/tickets/${id}/sms`).send({}).expect(201)).body;
  assert.equal(lozenets.db.prepare('SELECT COUNT(*) n FROM sms_messages WHERE id = ?').get(sent.id).n, 1);
  assert.equal((await all.get(`/api/tickets/${id}/sms`).expect(200)).body.length, 1);
});

test('the activity log combines every shop, newest first, each with its shop', async () => {
  const entries = (await all.get('/api/audit').expect(200)).body;
  const shops = new Set(entries.map(e => e.store_name));
  assert.ok(shops.has('CrazyPhone') && shops.has('Магазин Лозенец'));
  const times = entries.map(e => e.performed_at);
  assert.deepEqual(times, [...times].sort().reverse());
  // A shop's own log has only its own.
  assert.ok((await boris.get('/api/audit').expect(200)).body.every(e => e.store_name === 'Магазин Лозенец'));
});

test('settings in the all-shops view carry every shop\'s own, for printing', async () => {
  await boris.get('/api/settings').expect(200);
  const s = (await all.get('/api/settings').expect(200)).body;
  assert.equal(s.shops[lozenets.id].shopName, 'Магазин Лозенец');
  assert.equal(s.shops[center.id].shopName, 'CrazyPhone');
  assert.equal((await inCenter.get('/api/settings')).body.shops, undefined);
  // Phone-model suggestions learn from every shop.
  const devices = (await all.get('/api/devices').expect(200)).body;
  assert.ok(devices.includes('Pixel 9') && devices.includes('Nokia 3310'));
});

test('reports in the all-shops view add up every shop', async () => {
  await inCenter.post('/api/tickets').send(validTicket({ status: STATUSES.COMPLETED, customerPrice: '100', servicePrice: '40' })).expect(201);
  await boris.post('/api/tickets').send(validTicket({ status: STATUSES.COMPLETED, customerPrice: '50', servicePrice: '10' })).expect(201);

  const one = (await inCenter.get('/api/reports').expect(200)).body;
  const other = (await boris.get('/api/reports').catch(() => null));
  assert.equal(other.status, 403, 'staff: no reports');
  const combined = (await all.get('/api/reports').expect(200)).body;
  assert.equal(one.revenue.totals.revenue, 100);
  assert.equal(combined.revenue.totals.revenue, 150);
  assert.equal(combined.revenue.totals.profit, 100);
  assert.equal(combined.revenue.totals.returned, 2);
  // Open orders from both shops, numbered with their prefix.
  const open = JSON.stringify(combined.workload);
  assert.match(open, /"ticketNo":"Л-1"/);
  assert.match(open, /Клиент Център/);
});

test('the all-shops view hears about changes in every shop', async () => {
  const stream = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { Cookie: all.sessionCookie } }, res => {
      const messages = [];
      res.setEncoding('utf8');
      res.on('data', chunk => { for (const line of chunk.split('\n')) if (line.startsWith('data: ')) messages.push(line.slice(6)); });
      resolve({ messages, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
  try {
    await boris.put(`/api/tickets/${lozenetsOrder.id}`).send({ comment: 'а' }).expect(200);
    await new Promise(r => setTimeout(r, 150));
    await inCenter.put(`/api/tickets/${centerOrder.id}`).send({ comment: 'б' }).expect(200);
    await new Promise(r => setTimeout(r, 150));
    assert.deepEqual(stream.messages, ['tickets', 'tickets']);
  } finally {
    stream.close();
  }
});

test('picking one shop leaves the all-shops view', async () => {
  const agent = await login(request.agent(base));
  await agent.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  const me = (await agent.post('/api/auth/store').send({ storeId: lozenets.id }).expect(200)).body;
  assert.equal(me.allShops, false);
  const list = await listOf(agent);
  assert.ok(list.every(t => t.store_id === lozenets.id && typeof t.id === 'number'));
});

test('an admin demoted to staff while in the all-shops view only sees their shop', async () => {
  systemDb.prepare("INSERT INTO users (username, password_hash, role) VALUES ('temp-admin', ?, 'admin')").run(bcrypt.hashSync('secret123', 4));
  const agent = await login(request.agent(base), 'temp-admin');
  await agent.post('/api/auth/store').send({ storeId: 'all' }).expect(200);
  systemDb.prepare("UPDATE users SET role = 'staff', store_id = ? WHERE username = 'temp-admin'").run(lozenets.id);
  const list = await listOf(agent);
  assert.ok(list.length > 0 && list.every(t => t.store_id === lozenets.id), JSON.stringify(list.map(t => t.store_name)));
});

test('the combined reports database keeps ids unique across shops, so joins stay within a shop', () => {
  const { combinedDb } = require('../lib/combined-db');
  const db = combinedDb(stores.all());
  try {
    const t = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT id) d FROM tickets').get();
    assert.equal(t.n, t.d);
    assert.ok(t.n >= 2);
    // Every history entry joins to an order of its own shop.
    const a = db.prepare(`SELECT COUNT(*) n FROM audit_log a JOIN tickets t ON t.id = a.ticket_id
      WHERE a.store_prefix <> t.store_prefix`).get();
    assert.equal(a.n, 0);
  } finally {
    db.close();
  }
});
