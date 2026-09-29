require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DATA_ROOT lets the database, backups, and pre-restore safety copies all
// live outside the versioned app folder (e.g. a stable D:\CrazyPhoneData),
// so redeploying a new code version never touches them at all. Optional —
// defaults to the app folder itself, exactly as before, if not set.
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
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Note: the "sessions" table itself is created automatically by
  -- better-sqlite3-session-store on startup, with the schema it needs.
`);

// Migration for databases created before "date_returned" existed.
const ticketColumns = db.prepare("PRAGMA table_info(tickets)").all().map(c => c.name);
if (!ticketColumns.includes('date_returned')) {
  db.exec('ALTER TABLE tickets ADD COLUMN date_returned TEXT');
}
// Migration for databases created before comment/repair/loaner-phone existed.
for (const col of ['comment', 'repair_performed', 'loaner_phone']) {
  if (!ticketColumns.includes(col)) {
    db.exec(`ALTER TABLE tickets ADD COLUMN ${col} TEXT`);
  }
}
// Migration for databases created before the "pravim" tri-state marker existed.
if (!ticketColumns.includes('pravim')) {
  db.exec("ALTER TABLE tickets ADD COLUMN pravim TEXT NOT NULL DEFAULT 'circle'");
}
// Migration for databases created before "kaparo" (deposit) existed.
if (!ticketColumns.includes('kaparo')) {
  db.exec('ALTER TABLE tickets ADD COLUMN kaparo REAL');
}
// Migration for databases created before "phone_password" (the customer's
// unlock code) existed. Also shows its new table column, since the saved
// column list would otherwise leave it hidden.
const addedPasswordColumn = !ticketColumns.includes('phone_password');
if (addedPasswordColumn) {
  db.exec('ALTER TABLE tickets ADD COLUMN phone_password TEXT');
}

// "Оборотен телефон" used to be free text (often the loaner's model); it is
// now a да/не choice. Convert any other value: "Не"/empty -> "не", anything
// else -> "да" with the original text appended to the comment so nothing
// is lost. Runs on every start but only touches values not yet converted.
const legacyLoaners = db.prepare(
  "SELECT id, loaner_phone, comment FROM tickets WHERE loaner_phone IS NULL OR loaner_phone NOT IN ('да', 'не')"
).all();
if (legacyLoaners.length) {
  const setLoaner = db.prepare('UPDATE tickets SET loaner_phone = ?, comment = ? WHERE id = ?');
  db.transaction(() => {
    for (const t of legacyLoaners) {
      const text = (t.loaner_phone || '').trim();
      const lower = text.toLowerCase();
      if (lower === '' || lower === 'не') {
        setLoaner.run('не', t.comment, t.id);
      } else if (lower === 'да') {
        setLoaner.run('да', t.comment, t.id);
      } else {
        const note = `Оборотен телефон: ${text}`;
        setLoaner.run('да', t.comment ? `${t.comment}\n${note}` : note, t.id);
      }
    }
  })();
}

// Indexes for the queries that run constantly:
// - the ticket list (every page load and every live update) sorts by
//   date_received DESC, ticket_no DESC — this index returns rows already
//   in that order instead of sorting the whole table each time;
// - a ticket's history looks up audit_log by ticket_id;
// - the global audit view takes the newest 200 entries by performed_at.
// (No index on status yet: status filtering happens in the browser, so
// the database never searches by it.)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tickets_date_received ON tickets (date_received, ticket_no);
  CREATE INDEX IF NOT EXISTS idx_audit_ticket_id ON audit_log (ticket_id);
  CREATE INDEX IF NOT EXISTS idx_audit_performed_at ON audit_log (performed_at);
`);

// Seed default settings on first run.
const DEFAULT_SETTINGS = {
  shopName: 'CrazyPhone',
  shopTagline: 'аксесоари и сервиз',
  statuses: ['за сервиз', 'в сервиз', 'чака клиент', 'издаден'],
  columns: ['customer', 'callBtn', 'model', 'issue', 'password', 'comment', 'repairPerformed', 'loanerPhone', 'pravim', 'status', 'kaparo', 'servicePrice', 'customerPrice', 'dateIn', 'dateReturned'],
  printCustomer: {
    header: 'СЕРВИЗНА КАРТА',
    footer: 'МАГАЗИНЪТ И СЕРВИЗЪТ НЕ НОСЯТ ОТГОВОРНОСТ ЗА:\nИЗГУБЕНА ПРИ РЕМОНТА ИНФОРМАЦИЯ ОТ МОБИЛНИТЕ АПАРАТИ\nАПАРАТИ НЕПОТЪРСЕНИ ДО 1 МЕСЕЦ ОТ ДАТАТА НА ПРИЕМАНЕ'
  },
  devices: [
    'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini', 'iPhone 12', 'iPhone 11',
    'iPhone SE (2022)', 'iPhone XR',
    'Samsung Galaxy S25 Ultra', 'Samsung Galaxy S25', 'Samsung Galaxy S24 Ultra', 'Samsung Galaxy S24',
    'Samsung Galaxy S23 Ultra', 'Samsung Galaxy S23', 'Samsung Galaxy A55', 'Samsung Galaxy A54',
    'Samsung Galaxy A35', 'Samsung Galaxy Z Flip 6', 'Samsung Galaxy Z Fold 6', 'Samsung Galaxy Note 20',
    'Xiaomi Redmi Note 13', 'Xiaomi Redmi Note 12', 'Xiaomi 14', 'Xiaomi 13T', 'Xiaomi Poco X6',
    'Huawei P60', 'Huawei Mate 50', 'Huawei Nova 11',
    'Google Pixel 9', 'Google Pixel 8', 'Google Pixel 7',
    'OnePlus 12', 'OnePlus Nord 3',
    'Oppo Reno 11', 'Oppo A98',
    'Motorola Edge 40'
  ]
};

const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
if (!existingSettings) {
  db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));
} else if (addedPasswordColumn) {
  const saved = JSON.parse(db.prepare('SELECT data FROM settings WHERE id = 1').get().data);
  if (!saved.columns.includes('password')) {
    saved.columns.push('password');
    db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(saved));
  }
}

module.exports = db;
