// Numbered migrations (migrations.js): each step runs once, recorded in
// PRAGMA user_version.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { loadApp } = require('./helpers');
const { migrate, MIGRATIONS } = require('../migrations');

const { db } = loadApp();
const version = d => d.pragma('user_version', { simple: true });

test('a new database ends up at the latest version', () => {
  assert.equal(version(db), MIGRATIONS.length);
  assert.deepEqual(migrate(db), [], 'nothing left to apply');
});

test('only the steps a database has not had yet are applied, in order', () => {
  const mem = new Database(':memory:');
  const ran = [];
  const step = name => ({ name, up: () => ran.push(name) });
  assert.deepEqual(migrate(mem, [step('a'), step('b')]), ['a', 'b']);
  assert.deepEqual(migrate(mem, [step('a'), step('b'), step('c')]), ['c']);
  assert.deepEqual(ran, ['a', 'b', 'c']);
  assert.equal(version(mem), 3);
});

test('a failing step is rolled back and the version stays before it', () => {
  const mem = new Database(':memory:');
  mem.exec('CREATE TABLE t (x INTEGER)');
  const steps = [
    { name: 'ok', up: d => d.exec('INSERT INTO t VALUES (1)') },
    { name: 'broken', up: d => { d.exec('INSERT INTO t VALUES (2)'); throw new Error('boom'); } }
  ];
  assert.throws(() => migrate(mem, steps), /boom/);
  assert.equal(version(mem), 1);
  assert.deepEqual(mem.prepare('SELECT x FROM t').all().map(r => r.x), [1]);
});

test('the shop\'s existing database (version 0, already up to date) starts cleanly and keeps its data', () => {
  const settingsBefore = db.prepare('SELECT data FROM settings').get().data;
  db.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description, loaner_phone)
    VALUES (9001, 'Стар клиент', '0888', '2025-01-01', 'iPhone', 'x', 'да')`).run();
  db.pragma('user_version = 0');

  migrate(db);
  assert.equal(version(db), MIGRATIONS.length);
  assert.equal(db.prepare('SELECT data FROM settings').get().data, settingsBefore);
  assert.equal(db.prepare('SELECT loaner_phone FROM tickets WHERE ticket_no = 9001').get().loaner_phone, 'да');
});

test('a step that has run is not repeated on later starts', () => {
  // The old loaner conversion used to run on every start.
  db.prepare("UPDATE tickets SET loaner_phone = 'iPhone 7' WHERE ticket_no = 9001").run();
  migrate(db);
  assert.equal(db.prepare('SELECT loaner_phone FROM tickets WHERE ticket_no = 9001').get().loaner_phone, 'iPhone 7');
});

test('a database newer than the app (after rolling back an update) still opens, with a warning', () => {
  const mem = new Database(':memory:');
  mem.pragma('user_version = 99');
  const warn = console.warn;
  let warned = '';
  console.warn = msg => { warned = msg; };
  try {
    assert.deepEqual(migrate(mem, [{ name: 'a', up() { throw new Error('should not run'); } }]), []);
  } finally {
    console.warn = warn;
  }
  assert.match(warned, /version 99/);
  assert.equal(version(mem), 99);
});
