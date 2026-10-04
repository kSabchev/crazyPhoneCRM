// The change history (audit_log): who did what, to which order, and when.
const db = require('../db');

function logAudit(ticketId, ticketNo, action, changes, username) {
  db.prepare(
    `INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, ticketNo, action, JSON.stringify(changes), username);
}

const { TRACKED_FIELDS, diffTickets } = require('./ticket-diff');

module.exports = { logAudit, diffTickets, TRACKED_FIELDS };
