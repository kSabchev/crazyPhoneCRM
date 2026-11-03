// Settings with several shops: statuses, their colours, the table columns
// and the phone-model list are shared by every shop; name, tagline, phone,
// the customer-print footer and the SMS text are each shop's own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { loadApp, login } = require('./helpers');

const { app, systemDb } = loadApp(); // seeds "tester" (admin)
const stores = require('../lib/stores');
const center = stores.defaultStore();
const lozenets = stores.create({ name: 'Магазин Лозенец', prefix: 'Л' });
systemDb.prepare("INSERT INTO users (username, password_hash, role, store_id) VALUES ('boris', ?, 'staff', ?)")
  .run(bcrypt.hashSync('secret123', 4), lozenets.id);

let server, base, inCenter, inLozenets, boris;

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  inCenter = await login(request.agent(base));
  inLozenets = await login(request.agent(base));
  await inLozenets.post('/api/auth/store').send({ storeId: lozenets.id }).expect(200);
  boris = await login(request.agent(base), 'boris');
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

const settingsOf = async agent => (await agent.get('/api/settings').expect(200)).body;

test('statuses, colours, columns and phone models are the same in every shop', async () => {
  const s = await settingsOf(inCenter);
  await inCenter.put('/api/settings').send({
    statuses: [...s.statuses, 'чака части'],
    statusColors: { 'чака части': '#123456' },
    columns: ['customer', 'status'],
    devices: ['Nokia 3310']
  }).expect(200);

  for (const agent of [inLozenets, boris]) {
    const other = await settingsOf(agent);
    assert.ok(other.statuses.includes('чака части'));
    assert.equal(other.statusColors['чака части'], '#123456');
    assert.deepEqual(other.columns, ['customer', 'status']);
    assert.deepEqual(other.devices, ['Nokia 3310']);
  }
  // Saved once, in system.db.
  const shared = JSON.parse(systemDb.prepare('SELECT data FROM shared_settings').get().data);
  assert.ok(shared.statuses.includes('чака части'));
  assert.deepEqual(Object.keys(shared).sort(), ['columns', 'devices', 'statusColors', 'statuses']);
});

test('name, tagline, phone, print footer and SMS text are each shop\'s own', async () => {
  await inCenter.put('/api/settings').send({
    shopTagline: 'център', phone: '02 111 1111', printCustomer: { footer: 'долу център' }, smsTemplate: 'Център {номер}'
  }).expect(200);
  await inLozenets.put('/api/settings').send({ shopTagline: 'лозенец', smsTemplate: 'Лозенец {номер}' }).expect(200);

  const c = await settingsOf(inCenter);
  const l = await settingsOf(boris);
  assert.deepEqual([c.shopName, c.shopTagline, c.shopPhone, c.printCustomer.footer, c.smsTemplate],
    ['CrazyPhone', 'център', '02 111 1111', 'долу център', 'Център {номер}']);
  assert.equal(l.shopName, 'Магазин Лозенец');
  assert.equal(l.shopTagline, 'лозенец');
  assert.equal(l.shopPhone, '');
  assert.equal(l.smsTemplate, 'Лозенец {номер}');
  assert.notEqual(l.printCustomer.footer, 'долу център');
});

test('renaming a shop renames it in the shop picker too', async () => {
  await inLozenets.put('/api/settings').send({ shopName: 'Лозенец 2' }).expect(200);
  const me = (await inCenter.get('/api/auth/me').expect(200)).body;
  assert.deepEqual(me.stores.map(s => s.name), ['CrazyPhone', 'Лозенец 2']);
  assert.equal((await boris.get('/api/auth/me')).body.store.name, 'Лозенец 2');
  await inLozenets.put('/api/settings').send({ shopName: 'Магазин Лозенец' }).expect(200);
});

test('shop accounts still can\'t save settings', async () => {
  await boris.put('/api/settings').send({ shopTagline: 'x' }).expect(403);
});

// ---- Live updates ----

function openStream(agent) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { Cookie: agent.sessionCookie } }, res => {
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

test('a change to shared settings reaches every shop; a shop\'s own only that shop', async () => {
  const centerScreen = await openStream(inCenter);
  const lozenetsScreen = await openStream(boris);
  try {
    await inCenter.put('/api/settings').send({ shopTagline: 'само център' }).expect(200);
    await settle();
    assert.deepEqual(centerScreen.messages, ['settings']);
    assert.deepEqual(lozenetsScreen.messages, []);

    // The settings page sends everything; unchanged shared settings don't
    // disturb the other shops.
    const s = await settingsOf(inCenter);
    await inCenter.put('/api/settings').send(s).expect(200);
    await settle();
    assert.deepEqual(lozenetsScreen.messages, []);

    await inCenter.put('/api/settings').send({ devices: ['Pixel 9'] }).expect(200);
    await settle();
    assert.deepEqual(centerScreen.messages, ['settings', 'settings', 'settings']);
    assert.deepEqual(lozenetsScreen.messages, ['settings']);
  } finally {
    centerScreen.close();
    lozenetsScreen.close();
  }
});
