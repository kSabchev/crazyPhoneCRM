// @ts-check
// The change history (audit_log, in each shop's database): who did what,
// to which order, and when.

// `db` is the shop's database. `at` (SQLite UTC "YYYY-MM-DD HH:MM:SS") is
// for jobs that record a change "as of" a given moment; normally the
// current time is used.
/** @param {import('better-sqlite3').Database} db */
function logAudit(db, ticketId, ticketNo, action, changes, username, at = null) {
  db.prepare(
    `INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(ticketId, ticketNo, action, JSON.stringify(changes), username, at);
}

const { TRACKED_FIELDS, diffTickets } = require('./ticket-diff');

module.exports = { logAudit, diffTickets, TRACKED_FIELDS };
