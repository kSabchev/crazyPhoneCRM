// "отказан" (repair refused) and "забравен" (never collected) are closed
// statuses: not open work, but otherwise ordinary.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { buildReport } = require('../reports');

// An existing shop whose saved status list predates the new statuses and
// has a custom one added.
const OLD_STATUSES = ['за сервиз', 'в сервиз', 'чака части', 'чака клиент', 'издаден'];
const { app, db } = loadApp({
  beforeLoad(dataRoot) {
    fs.mkdirSync(path.join(dataRoot, 'data'));
    const old = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
    old.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    old.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      shopName: 'Стар', statuses: OLD_STATUSES, columns: ['customer', 'status'],
      printCustomer: { header: 'h', footer: 'f' }, devices: []
    }));
    old.close();
  }
});
const savedSettings = () => JSON.parse(db.prepare('SELECT data FROM settings WHERE id = 1').get().data);

let agent;
test.before(async () => {
  agent = await login(request.agent(app));
});

test('an existing shop gets the two new statuses added at the end, once', () => {
  assert.deepEqual(savedSettings().statuses, [...OLD_STATUSES, 'отказан', 'забравен']);
  assert.equal(savedSettings().addedClosedStatuses, true);
});

test('they are built-in statuses and can no longer be removed', async () => {
  const res = await agent.put('/api/settings').send({ statuses: OLD_STATUSES }).expect(400);
  assert.match(res.body.error, /„отказан“ е системен/);
  assert.deepEqual(savedSettings().statuses, [...OLD_STATUSES, 'отказан', 'забравен']);
});

test('the new statuses can be set, and do not auto-fill the return date', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket()).expect(201)).body;
  for (const status of ['отказан', 'забравен']) {
    const res = await agent.put(`/api/tickets/${t.id}`).send({ status }).expect(200);
    assert.equal(res.body.status, status);
    assert.equal(res.body.date_returned, null);
  }
});

test('reports do not count refused or forgotten orders as open work', () => {
  db.exec('DELETE FROM tickets');
  const add = db.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description, status)
    VALUES (?, 'x', '0888', '2026-09-01', 'm', 'd', ?)`);
  add.run(1, 'в сервиз');
  add.run(2, 'чака части');
  add.run(3, 'отказан');
  add.run(4, 'забравен');
  add.run(5, 'издаден');

  const w = buildReport(db, { from: '2026-09-01', to: '2026-09-30', today: '2026-09-30' }).workload;
  assert.equal(w.openCount, 2);
  assert.deepEqual(w.byStatus.map(s => s.status).sort(), ['в сервиз', 'чака части']);
});
