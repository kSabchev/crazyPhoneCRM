const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

test('default settings are seeded on first run', async () => {
  const s = (await agent.get('/api/settings').expect(200)).body;
  assert.equal(s.shopName, 'CrazyPhone');
  assert.deepEqual(s.statuses, ['за сервиз', 'в сервиз', 'чака клиент', 'издаден']);
  assert.ok(s.columns.includes('callBtn'));
  assert.ok(s.printCustomer.header);
  assert.ok(s.devices.length > 0);
});

test('saved settings persist and are trimmed/deduplicated', async () => {
  await agent.put('/api/settings').send({
    shopName: '  Нов сервиз  ',
    statuses: ['приет', ' приет ', '', 'готов'],
    devices: ['Zeta', 'Alpha', 'Alpha']
  }).expect(200);

  const s = (await agent.get('/api/settings')).body;
  assert.equal(s.shopName, 'Нов сервиз');
  assert.deepEqual(s.statuses, ['приет', 'готов']);
  assert.deepEqual(s.devices, ['Alpha', 'Zeta']);
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

test('only header and footer of the customer print template are editable', async () => {
  const s = (await agent.put('/api/settings')
    .send({ printCustomer: { header: 'КАРТА', footer: 'текст', extra: 'x' } })
    .expect(200)).body;
  assert.deepEqual(s.printCustomer, { header: 'КАРТА', footer: 'текст' });
});

test('an empty shop name or empty status list is rejected', async () => {
  await agent.put('/api/settings').send({ shopName: '   ' }).expect(400);
  await agent.put('/api/settings').send({ statuses: ['', '  '] }).expect(400);
});
