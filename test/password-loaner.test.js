// The customer's phone unlock code ("Парола") and the да/не loaner phone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app, db } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}
async function history(id) {
  return (await agent.get(`/api/tickets/${id}/history`)).body;
}

test('the unlock code is stored, trimmed, and returned with the ticket', async () => {
  const t = await create({ phonePassword: '  1234  ' });
  assert.equal(t.phone_password, '1234');
  const listed = (await agent.get('/api/tickets')).body.find(r => r.id === t.id);
  assert.equal(listed.phone_password, '1234');
});

test('an empty unlock code is stored as none', async () => {
  const t = await create({ phonePassword: '   ' });
  assert.equal(t.phone_password, null);
});

test('the unlock code is length-capped and must be text', async () => {
  await agent.post('/api/tickets').send(validTicket({ phonePassword: 'x'.repeat(101) })).expect(400);
  await agent.post('/api/tickets').send(validTicket({ phonePassword: 1234 })).expect(400);
});

test('the history never contains the unlock code itself', async () => {
  const t = await create({ phonePassword: 'secret-4321' });
  await agent.put(`/api/tickets/${t.id}`).send({ phonePassword: 'new-9876' }).expect(200);
  await agent.put(`/api/tickets/${t.id}`).send({ phonePassword: '' }).expect(200);

  const h = await history(t.id);
  const raw = db.prepare('SELECT changes FROM audit_log WHERE ticket_id = ?').all(t.id).map(r => r.changes).join(' ');
  assert.doesNotMatch(raw, /secret-4321|new-9876/);

  const created = h.find(e => e.action === 'created');
  assert.equal(created.changes.phone_password_set, true);
  const updates = h.filter(e => e.action === 'updated');
  assert.equal(updates.length, 2);
  for (const u of updates) assert.deepEqual(u.changes.phone_password, { changed: true });
});

test('an edit that leaves the unlock code alone does not mention it in the history', async () => {
  const t = await create({ phonePassword: '1111' });
  await agent.put(`/api/tickets/${t.id}`).send({ phonePassword: '1111', comment: 'x' }).expect(200);
  const update = (await history(t.id)).find(e => e.action === 'updated');
  assert.equal(update.changes.phone_password, undefined);
});

test('marking a ticket издаден clears the unlock code', async () => {
  const t = await create({ phonePassword: '1234' });
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'издаден' }).expect(200);
  assert.equal(res.body.phone_password, null);
  const update = (await history(t.id)).find(e => e.action === 'updated');
  assert.deepEqual(update.changes.phone_password, { changed: true });
});

test('it is cleared even if the full form sends the code along with издаден', async () => {
  const t = await create({ phonePassword: '1234' });
  const res = await agent.put(`/api/tickets/${t.id}`)
    .send({ ...validTicket(), status: 'издаден', phonePassword: '1234', loanerPhone: 'не' })
    .expect(200);
  assert.equal(res.body.phone_password, null);
});

test('other status changes keep the unlock code', async () => {
  const t = await create({ phonePassword: '1234' });
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'в сервиз' }).expect(200);
  assert.equal(res.body.phone_password, '1234');
});

test('a ticket created as издаден keeps no unlock code', async () => {
  const t = await create({ status: 'издаден', phonePassword: '1234' });
  assert.equal(t.phone_password, null);
});

test('the loaner phone is да or не, defaulting to не', async () => {
  assert.equal((await create()).loaner_phone, 'не');
  assert.equal((await create({ loanerPhone: 'да' })).loaner_phone, 'да');
  assert.equal((await create({ loanerPhone: ' Да ' })).loaner_phone, 'да');
  assert.equal((await create({ loanerPhone: '' })).loaner_phone, 'не');
});

test('any other loaner phone value is rejected', async () => {
  for (const v of ['Nokia 3310', 'yes', 42]) {
    const res = await agent.post('/api/tickets').send(validTicket({ loanerPhone: v }));
    assert.equal(res.status, 400, String(v));
    assert.match(res.body.error, /Оборотен телефон/);
  }
});

test('the password column is a selectable table column', async () => {
  const s = (await agent.put('/api/settings').send({ columns: ['customer', 'password'] }).expect(200)).body;
  assert.deepEqual(s.columns, ['customer', 'password']);
});
