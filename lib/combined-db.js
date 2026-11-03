// @ts-check
// Every shop's orders, history and SMS as one read-only database, for the
// admins' all-shops reports: reports.js runs its usual queries on it.
//
// A temporary in-memory database attaches each shop's database and gets
// views named like the shop tables (tickets, audit_log, sms_messages) that
// combine them. Ids repeat between shops, so the views give each row an id
// unique across shops (id * 1000 + shop id; ticket_id likewise, so joins
// still match), and a store_prefix column for showing order numbers.
// Close it when done.
const Database = require('better-sqlite3');

const TABLES = { tickets: ['id'], audit_log: ['id', 'ticket_id'], sms_messages: ['id', 'ticket_id'] };
// SQLite attaches up to 10 databases: enough for 10 shops. (The id scheme
// above would allow 999.)

/** @param {import('../types/app').Store[]} shops @returns {import('better-sqlite3').Database} */
function combinedDb(shops) {
  const db = new Database(':memory:');
  try {
    shops.forEach((shop, i) => db.prepare(`ATTACH DATABASE ? AS shop${i}`).run(shop.db.name));
    for (const [table, idColumns] of Object.entries(TABLES)) {
      // Every shop database has the same columns (the same migrations).
      const columns = /** @type {{ name: string }[]} */ (shops[0].db.prepare(`PRAGMA table_info(${table})`).all()).map(c => c.name);
      const selects = shops.map((shop, i) => {
        const cols = columns.map(c => (idColumns.includes(c) ? `${c} * 1000 + ${Number(shop.id)} AS ${c}` : c));
        return `SELECT ${cols.join(', ')}, ? AS store_prefix FROM shop${i}.${table}`;
      });
      // Views can't take parameters: the prefixes go in as quoted literals.
      const quoted = shops.map(shop => `'${String(shop.prefix || '').replace(/'/g, "''")}'`);
      let n = 0;
      const sql = selects.join(' UNION ALL ').replace(/\?/g, () => quoted[n++]);
      db.exec(`CREATE TEMP VIEW ${table} AS ${sql}`);
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

module.exports = { combinedDb };
