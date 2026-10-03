const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login } = require('./helpers');

const { app, db } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

test('default settings are seeded on first run', async () => {
  const s = (await agent.get('/api/settings').expect(200)).body;
  assert.equal(s.shopName, 'CrazyPhone');
  assert.deepEqual(s.statuses, ['за сервиз', 'в сервиз', 'чака клиент', 'издаден', 'отказан', 'забравен']);
  assert.ok(s.columns.includes('callBtn'));
  assert.match(s.printCustomer.footer, /3 МЕСЕЦА ГАРАНЦИЯ/);
  assert.ok(s.devices.length > 0);
});

test('saved settings persist and are trimmed/deduplicated', async () => {
  const SYSTEM = require('../public/statuses').SYSTEM;
  await agent.put('/api/settings').send({
    shopName: '  Нов сервиз  ',
    statuses: ['приет', ' приет ', '', ...SYSTEM, 'готов', ' готов'],
    devices: ['Zeta', 'Alpha', 'Alpha']
  }).expect(200);

  const s = (await agent.get('/api/settings')).body;
  assert.equal(s.shopName, 'Нов сервиз');
  assert.deepEqual(s.statuses, ['приет', ...SYSTEM, 'готов']);
  assert.deepEqual(s.devices, ['Alpha', 'Zeta']);
  await agent.put('/api/settings').send({ statuses: [...SYSTEM] }).expect(200);
});

test('built-in statuses can be reordered but not removed', async () => {
  const SYSTEM = require('../public/statuses').SYSTEM;
  const reordered = [...SYSTEM].reverse();
  const s = (await agent.put('/api/settings').send({ statuses: reordered }).expect(200)).body;
  assert.deepEqual(s.statuses, reordered);

  for (const removed of SYSTEM) {
    const res = await agent.put('/api/settings').send({ statuses: SYSTEM.filter(x => x !== removed) }).expect(400);
    assert.match(res.body.error, new RegExp(`„${removed}“ е системен и не може да бъде премахнат`));
  }
  // Renaming is removing + adding, so it's refused too.
  await agent.put('/api/settings')
    .send({ statuses: SYSTEM.map(x => x === 'чака клиент' ? 'Чака клиент' : x) }).expect(400);
  await agent.put('/api/settings').send({ statuses: [...SYSTEM] }).expect(200);
});

test('a shop that removed a built-in status earlier gets it back', async () => {
  const SYSTEM = require('../public/statuses').SYSTEM;
  const row = JSON.parse(db.prepare('SELECT data FROM settings WHERE id = 1').get().data);
  row.statuses = ['за сервиз', 'в сервиз', 'издаден', 'чака части']; // no чака клиент, отказан, забравен
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(row));

  const s = (await agent.get('/api/settings')).body;
  assert.deepEqual(s.statuses, ['за сервиз', 'в сервиз', 'издаден', 'чака части', 'чака клиент', 'отказан', 'забравен']);
  // ...and the settings page can save again (it sends what it got).
  await agent.put('/api/settings').send({ statuses: s.statuses }).expect(200);
  for (const x of SYSTEM) assert.ok(s.statuses.includes(x));
});

test('unknown column keys are dropped', async () => {
  const s = (await agent.put('/api/settings').send({ columns: ['customer', 'hacked', 'status'] }).expect(200)).body;
  assert.deepEqual(s.columns, ['customer', 'status']);
});

test('fields not sent are left unchanged', async () => {
  const before = (await agent.get('/api/settings')).body;
  await agent.put('/api/settings').send({ shopTagline: 'нов слоган' }).expect(200);
  const after = (await agent.get('/api/settings')).body;
  assert.equal(after.shopTagline, 'нов слоган');
  assert.equal(after.shopName, before.shopName);
  assert.deepEqual(after.statuses, before.statuses);
});

test('only the footer of the customer print template is editable', async () => {
  const s = (await agent.put('/api/settings')
    .send({ printCustomer: { header: 'КАРТА', footer: 'текст', extra: 'x' } })
    .expect(200)).body;
  assert.deepEqual(s.printCustomer, { footer: 'текст' });
});

test('the shop phone comes from SHOP_PHONE and is never saved', async () => {
  process.env.SHOP_PHONE = ' 0888 123 456 ';
  try {
    const s = (await agent.get('/api/settings')).body;
    assert.equal(s.shopPhone, '0888 123 456');
    // Sending it back (the settings page saves the whole object) doesn't store it.
    await agent.put('/api/settings').send({ ...s, shopPhone: 'hacked' }).expect(200);
    delete process.env.SHOP_PHONE;
    assert.equal((await agent.get('/api/settings')).body.shopPhone, '');
  } finally {
    delete process.env.SHOP_PHONE;
  }
});

test('an empty shop name or empty status list is rejected', async () => {
  await agent.put('/api/settings').send({ shopName: '   ' }).expect(400);
  await agent.put('/api/settings').send({ statuses: ['', '  '] }).expect(400);
});
