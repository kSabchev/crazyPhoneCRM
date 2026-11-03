// The start of multi-shop support: accounts, shops and sessions in
// system.db, each shop's orders in its own database, and the existing
// data/repair-log.db taken over as the first shop on upgrade.
//
// Each scenario runs in its own process and data folder: system.db is set
// up once per process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { ROOT, makeDataRoot, runScript } = require('./helpers');

// Runs `code` in a fresh node process with DATA_ROOT set; its last line of
// output is parsed as JSON.
function inProcess(dataRoot, code) {
  const res = spawnSync(process.execPath, ['-e', code], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_ROOT: dataRoot, NAS_BACKUP_DIR: '' }
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const SNAPSHOT = `
  const stores = require('./lib/stores');
  const systemDb = require('./lib/system-db');
  const shop = stores.defaultStore();
  console.log(JSON.stringify({
    shops: systemDb.prepare('SELECT id, name, prefix, db_file, sms FROM stores').all(),
    users: systemDb.prepare('SELECT id, username, role, store_id FROM users ORDER BY id').all(),
    orders: shop.tickets.list().map(t => t.customer_name),
    shopTables: shop.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name)
  }));`;

// An installation from before shops existed: accounts and orders in
// data/repair-log.db.
function oldInstallation() {
  const dataRoot = makeDataRoot();
  fs.mkdirSync(path.join(dataRoot, 'data'));
  const old = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  old.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(3, 'owner', bcrypt.hashSync('ownerpass1', 4), 'admin');
  old.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(7, 'helper', bcrypt.hashSync('helperpass1', 4), 'staff');
  old.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify({ ...require('../default-settings'), shopName: 'Магазин Център' }));
  old.close();
  // Let the shop schema add the order tables, then put an order in.
  const shop = require('../lib/shop-db').openShopDb(path.join(dataRoot, 'data', 'repair-log.db'));
  shop.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description)
    VALUES (1, 'Стар клиент', '0888123456', '2026-01-05', 'iPhone 12', 'дисплей')`).run();
  shop.close();
  return dataRoot;
}

test('upgrading: the existing database becomes the first shop, and its accounts move to system.db', () => {
  const dataRoot = oldInstallation();
  const s = inProcess(dataRoot, SNAPSHOT);

  assert.deepEqual(s.shops, [{ id: 1, name: 'Магазин Център', prefix: '', db_file: 'repair-log.db', sms: '{}' }]);
  assert.deepEqual(s.users, [
    { id: 3, username: 'owner', role: 'admin', store_id: null },
    { id: 7, username: 'helper', role: 'staff', store_id: null }
  ]);
  assert.deepEqual(s.orders, ['Стар клиент'], 'orders stay in the shop database');

  // The old accounts table is left as it was (a fallback; no longer used).
  const old = new Database(path.join(dataRoot, 'data', 'repair-log.db'), { readonly: true });
  assert.equal(old.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
  old.close();

  // Starting again changes nothing: no second shop, no copied accounts twice.
  assert.deepEqual(inProcess(dataRoot, SNAPSHOT), s);
});

test('upgrading with create-admin.js before the app has started still keeps every account', () => {
  const dataRoot = oldInstallation();
  const res = spawnSync(process.execPath, [path.join(ROOT, 'create-admin.js'), 'newboss', 'password1'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_ROOT: dataRoot }
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(inProcess(dataRoot, SNAPSHOT).users.map(u => u.username), ['owner', 'helper', 'newboss']);
});

test('a new installation gets a first shop whose database has no accounts table', () => {
  const s = inProcess(makeDataRoot(), SNAPSHOT);
  assert.equal(s.shops.length, 1);
  assert.equal(s.shops[0].db_file, 'repair-log.db');
  assert.deepEqual(s.users, []);
  assert.ok(!s.shopTables.includes('users'), s.shopTables.join(', '));
  assert.ok(s.shopTables.includes('tickets'));
});

test('upgraded accounts can log in, and see the shop\'s orders', async () => {
  const dataRoot = oldInstallation();
  const out = inProcess(dataRoot, `
    const request = require('supertest');
    const app = require('./app');
    (async () => {
      const agent = request.agent(app);
      const login = await agent.post('/api/auth/login').send({ username: 'helper', password: 'helperpass1' });
      const orders = await agent.get('/api/tickets');
      console.log(JSON.stringify({ login: login.status, role: login.body.role, orders: orders.body.map(t => t.customer_name) }));
      process.exit(0);
    })();`);
  assert.deepEqual(out, { login: 200, role: 'staff', orders: ['Стар клиент'] });
});

test('backups include system.db, and restore puts either database back', () => {
  const dataRoot = oldInstallation();
  inProcess(dataRoot, SNAPSHOT); // first start: creates system.db

  assert.equal(runScript('backup.js', [], dataRoot).status, 0);
  const files = fs.readdirSync(path.join(dataRoot, 'backups'));
  const shopBackup = files.find(f => f.startsWith('repair-log_'));
  const systemBackup = files.find(f => f.startsWith('system_'));
  assert.ok(shopBackup && systemBackup, files.join(', '));
  assert.equal(shopBackup.slice('repair-log_'.length), systemBackup.slice('system_'.length), 'same time stamp');
  const log = JSON.parse(fs.readFileSync(path.join(dataRoot, 'backups', 'backup-log.json'), 'utf8'));
  assert.equal(log[0].ok, true);
  assert.equal(log[0].systemFile, systemBackup);

  // An account is lost after the backup...
  const sys = new Database(path.join(dataRoot, 'data', 'system.db'));
  sys.prepare("DELETE FROM users WHERE username = 'helper'").run();
  sys.close();

  // ..."latest" still means the newest shop backup, never system.db...
  const latest = runScript('restore.js', ['latest'], dataRoot);
  assert.equal(latest.status, 0, latest.stderr);
  assert.match(latest.stdout, new RegExp(`Restored "${shopBackup}"`));
  assert.match(runScript('restore.js', [], dataRoot).stdout, /Accounts and shops \(system\.db\)/);

  // ...and the system backup, named, brings the account back.
  const res = runScript('restore.js', [systemBackup], dataRoot);
  assert.equal(res.status, 0, res.stderr);
  const restored = new Database(path.join(dataRoot, 'data', 'system.db'), { readonly: true });
  assert.ok(restored.prepare("SELECT 1 FROM users WHERE username = 'helper'").get());
  restored.close();
  assert.ok(fs.readdirSync(path.join(dataRoot, 'data', 'pre-restore')).some(f => f.startsWith('system_before-restore_')));
});
