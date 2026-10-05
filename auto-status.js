// @ts-check
// Automatic status change: an order left in "чака клиент" for more than
// FORGET_AFTER_DAYS days becomes "забравен" (never collected). Run on
// server start and then hourly (server.js). Recorded in the change history
// as done by "автоматично", like any other status change.
const STATUSES = require('./public/statuses');
const { applyTransition, FORGET_AFTER_DAYS } = require('./public/status-rules');
const { ticketEvents } = require('./lib/ticket-events');
const { ticketsRepo } = require('./lib/tickets-repo');
const { localToday } = require('./lib/util');
const WAITING_STATUS = STATUSES.WAITING;
const FORGOTTEN_STATUS = STATUSES.FORGOTTEN;
const AUTO_USER = 'автоматично';
const DAY_MS = 24 * 60 * 60 * 1000;

// audit_log.performed_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" UTC.
const parseAuditTime = s => Date.parse(s.replace(' ', 'T') + 'Z');
const toAuditTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// Returns the orders it changed ({ id, ticketNo, waitingSince }).
function forgetStaleWaiting(db, { now = Date.now() } = {}) {
  const tickets = ticketsRepo(db);
  // When each waiting order most recently entered "чака клиент", from the
  // history. Orders without such an entry fall back to their received date.
  const stale = tickets.withStatusSince(WAITING_STATUS)
    .map(t => ({
      id: t.id,
      ticketNo: t.ticket_no,
      waitingSince: t.status_since ? parseAuditTime(t.status_since) : Date.parse(t.date_received + 'T00:00:00Z')
    }))
    .filter(t => now - t.waitingSince > FORGET_AFTER_DAYS * DAY_MS);
  if (stale.length === 0) return [];

  const today = localToday(new Date(now));
  const changed = [];

  db.transaction(() => {
    for (const t of stale) {
      const before = tickets.get(t.id);
      if (!before || before.status !== WAITING_STATUS) continue; // changed in the meantime
      // The status rules apply here too, like any other status change.
      const after = applyTransition(before, { ...before, status: FORGOTTEN_STATUS }, { today });
      const saved = tickets.update(t.id, after);
      // History and live updates: lib/ticket-listeners.js.
      ticketEvents.emit('updated', { before, after: saved, user: AUTO_USER, at: toAuditTime(now) });
      changed.push(t);
    }
  })();
  return changed;
}

module.exports = { forgetStaleWaiting, FORGET_AFTER_DAYS, AUTO_USER };
