// Automatic status change: an order left in "чака клиент" for more than
// FORGET_AFTER_DAYS days becomes "забравен" (never collected). Run on
// server start and then hourly (server.js). Recorded in the change history
// as done by "автоматично", like any other status change.
const STATUSES = require('./public/statuses');
const { applyTransition, FORGET_AFTER_DAYS } = require('./public/status-rules');
const { diffTickets, TRACKED_FIELDS } = require('./lib/ticket-diff');
const { localToday } = require('./lib/util');
const WAITING_STATUS = STATUSES.WAITING;
const FORGOTTEN_STATUS = STATUSES.FORGOTTEN;
// Only the order fields the history tracks can be changed by a rule.
const UPDATABLE = new Set(TRACKED_FIELDS.map(([col]) => col));
const AUTO_USER = 'автоматично';
const DAY_MS = 24 * 60 * 60 * 1000;

// audit_log.performed_at is SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" UTC.
const parseAuditTime = s => Date.parse(s.replace(' ', 'T') + 'Z');
const toAuditTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// Returns the orders it changed ({ id, ticketNo, waitingSince }).
function forgetStaleWaiting(db, { now = Date.now() } = {}) {
  // When each waiting order most recently entered "чака клиент": the
  // latest history entry that set that status (on creation or on an
  // edit). Orders without such an entry fall back to their received date.
  const waiting = db.prepare(`
    SELECT t.id, t.ticket_no, t.date_received,
      (SELECT MAX(a.performed_at) FROM audit_log a
        WHERE a.ticket_id = t.id AND (
          (a.action = 'created' AND json_extract(a.changes, '$.status') = @waiting) OR
          (a.action = 'updated' AND json_extract(a.changes, '$.status.to') = @waiting)
        )) AS since
    FROM tickets t
    WHERE t.status = @waiting
  `).all({ waiting: WAITING_STATUS });

  const stale = waiting
    .map(t => ({
      id: t.id,
      ticketNo: t.ticket_no,
      waitingSince: t.since ? parseAuditTime(t.since) : Date.parse(t.date_received + 'T00:00:00Z')
    }))
    .filter(t => now - t.waitingSince > FORGET_AFTER_DAYS * DAY_MS);
  if (stale.length === 0) return [];

  const getWaiting = db.prepare('SELECT * FROM tickets WHERE id = ? AND status = ?');
  const logChange = db.prepare(`
    INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, ?, 'updated', ?, ?, ?)`);
  const today = localToday(new Date(now));
  const changed = [];

  db.transaction(() => {
    for (const t of stale) {
      const before = getWaiting.get(t.id, WAITING_STATUS);
      if (!before) continue; // changed by someone in the meantime
      // The status rules apply here too, like any other status change.
      const after = applyTransition(before, { ...before, status: FORGOTTEN_STATUS }, { today });
      const diff = diffTickets(before, after);
      const cols = Object.keys(diff).filter(col => UPDATABLE.has(col));
      db.prepare(`UPDATE tickets SET ${cols.map(c => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...Object.fromEntries(cols.map(c => [c, after[c]])), id: t.id });
      logChange.run(t.id, t.ticketNo, JSON.stringify(diff), AUTO_USER, toAuditTime(now));
      changed.push(t);
    }
  })();
  return changed;
}

module.exports = { forgetStaleWaiting, FORGET_AFTER_DAYS, AUTO_USER };
