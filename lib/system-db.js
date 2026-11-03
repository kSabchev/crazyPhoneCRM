// @ts-check
// system.db: what all shops share — login accounts, the list of shops and
// login sessions (the session store creates its own "sessions" table).
// Each shop's orders are in its own database (lib/shop-db.js).
//
// The first time it's opened on an installation from before shops existed,
// the original data/repair-log.db is registered as the first shop and its
// accounts are copied here (they stay in the old file too, unused). This
// happens whatever opens system.db first (the app, create-admin.js), so an
// account created before the app's first start can't block the copy.
const path = require('path');
const Database = require('better-sqlite3');
const { dataDir } = require('./data-dir');
const { openShopDb } = require('./shop-db');
const { migrate } = require('../migrations');

const DIR = dataDir();
const db = new Database(path.join(DIR, 'system.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',   -- 'admin' | 'shop_manager' | 'staff'
    store_id INTEGER,                     -- the shop of a shop account; NULL for admins
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per shop. db_file is relative to the data folder. prefix is
  -- shown before the shop's order numbers; sms holds the shop's SMS
  -- settings (JSON).
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    db_file TEXT UNIQUE NOT NULL,
    sms TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- First start: the existing database becomes the first shop ----
const FIRST_SHOP_FILE = 'repair-log.db';

function setUpFirstShop() {
  if (db.prepare('SELECT COUNT(*) AS n FROM stores').get()['n'] > 0) return;
  const shopDb = openShopDb(path.join(DIR, FIRST_SHOP_FILE));
  const settings = JSON.parse(/** @type {{ data: string }} */ (shopDb.prepare('SELECT data FROM settings WHERE id = 1').get()).data);
  const hasOldAccounts = !!shopDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  /** @type {import('../types/app').UserRow[]} */
  const accounts = hasOldAccounts ? /** @type {any[]} */ (shopDb.prepare('SELECT id, username, password_hash, role, created_at FROM users ORDER BY id').all()) : [];

  db.transaction(() => {
    db.prepare('INSERT INTO stores (name, db_file) VALUES (?, ?)').run(settings.shopName || 'Магазин 1', FIRST_SHOP_FILE);
    // Only into an empty accounts table: never over accounts made here.
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get()['n'] > 0) return;
    const add = db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const u of accounts) add.run(u.id, u.username, u.password_hash, u.role || 'admin', u.created_at);
    // Staff accounts belong to this shop (SYSTEM_MIGRATIONS below).
  })();
  if (accounts.length) {
    console.log(`Set up shop "${settings.shopName || 'Магазин 1'}" from the existing database; ${accounts.length} account(s) moved to system.db.`);
  }
}
setUpFirstShop();

// Changes to system.db itself, each applied once. They run after the first
// shop is set up, so they can rely on it existing.
/** @type {{ name: string, up: (db: import('better-sqlite3').Database) => void }[]} */
const SYSTEM_MIGRATIONS = [
  {
    // Accounts used to see the one shop there was. Staff accounts now each
    // belong to a shop: the existing ones to the first. Admins see all shops.
    name: 'users: staff accounts belong to the first shop',
    up(db) {
      db.prepare("UPDATE users SET store_id = (SELECT MIN(id) FROM stores) WHERE role <> 'admin' AND store_id IS NULL").run();
    }
  }
];
migrate(db, SYSTEM_MIGRATIONS);

module.exports = db;
