// A database created by an early version of the app (before date_returned,
// comment, repair_performed, loaner_phone, pravim and kaparo existed) must
// be upgraded in place on startup, keeping its existing tickets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { loadApp, login } = require('./helpers');

const { app, db } = loadApp({
  beforeLoad(dataRoot) {
    fs.mkdirSync(path.join(dataRoot, 'data'));
    const old = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
    old.exec(`
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_no INTEGER UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        phone_contact TEXT NOT NULL,
        date_received TEXT NOT NULL,
        phone_model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'за сервиз',
        description TEXT NOT NULL,
        service_price REAL,
        customer_price REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description)
      VALUES (7, 'Стар клиент', '0888000000', '2024-01-15', 'iPhone 11', 'не зарежда');
    `);
    old.close();
  }
});

test('missing columns are added on startup', () => {
  const cols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
  for (const col of ['date_returned', 'comment', 'repair_performed', 'loaner_phone', 'pravim', 'kaparo']) {
    assert.ok(cols.includes(col), `column ${col}`);
  }
});

test('existing tickets survive and get sensible defaults', async () => {
  const agent = await login(request.agent(app));
  const [t] = (await agent.get('/api/tickets').expect(200)).body;
  assert.equal(t.ticket_no, 7);
  assert.equal(t.customer_name, 'Стар клиент');
  assert.equal(t.pravim, 'circle');
  assert.equal(t.date_returned, null);
});

test('new tickets continue numbering after the existing ones', async () => {
  const agent = await login(request.agent(app));
  const res = await agent.post('/api/tickets').send({
    customerName: 'Нов', phoneContact: '1', phoneModel: 'X', dateReceived: '2026-01-01', description: 'd'
  }).expect(201);
  assert.equal(res.body.ticket_no, 8);
});
