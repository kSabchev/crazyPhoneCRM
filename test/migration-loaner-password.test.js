// Upgrading a database from before the "Парола" column and the да/не
// loaner phone: free-text loaner values are converted without losing the
// text, and the new column is made visible in the saved column list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { loadApp } = require('./helpers');

const OLD_COLUMNS = ['customer', 'model', 'issue', 'comment', 'loanerPhone', 'status'];

const { db } = loadApp({
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
        date_returned TEXT,
        phone_model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'за сервиз',
        description TEXT NOT NULL,
        comment TEXT,
        repair_performed TEXT,
        loaner_phone TEXT,
        pravim TEXT NOT NULL DEFAULT 'circle',
        kaparo REAL,
        service_price REAL,
        customer_price REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    const t = old.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description, comment, loaner_phone)
      VALUES (?, 'x', '1', '2026-01-01', 'm', 'd', ?, ?)`);
    t.run(1, '', 'Не');
    t.run(2, 'пази кутията', 'Samsung A10');
    t.run(3, null, '  Nokia  ');
    t.run(4, '', null);
    t.run(5, '', 'Да');
    t.run(6, '', '');
    old.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      shopName: 'Стар', statuses: ['за сервиз', 'издаден'], columns: OLD_COLUMNS,
      printCustomer: { header: 'h', footer: 'f' }, devices: []
    }));
    old.close();
  }
});

const byNo = no => db.prepare('SELECT * FROM tickets WHERE ticket_no = ?').get(no);

test('the phone_password column is added', () => {
  const cols = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
  assert.ok(cols.includes('phone_password'));
  assert.equal(byNo(1).phone_password, null);
});

test('"Не", empty and missing loaner values become "не"', () => {
  for (const no of [1, 4, 6]) assert.equal(byNo(no).loaner_phone, 'не', `#${no}`);
  assert.equal(byNo(1).comment, '');
});

test('"Да" becomes "да"', () => {
  assert.equal(byNo(5).loaner_phone, 'да');
});

test('a loaner model becomes "да" and its text is kept in the comment', () => {
  assert.equal(byNo(2).loaner_phone, 'да');
  assert.equal(byNo(2).comment, 'пази кутията\nОборотен телефон: Samsung A10');
  assert.equal(byNo(3).loaner_phone, 'да');
  assert.equal(byNo(3).comment, 'Оборотен телефон: Nokia');
});

test('the new Парола column is added to the saved visible columns, others untouched', () => {
  const s = JSON.parse(db.prepare('SELECT data FROM settings WHERE id = 1').get().data);
  assert.deepEqual(s.columns, [...OLD_COLUMNS, 'password']);
  assert.equal(s.shopName, 'Стар');
});

test('running the migration again changes nothing', () => {
  const before = db.prepare('SELECT id, loaner_phone, comment FROM tickets ORDER BY id').all();
  delete require.cache[require.resolve('../db')];
  const again = require('../db');
  const after = again.prepare('SELECT id, loaner_phone, comment FROM tickets ORDER BY id').all();
  assert.deepEqual(after, before);
  const s = JSON.parse(again.prepare('SELECT data FROM settings WHERE id = 1').get().data);
  assert.equal(s.columns.filter(c => c === 'password').length, 1);
});
