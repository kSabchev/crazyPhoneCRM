// Aggregates for the reports page (GET /api/reports). Everything is
// computed from data the app already records — tickets and the audit log —
// so nothing new has to be entered by staff.
//
// Definitions (all amounts in €):
// - Revenue for a month = customer_price of tickets RETURNED that month
//   (date_returned), i.e. when the money actually comes in.
// - Cost = service_price of those same tickets; profit = revenue − cost.
// - A ticket is "open" until it reaches a closed status: handed back
//   (издаден), refused (отказан) or never collected (забравен).

const { smsParts } = require('./sms');

const STATUSES = require('./public/statuses');
const COMPLETED_STATUS = STATUSES.COMPLETED;
const CLOSED_STATUSES = STATUSES.CLOSED;
const DAY_MS = 24 * 60 * 60 * 1000;

// Money is summed in whole cents so totals don't pick up float noise.
const toCents = v => Math.round(v * 100);
const fromCents = c => c / 100;

// kaparo holds a number, "Не" (no deposit), or free text from before the
// column coerced numbers. Returns a number, null for "no deposit", or
// undefined when the value can't be read as an amount.
function parseKaparo(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim();
  if (!s || /^не$/i.test(s)) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(€|eur|евро)?$/i);
  return m ? Number(m[1].replace(',', '.')) : undefined;
}

// Whole days between two YYYY-MM-DD dates.
function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}

function median(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = v => (v === null ? null : Math.round(v * 10) / 10);

// Every YYYY-MM between two dates inclusive, so months with no returns
// still appear as zero rather than silently vanishing from the chart.
function monthsBetween(from, to) {
  const months = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function ticketRef(t) {
  return { id: t.id, ticketNo: t.ticket_no, customerName: t.customer_name, phoneModel: t.phone_model, status: t.status };
}

function revenueReport(returned, from, to) {
  const byMonth = new Map(monthsBetween(from, to).map(mo => [mo, {
    month: mo, returned: 0, priced: 0, revenue: 0, cost: 0
  }]));
  for (const t of returned) {
    const row = byMonth.get(t.date_returned.slice(0, 7));
    if (!row) continue;
    row.returned += 1;
    if (t.customer_price !== null) {
      row.priced += 1;
      row.revenue += toCents(t.customer_price);
    }
    if (t.service_price !== null) row.cost += toCents(t.service_price);
  }

  const months = [...byMonth.values()].map(r => ({
    month: r.month,
    returned: r.returned,
    priced: r.priced,
    revenue: fromCents(r.revenue),
    cost: fromCents(r.cost),
    profit: fromCents(r.revenue - r.cost)
  }));
  const sum = key => months.reduce((acc, r) => acc + toCents(r[key]), 0);
  const totalRevenue = sum('revenue');
  const pricedCount = months.reduce((a, r) => a + r.priced, 0);
  return {
    months,
    totals: {
      returned: returned.length,
      priced: pricedCount,
      revenue: fromCents(totalRevenue),
      cost: fromCents(sum('cost')),
      profit: fromCents(totalRevenue - sum('cost')),
      averageTicket: pricedCount ? fromCents(Math.round(totalRevenue / pricedCount)) : null
    }
  };
}

function turnaroundReport(returned) {
  const days = returned
    .map(t => daysBetween(t.date_received, t.date_returned))
    .filter(d => d >= 0)
    .sort((a, b) => a - b);
  return {
    count: days.length,
    averageDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
    medianDays: round1(median(days)),
    maxDays: days.length ? days[days.length - 1] : null
  };
}

// Time spent in each status, rebuilt from the audit log: a ticket's
// "created" entry starts its first status, and every update that changed
// the status closes one stretch and opens the next. Only stretches that
// ENDED inside the range count (still-open ones are the workload section).
function statusTimeReport(db, from, to) {
  const rows = db.prepare(`
    SELECT a.ticket_id, a.action, a.changes, a.performed_at
    FROM audit_log a
    JOIN tickets t ON t.id = a.ticket_id
    WHERE a.action IN ('created', 'updated')
    ORDER BY a.ticket_id, a.performed_at, a.id
  `).all();

  const perStatus = new Map();
  let current = null; // { ticketId, status, since }
  for (const r of rows) {
    const changes = JSON.parse(r.changes);
    const at = Date.parse(r.performed_at.replace(' ', 'T') + 'Z');
    if (!current || current.ticketId !== r.ticket_id) current = { ticketId: r.ticket_id, status: null, since: null };

    let next = null;
    if (r.action === 'created') next = changes.status;
    else if (changes.status) next = changes.status.to;
    if (next === null || next === undefined) continue;

    const endedOn = r.performed_at.slice(0, 10);
    if (current.status !== null && endedOn >= from && endedOn <= to) {
      const entry = perStatus.get(current.status) || { status: current.status, count: 0, totalMs: 0 };
      entry.count += 1;
      entry.totalMs += at - current.since;
      perStatus.set(current.status, entry);
    }
    current.status = next;
    current.since = at;
  }

  return [...perStatus.values()]
    .map(e => ({ status: e.status, count: e.count, averageDays: round1(e.totalMs / e.count / DAY_MS) }))
    .sort((a, b) => b.averageDays - a.averageDays);
}

function workloadReport(open, today) {
  const byStatus = new Map();
  let heldCents = 0;
  let depositCount = 0;
  for (const t of open) {
    const entry = byStatus.get(t.status) || { status: t.status, count: 0, oldestDays: 0 };
    entry.count += 1;
    entry.oldestDays = Math.max(entry.oldestDays, daysBetween(t.date_received, today));
    byStatus.set(t.status, entry);

    const k = parseKaparo(t.kaparo);
    if (typeof k === 'number' && k > 0) {
      heldCents += toCents(k);
      depositCount += 1;
    }
  }
  const oldest = open
    .map(t => ({ ...ticketRef(t), daysOpen: daysBetween(t.date_received, today) }))
    .sort((a, b) => b.daysOpen - a.daysOpen || a.ticketNo - b.ticketNo)
    .slice(0, 10);

  return {
    openCount: open.length,
    byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    oldest,
    depositsHeld: { amount: fromCents(heldCents), tickets: depositCount }
  };
}

// Things that make the numbers above less accurate, listed so they can be
// fixed rather than silently skewing the report.
function dataQualityReport(all, returned) {
  const limit = list => ({ count: list.length, tickets: list.slice(0, 20).map(ticketRef) });
  return {
    returnedWithoutPrice: limit(returned.filter(t => t.customer_price === null)),
    returnedWithoutCost: limit(returned.filter(t => t.customer_price !== null && t.service_price === null)),
    issuedWithoutReturnDate: limit(all.filter(t => t.status === COMPLETED_STATUS && !t.date_returned)),
    unreadableKaparo: limit(all.filter(t => parseKaparo(t.kaparo) === undefined))
  };
}

// SMS sent to customers in the period (by the shop's local date): counts by
// state, SMS parts used (to compare with the phone plan's limit), and the
// newest messages.
const SMS_LIST_LIMIT = 200;
function smsReport(db, from, to) {
  const rows = db.prepare(`
    SELECT m.*, t.customer_name FROM sms_messages m
    LEFT JOIN tickets t ON t.id = m.ticket_id
    WHERE date(m.created_at, 'localtime') BETWEEN ? AND ?
    ORDER BY m.id DESC`).all(from, to);
  const byState = {};
  let parts = 0;
  for (const m of rows) {
    byState[m.state] = (byState[m.state] || 0) + 1;
    // Failed sends never reached the network, so they used no SMS.
    if (m.state !== 'Failed') parts += smsParts(m.text);
  }
  return {
    total: rows.length,
    parts,
    byState,
    truncated: rows.length > SMS_LIST_LIMIT,
    messages: rows.slice(0, SMS_LIST_LIMIT).map(m => ({
      id: m.id,
      createdAt: m.created_at,
      ticketId: m.ticket_id,
      ticketNo: m.ticket_no,
      customerName: m.customer_name, // null if the order was deleted since
      phone: m.phone,
      text: m.text,
      parts: smsParts(m.text),
      state: m.state,
      error: m.error,
      sentBy: m.sent_by
    }))
  };
}

// from/to are inclusive YYYY-MM-DD dates; today is injectable for tests.
function buildReport(db, { from, to, today }) {
  const all = db.prepare('SELECT * FROM tickets ORDER BY ticket_no').all();
  const returned = all.filter(t => t.date_returned && t.date_returned >= from && t.date_returned <= to);
  const open = all.filter(t => !CLOSED_STATUSES.includes(t.status));

  return {
    range: { from, to },
    revenue: revenueReport(returned, from, to),
    turnaround: turnaroundReport(returned),
    statusTime: statusTimeReport(db, from, to),
    workload: workloadReport(open, today),
    dataQuality: dataQualityReport(all, returned),
    sms: smsReport(db, from, to)
  };
}

module.exports = { buildReport, parseKaparo, monthsBetween, COMPLETED_STATUS, CLOSED_STATUSES };
