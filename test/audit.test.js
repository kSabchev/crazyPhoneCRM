const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

test('creating a ticket records a "created" entry with a full snapshot', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket({ servicePrice: 25 }))).body;
  const history = (await agent.get(`/api/tickets/${t.id}/history`).expect(200)).body;

  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'created');
  assert.equal(history[0].performed_by, 'tester');
  assert.equal(history[0].ticket_no, t.ticket_no);
  assert.equal(history[0].changes.customer_name, 'Иван Петров');
  assert.equal(history[0].changes.service_price, 25);
});

test('an update records only the fields that actually changed', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.put(`/api/tickets/${t.id}`)
    .send({ status: 'издаден', customerName: t.customer_name })
    .expect(200);

  const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
  const update = history.find(h => h.action === 'updated');
  assert.deepEqual(update.changes, { status: { from: 'за сервиз', to: 'издаден' } });
});

test('an update that changes nothing adds no audit entry', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.put(`/api/tickets/${t.id}`).send({ status: t.status }).expect(200);
  const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
  assert.equal(history.length, 1);
});

test('deleting a ticket is recorded in the global audit log', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket({ customerName: 'Изтрит' }))).body;
  await agent.delete(`/api/tickets/${t.id}`).expect(200);

  const audit = (await agent.get('/api/audit').expect(200)).body;
  const entry = audit.find(a => a.action === 'deleted' && a.ticket_no === t.ticket_no);
  assert.ok(entry, 'deleted entry present');
  assert.equal(entry.changes.customer_name, 'Изтрит');
  assert.equal(entry.performed_by, 'tester');
});

test('history for an unknown ticket returns 404', async () => {
  await agent.get('/api/tickets/999999/history').expect(404);
});
