// @ts-check
// A shop's database: its orders, change history, SMS and settings. Each
// shop has its own file (lib/stores.js); the first shop's is the original
// data/repair-log.db, so an existing installation keeps its data as it is.
// Accounts, the list of shops and login sessions are in system.db
// (lib/system-db.js).
const Database = require('better-sqlite3');
const DEFAULT_SETTINGS = require('../default-settings');
const { migrate } = require('../migrations');

/** @type {Map<string, import('better-sqlite3').Database>} */
const open = new Map();

// Opens (once per process) and sets up the shop database at `file`:
// creates the tables if new, adds the default settings, and applies the
// changes for databases made by older versions (migrations.js).
/** @param {string} file absolute path @returns {import('better-sqlite3').Database} */
function openShopDb(file) {
  const existing = open.get(file);
  if (existing) return existing;
  const db = new Database(file);
  db.pragma('journal_mode = WAL');

  db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
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
    phone_password TEXT,
    pravim TEXT NOT NULL DEFAULT 'circle',
    kaparo REAL,
    service_price REAL,
    customer_price REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One per change, for accountability: who did what, to which
  -- ticket, and when. "changes" holds a JSON snapshot or diff.
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    ticket_no INTEGER NOT NULL,
    action TEXT NOT NULL,          -- 'created' | 'updated' | 'deleted'
    changes TEXT NOT NULL,          -- JSON
    performed_by TEXT NOT NULL,     -- username
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Single-row table holding the shop's configurable settings as JSON:
  -- statuses, which table columns are shown, the two print templates,
  -- and the base phone-model suggestion list.
  -- SMS notifications sent to customers through the shop phone (sms.js),
  -- with the state reported back by the phone.
  CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    ticket_no INTEGER NOT NULL,
    phone TEXT NOT NULL,
    text TEXT NOT NULL,
    state TEXT NOT NULL,           -- Sending | Pending | Processed | Sent | Delivered | Failed
    gateway_id TEXT,
    error TEXT,
    sent_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sms_ticket ON sms_messages (ticket_id);

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

`);

  // Default settings on first run. Before the migrations: some of them
  // update the saved settings.
  if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
    db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));
  }
  migrate(db);
  open.set(file, db);
  return db;
}

module.exports = { openShopDb };
