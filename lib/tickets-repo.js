// All SQL for orders (the tickets table) in one place: the routes, the
// hourly "забравен" job and the phone-model list go through here. (Demo
// seeding, the reports' calculations and the migrations in db.js still
// talk to the table directly.)
//
//   const tickets = ticketsRepo(db);
//   tickets.get(id) / list() / create(fields) / update(id, fields) / remove(id)
//
// Orders use the database's field names (customer_name, kaparo, …). The
// database is passed in so scheduled jobs and tests can use their own.

// The fields of an order that can be written (everything except id,
// ticket_no and the timestamps).
const COLUMNS = [
  'customer_name', 'phone_contact', 'date_received', 'date_returned', 'phone_model',
  'status', 'description', 'comment', 'repair_performed', 'loaner_phone',
  'phone_password', 'pravim', 'kaparo', 'service_price', 'customer_price'
];

const pick = fields => Object.fromEntries(COLUMNS.map(c => [c, fields[c] ?? null]));

function ticketsRepo(db) {
  // Each statement is prepared on first use, once: preparing at start-up
  // would fail before db.js / demo.js could report a problem with an
  // unexpected database clearly.
  const SQL = {
    get: 'SELECT * FROM tickets WHERE id = ?',
    // Uses idx_tickets_date_received: rows come out already in this order.
    list: 'SELECT * FROM tickets ORDER BY date_received DESC, ticket_no DESC',
    maxNo: 'SELECT MAX(ticket_no) AS maxNo FROM tickets',
    insert: `INSERT INTO tickets (ticket_no, ${COLUMNS.join(', ')}) VALUES (@ticket_no, ${COLUMNS.map(c => '@' + c).join(', ')})`,
    update: `UPDATE tickets SET ${COLUMNS.map(c => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`,
    remove: 'DELETE FROM tickets WHERE id = ?',
    models: "SELECT DISTINCT phone_model FROM tickets WHERE phone_model IS NOT NULL AND phone_model != ''",
    // When each order in `status` most recently entered it: the latest
    // history entry that set that status (on creation or on an edit).
    sinceStatus: `
      SELECT t.*,
        (SELECT MAX(a.performed_at) FROM audit_log a
          WHERE a.ticket_id = t.id AND (
            (a.action = 'created' AND json_extract(a.changes, '$.status') = @status) OR
            (a.action = 'updated' AND json_extract(a.changes, '$.status.to') = @status)
          )) AS status_since
      FROM tickets t
      WHERE t.status = @status`
  };
  const prepared = {};
  const stmt = name => prepared[name] || (prepared[name] = db.prepare(SQL[name]));

  const get = id => stmt('get').get(id) || null;

  return {
    get,
    list: () => stmt('list').all(),

    // A new order with the next free number. Returns the saved order.
    create: db.transaction(fields => {
      const ticketNo = (stmt('maxNo').get().maxNo || 0) + 1;
      const { lastInsertRowid } = stmt('insert').run({ ticket_no: ticketNo, ...pick(fields) });
      return get(lastInsertRowid);
    }),

    // Saves the given fields (others keep their value). Returns the saved
    // order, or null if there's no such order.
    update(id, fields) {
      const current = get(id);
      if (!current) return null;
      stmt('update').run({ ...pick({ ...current, ...fields }), id: current.id });
      return get(current.id);
    },

    // True if an order was deleted.
    remove: id => stmt('remove').run(id).changes > 0,

    // Phone models typed on orders, for the model suggestions.
    usedPhoneModels: () => stmt('models').all().map(r => r.phone_model),

    // Orders in `status`, each with status_since (SQLite UTC time it entered
    // that status, or null if the history doesn't say).
    withStatusSince: status => stmt('sinceStatus').all({ status })
  };
}

module.exports = { ticketsRepo, COLUMNS };
