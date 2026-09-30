// Automatic status change: an order left in "чака клиент" for more than
// FORGET_AFTER_DAYS days becomes "забравен" (never collected). Run on
// server start and then hourly (server.js). Recorded in the change history
// as done by "автоматично", like any other status change.
const WAITING_STATUS = 'чака клиент';
const FORGOTTEN_STATUS = 'забравен';
const FORGET_AFTER_DAYS = 30;
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

  const setStatus = db.prepare(
    "UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?"
  );
  const logChange = db.prepare(`
    INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, ?, 'updated', ?, ?, ?)`);
  const changes = JSON.stringify({ status: { from: WAITING_STATUS, to: FORGOTTEN_STATUS } });

  db.transaction(() => {
    for (const t of stale) {
      setStatus.run(FORGOTTEN_STATUS, t.id, WAITING_STATUS);
      logChange.run(t.id, t.ticketNo, changes, AUTO_USER, toAuditTime(now));
    }
  })();
  return stale;
}

module.exports = { forgetStaleWaiting, FORGET_AFTER_DAYS, AUTO_USER };
