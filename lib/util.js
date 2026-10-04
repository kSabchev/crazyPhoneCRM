// Small helpers shared by the server's routes.

// Today's date in the server's local time zone (the shop's), as YYYY-MM-DD.
// `d` is for scheduled jobs and tests that run "as of" another moment.
function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A real calendar date in YYYY-MM-DD form (what <input type="date"> sends).
function isValidDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

function daysBetweenDates(from, to) {
  return (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / (24 * 60 * 60 * 1000);
}

// A price as sent by the forms: a number, or text with a decimal comma or
// point ("25,50" / "25.50"). Empty means no price (null); anything else
// gives NaN, which validation rejects.
function toPrice(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (s === '') return null;
  return /^\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
}

// Express 4 doesn't catch errors in async routes, and an unhandled rejection
// would stop the server (see server.js) — pass them to the error handler.
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { localToday, isValidDate, daysBetweenDates, toPrice, asyncRoute };
