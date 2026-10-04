// Database changes, in order. Each one runs exactly once: SQLite's
// PRAGMA user_version records how many have been applied. To change the
// database, add a step at the END of the list — never edit, reorder or
// remove one that has shipped.
//
// The first steps predate the numbering: databases created back then
// start at version 0 even if they already have these changes, so those
// steps check first and skip what's already there.

const hasColumn = (db, table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);

function readSettings(db) {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}
const writeSettings = (db, data) =>
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(data));

const MIGRATIONS = [
  {
    // Every existing account becomes an admin, so nobody loses access.
    name: 'users: role',
    up(db) {
      if (!hasColumn(db, 'users', 'role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
    }
  },
  {
    name: 'tickets: date_returned',
    up(db) {
      if (!hasColumn(db, 'tickets', 'date_returned')) db.exec('ALTER TABLE tickets ADD COLUMN date_returned TEXT');
    }
  },
  {
    name: 'tickets: comment, repair_performed, loaner_phone',
    up(db) {
      for (const col of ['comment', 'repair_performed', 'loaner_phone']) {
        if (!hasColumn(db, 'tickets', col)) db.exec(`ALTER TABLE tickets ADD COLUMN ${col} TEXT`);
      }
    }
  },
  {
    name: 'tickets: pravim',
    up(db) {
      if (!hasColumn(db, 'tickets', 'pravim')) db.exec("ALTER TABLE tickets ADD COLUMN pravim TEXT NOT NULL DEFAULT 'circle'");
    }
  },
  {
    name: 'tickets: kaparo',
    up(db) {
      if (!hasColumn(db, 'tickets', 'kaparo')) db.exec('ALTER TABLE tickets ADD COLUMN kaparo REAL');
    }
  },
  {
    // The customer's unlock code. Also shows its new table column, since
    // the saved column list would otherwise leave it hidden.
    name: 'tickets: phone_password',
    up(db) {
      if (hasColumn(db, 'tickets', 'phone_password')) return;
      db.exec('ALTER TABLE tickets ADD COLUMN phone_password TEXT');
      const saved = readSettings(db);
      if (saved && !saved.columns.includes('password')) {
        saved.columns.push('password');
        writeSettings(db, saved);
      }
    }
  },
  {
    // "Оборотен телефон" used to be free text (often the loaner's model);
    // it's now да/не. "Не"/empty -> "не", anything else -> "да" with the
    // original text appended to the comment so nothing is lost.
    name: 'tickets: loaner_phone becomes да/не',
    up(db) {
      const legacy = db.prepare(
        "SELECT id, loaner_phone, comment FROM tickets WHERE loaner_phone IS NULL OR loaner_phone NOT IN ('да', 'не')"
      ).all();
      const setLoaner = db.prepare('UPDATE tickets SET loaner_phone = ?, comment = ? WHERE id = ?');
      for (const t of legacy) {
        const text = (t.loaner_phone || '').trim();
        const lower = text.toLowerCase();
        if (lower === '' || lower === 'не') setLoaner.run('не', t.comment, t.id);
        else if (lower === 'да') setLoaner.run('да', t.comment, t.id);
        else {
          const note = `Оборотен телефон: ${text}`;
          setLoaner.run('да', t.comment ? `${t.comment}\n${note}` : note, t.id);
        }
      }
    }
  },
  {
    // For the queries that run constantly:
    // - the order list sorts by date_received DESC, ticket_no DESC; this
    //   index returns rows already in that order;
    // - an order's history looks up audit_log by ticket_id;
    // - the activity log takes the newest 200 entries by performed_at.
    name: 'indexes: order list, history',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tickets_date_received ON tickets (date_received, ticket_no);
        CREATE INDEX IF NOT EXISTS idx_audit_ticket_id ON audit_log (ticket_id);
        CREATE INDEX IF NOT EXISTS idx_audit_performed_at ON audit_log (performed_at);
      `);
    }
  },
  {
    // The closed statuses "отказан" and "забравен" added for shops set up
    // before they existed. (Before numbering this was marked done with the
    // addedClosedStatuses setting, which is still respected.) The names are
    // written out, not taken from statuses.js: a shipped step must keep
    // doing exactly what it did.
    name: 'settings: statuses отказан, забравен',
    up(db) {
      const saved = readSettings(db);
      if (!saved || saved.addedClosedStatuses) return;
      for (const status of ['отказан', 'забравен']) {
        if (!saved.statuses.includes(status)) saved.statuses.push(status);
      }
      saved.addedClosedStatuses = true;
      writeSettings(db, saved);
    }
  }
];

// Applies the steps this database hasn't had yet, each in its own
// transaction together with the version bump. Returns the names applied.
function migrate(db, migrations = MIGRATIONS) {
  const current = db.pragma('user_version', { simple: true });
  if (current > migrations.length) {
    // An older copy of the app on a newer database (e.g. after rolling
    // back an update). The changes so far only add things, so carry on.
    console.warn(`Warning: the database is at version ${current}, newer than this app (${migrations.length}). Consider updating the app.`);
    return [];
  }
  const applied = [];
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      migrations[v].up(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
    applied.push(migrations[v].name);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS };
