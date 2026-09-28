// Marking a ticket "издаден" sets its return date to today, unless one is
// already set or sent with the change.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

// Same local-date rule as the server.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}

test('changing the status to издаден sets the return date to today', async () => {
  const t = await create();
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'издаден' }).expect(200);
  assert.equal(res.body.date_returned, today());
});

test('the auto-set date is recorded in the history', async () => {
  const t = await create();
  await agent.put(`/api/tickets/${t.id}`).send({ status: 'издаден' }).expect(200);
  const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
  const update = history.find(h => h.action === 'updated');
  assert.deepEqual(update.changes.date_returned, { from: null, to: today() });
});

test('the full edit form with an empty return date also gets today', async () => {
  const t = await create();
  const res = await agent.put(`/api/tickets/${t.id}`)
    .send({ ...validTicket(), status: 'издаден', dateReturned: '' })
    .expect(200);
  assert.equal(res.body.date_returned, today());
});

test('a return date sent with the change is kept', async () => {
  const t = await create();
  const res = await agent.put(`/api/tickets/${t.id}`)
    .send({ status: 'издаден', dateReturned: '2026-09-01' })
    .expect(200);
  assert.equal(res.body.date_returned, '2026-09-01');
});

test('an existing return date is not overwritten', async () => {
  const t = await create({ dateReturned: '2026-08-15' });
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'издаден' }).expect(200);
  assert.equal(res.body.date_returned, '2026-08-15');
});

test('other status changes leave the return date alone', async () => {
  const t = await create();
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'чака клиент' }).expect(200);
  assert.equal(res.body.date_returned, null);
});

test('clearing the date on a ticket that is already издаден is respected', async () => {
  const t = await create();
  await agent.put(`/api/tickets/${t.id}`).send({ status: 'издаден' }).expect(200);
  const res = await agent.put(`/api/tickets/${t.id}`)
    .send({ status: 'издаден', dateReturned: '' })
    .expect(200);
  assert.equal(res.body.date_returned, null);
});

test('a ticket created as издаден gets today as its return date', async () => {
  const t = await create({ status: 'издаден' });
  assert.equal(t.date_returned, today());
});
