// Status badge colours, configurable in Settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login } = require('./helpers');

const { app, db } = loadApp();
let agent;
test.before(async () => {
  agent = await login(request.agent(app));
});

test('every status has a colour, with the built-in defaults', async () => {
  const s = (await agent.get('/api/settings').expect(200)).body;
  assert.deepEqual(Object.keys(s.statusColors), s.statuses);
  assert.equal(s.statusColors['за сервиз'], '#7C3AED');
  assert.equal(s.statusColors['забравен'], '#9A3412');
});

test('a shop whose saved settings predate colours still gets the defaults', async () => {
  const saved = JSON.parse(db.prepare('SELECT data FROM settings').get().data);
  delete saved.statusColors;
  db.prepare('UPDATE settings SET data = ?').run(JSON.stringify(saved));
  const s = (await agent.get('/api/settings')).body;
  assert.equal(s.statusColors['в сервиз'], '#DC2626');
});

test('a new status gets its chosen colour, or grey if none was sent', async () => {
  const before = (await agent.get('/api/settings')).body;
  const s = (await agent.put('/api/settings').send({
    statuses: [...before.statuses, 'чака части', 'на гаранция'],
    statusColors: { 'чака части': '#0EA5E9' }
  }).expect(200)).body;
  assert.equal(s.statusColors['чака части'], '#0EA5E9');
  assert.equal(s.statusColors['на гаранция'], '#6B7280');
  assert.equal((await agent.get('/api/settings')).body.statusColors['чака части'], '#0EA5E9');
});

test('a built-in status can be recoloured; other colours are kept', async () => {
  const s = (await agent.put('/api/settings').send({ statusColors: { 'в сервиз': '#123abc' } }).expect(200)).body;
  assert.equal(s.statusColors['в сервиз'], '#123abc');
  assert.equal(s.statusColors['чака части'], '#0EA5E9');
});

test('removing a status drops its colour', async () => {
  const before = (await agent.get('/api/settings')).body;
  const s = (await agent.put('/api/settings').send({
    statuses: before.statuses.filter(x => x !== 'на гаранция')
  }).expect(200)).body;
  assert.equal('на гаранция' in s.statusColors, false);
});

test('invalid colours are rejected', async () => {
  for (const statusColors of [{ 'в сервиз': 'red' }, { 'в сервиз': '#12345' }, { 'в сервиз': 5 }, ['#123456'], 'x']) {
    await agent.put('/api/settings').send({ statusColors }).expect(400);
  }
});
