require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DATA_ROOT lets the database, backups, and pre-restore safety copies all
// live outside the versioned app folder (e.g. a stable D:\CrazyPhoneData),
// so redeploying a new code version never touches them at all. Optional —
// defaults to the app folder itself, exactly as before, if not set.
// Tests must always use their own temp folder (test/helpers.js sets it in
// loadApp) — never the app folder or a real data folder.
require('./lib/test-guard').assertTestFolder(process.env.DATA_ROOT, 'DATA_ROOT');
const BASE_DIR = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : __dirname;

const DATA_DIR = path.join(BASE_DIR, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'repair-log.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',   -- 'admin' | 'staff'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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

  -- Note: the "sessions" table itself is created automatically by
  -- better-sqlite3-session-store on startup, with the schema it needs.
`);

// Default settings on first run. Before the migrations: some of them
// update the saved settings.
const DEFAULT_SETTINGS = require('./default-settings');
if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
  db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));
}

// Changes to databases created by older versions of the app, each applied
// once, in order (see migrations.js).
require('./migrations').migrate(db);

module.exports = db;
