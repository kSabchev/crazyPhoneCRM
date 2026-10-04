// Every change to an order is announced (lib/ticket-events.js), and the
// side effects — history, live updates — follow from that in one place
// (lib/ticket-listeners.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { ticketEvents } = require('../lib/ticket-events');
const { forgetStaleWaiting } = require('../auto-status');

const { app, db } = loadApp();
let server, base, agent;

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  agent = await login(request.agent(base));
});
test.after(() => {
  server.closeAllConnections();
  server.close();
});

// Records the events emitted while `fn` runs.
async function captured(fn) {
  const seen = [];
  const names = ['created', 'updated', 'deleted', 'sms', 'smsStates'];
  const handlers = names.map(name => [name, payload => seen.push({ name, ...payload })]);
  for (const [name, h] of handlers) ticketEvents.on(name, h);
  try { await fn(); } finally { for (const [name, h] of handlers) ticketEvents.off(name, h); }
  return seen;
}

test('creating, editing and deleting an order each announce it, with who did it', async () => {
  let id;
  const created = await captured(async () => {
    id = (await agent.post('/api/tickets').send(validTicket()).expect(201)).body.id;
  });
  assert.deepEqual(created.map(e => [e.name, e.after.id, e.user]), [['created', id, 'tester']]);

  const updated = await captured(() => agent.put(`/api/tickets/${id}`).send({ comment: 'ново' }).expect(200));
  assert.equal(updated.length, 1);
  assert.equal(updated[0].before.comment, '');
  assert.equal(updated[0].after.comment, 'ново');

  const deleted = await captured(() => agent.delete(`/api/tickets/${id}`).expect(200));
  assert.deepEqual(deleted.map(e => [e.name, e.before.id]), [['deleted', id]]);
});

test('the history follows from the events, not from each route', () => {
  const before = { id: 777, ticket_no: 777, comment: 'а' };
  ticketEvents.emit('updated', { before, after: { ...before, comment: 'б' }, user: 'някой', at: '2026-01-02 03:04:05' });
  const row = db.prepare("SELECT * FROM audit_log WHERE ticket_id = 777").get();
  assert.equal(row.performed_by, 'някой');
  assert.equal(row.performed_at, '2026-01-02 03:04:05');
  assert.deepEqual(JSON.parse(row.changes), { comment: { from: 'а', to: 'б' } });

  // An "edit" that changed nothing isn't recorded.
  ticketEvents.emit('updated', { before, after: { ...before }, user: 'някой' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE ticket_id = 777').get().n, 1);
});

// Counts the "tickets" live messages an open screen receives in `ms`.
function countLiveMessages(ms, during) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { Cookie: agent.sessionCookie } }, res => {
      let count = 0;
      res.setEncoding('utf8');
      res.on('data', chunk => { count += (chunk.match(/^data: tickets$/gm) || []).length; });
      // Give the stream a moment to open, then make the changes.
      setTimeout(async () => {
        await during();
        setTimeout(() => { req.destroy(); resolve(count); }, ms);
      }, 100);
    });
    req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
  });
}

test('several orders changed at once (the hourly job) refresh open screens once', async () => {
  const old = Date.parse('2026-01-01T00:00:00Z');
  for (let i = 0; i < 3; i++) {
    await agent.post('/api/tickets').send(validTicket({ status: 'чака клиент', dateReceived: '2025-11-01' })).expect(201);
  }
  // Their history says they've been waiting since long ago.
  db.prepare("UPDATE audit_log SET performed_at = '2025-11-01 10:00:00' WHERE action = 'created'").run();

  let changed;
  const messages = await countLiveMessages(300, () => { changed = forgetStaleWaiting(db, { now: old }); });
  assert.ok(changed.length >= 3, `changed ${changed.length}`);
  assert.equal(messages, 1);
});
