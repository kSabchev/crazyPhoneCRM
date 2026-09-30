// Orders left in "чака клиент" for more than 30 days become "забравен".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const request = require('supertest');
const { ROOT, loadApp, login, makeDataRoot } = require('./helpers');
const { forgetStaleWaiting } = require('../auto-status');

const { app, db } = loadApp();
const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

let nextNo = 1;
// Creates an order and its history: `events` are [daysAgo, status] steps,
// the first being its creation.
function order(events, { receivedDaysAgo = 60 } = {}) {
  const no = nextNo++;
  const received = new Date(NOW - receivedDaysAgo * DAY).toISOString().slice(0, 10);
  const status = events.length ? events[events.length - 1][1] : 'чака клиент';
  const id = db.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description, status)
    VALUES (?, 'x', '0888', ?, 'm', 'd', ?)`).run(no, received, status).lastInsertRowid;
  const log = db.prepare(`INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at) VALUES (?, ?, ?, ?, 'tester', ?)`);
  events.forEach(([daysAgo, s], i) => {
    const prev = i > 0 ? events[i - 1][1] : null;
    if (i === 0) log.run(id, no, 'created', JSON.stringify({ status: s }), at(NOW - daysAgo * DAY));
    else log.run(id, no, 'updated', JSON.stringify({ status: { from: prev, to: s } }), at(NOW - daysAgo * DAY));
  });
  return { id, no };
}
const statusOf = o => db.prepare('SELECT status FROM tickets WHERE id = ?').get(o.id).status;

test('an order waiting for the customer for over 30 days becomes "забравен"', () => {
  const stale = order([[45, 'за сервиз'], [40, 'в сервиз'], [31, 'чака клиент']]);
  const recent = order([[45, 'за сервиз'], [29, 'чака клиент']]);
  const exactly30 = order([[45, 'за сервиз'], [30, 'чака клиент']]);

  const changed = forgetStaleWaiting(db, { now: NOW });
  assert.deepEqual(changed.map(c => c.ticketNo), [stale.no]);
  assert.equal(statusOf(stale), 'забравен');
  assert.equal(statusOf(recent), 'чака клиент');
  assert.equal(statusOf(exactly30), 'чака клиент');
});

test('the change is in the history, done by "автоматично"', () => {
  const o = order([[50, 'чака клиент']]);
  forgetStaleWaiting(db, { now: NOW });
  const last = db.prepare("SELECT * FROM audit_log WHERE ticket_id = ? ORDER BY id DESC LIMIT 1").get(o.id);
  assert.equal(last.action, 'updated');
  assert.equal(last.performed_by, 'автоматично');
  assert.deepEqual(JSON.parse(last.changes), { status: { from: 'чака клиент', to: 'забравен' } });
  assert.equal(last.performed_at, at(NOW));
});

test('the 30 days count from the latest move into "чака клиент"', () => {
  // Waited long ago, went back for more work, waiting again for 10 days.
  const o = order([[90, 'за сервиз'], [80, 'чака клиент'], [60, 'в сервиз'], [10, 'чака клиент']]);
  forgetStaleWaiting(db, { now: NOW });
  assert.equal(statusOf(o), 'чака клиент');
});

test('other edits (e.g. a comment) do not reset the 30 days', () => {
  const o = order([[40, 'чака клиент']]);
  db.prepare(`INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, ?, 'updated', ?, 'tester', ?)`).run(o.id, o.no, JSON.stringify({ comment: { from: '', to: 'обадих се' } }), at(NOW - 2 * DAY));
  forgetStaleWaiting(db, { now: NOW });
  assert.equal(statusOf(o), 'забравен');
});

test('orders in other statuses are never touched', () => {
  const others = ['за сервиз', 'в сервиз', 'издаден', 'отказан'].map(s => order([[100, s]]));
  forgetStaleWaiting(db, { now: NOW });
  assert.deepEqual(others.map(statusOf), ['за сервиз', 'в сервиз', 'издаден', 'отказан']);
});

test('an order without history falls back to its received date', () => {
  const old = order([], { receivedDaysAgo: 45 });
  const fresh = order([], { receivedDaysAgo: 5 });
  forgetStaleWaiting(db, { now: NOW });
  assert.equal(statusOf(old), 'забравен');
  assert.equal(statusOf(fresh), 'чака клиент');
});

test('running it again changes nothing more', () => {
  assert.deepEqual(forgetStaleWaiting(db, { now: NOW }), []);
});

test('the change shows up through the API like any other', async () => {
  const o = order([[35, 'чака клиент']]);
  assert.equal(app.runMaintenance().length >= 1, true);
  const agent = await login(request.agent(app));
  const history = (await agent.get(`/api/tickets/${o.id}/history`)).body;
  assert.equal(history[0].performed_by, 'автоматично');
  const row = (await agent.get('/api/tickets')).body.find(t => t.id === o.id);
  assert.equal(row.status, 'забравен');
});

test('server.js runs it on start', () => {
  const dataRoot = makeDataRoot();
  fs.mkdirSync(path.join(dataRoot, 'data'));
  // Let db.js create the schema, then add an order waiting since 40 days.
  process.env.DATA_ROOT = dataRoot;
  delete require.cache[require.resolve('../db')];
  const fresh = require('../db');
  const id = fresh.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description, status)
    VALUES (1, 'x', '0888', '2020-01-01', 'm', 'd', 'чака клиент')`).run().lastInsertRowid;
  fresh.prepare(`INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, 1, 'created', ?, 'tester', ?)`).run(id, JSON.stringify({ status: 'чака клиент' }), at(Date.now() - 40 * DAY));
  fresh.close();

  const res = spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, encoding: 'utf8', timeout: 6000,
    env: { ...process.env, DATA_ROOT: dataRoot, PORT: '0', SESSION_SECRET: 'x' }
  });
  assert.match(res.stdout, /Marked 1 order\(s\) as "забравен".*#1/);
  const check = new Database(path.join(dataRoot, 'data', 'repair-log.db'), { readonly: true });
  assert.equal(check.prepare('SELECT status FROM tickets WHERE id = ?').get(id).status, 'забравен');
  check.close();
});
