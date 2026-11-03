// @ts-check
// Справки (managers and admins): revenue, turnaround, workload, SMS — see
// ../reports.js. Managers see their shop; admins one, several or all shops.
// The backup log is for admins only.
const express = require('express');
const { buildReport, shopSummary } = require('../reports');
const { requireAdmin, requireManager } = require('../lib/auth');
const { localToday, isValidDate, daysBetweenDates } = require('../lib/util');
const { readBackupLog, KEEP } = require('../lib/backup-log');
const { combinedDb } = require('../lib/combined-db');
const stores = require('../lib/stores');

const router = express.Router();
const MAX_COMBINED = 10;

// The shops a report covers. Admins can tick any of them (?shops=1,3),
// archived ones too (their figures are kept); otherwise every shop in the
// all-shops view, or the request's own shop.
/** @returns {{ shops?: import('../types/app').Store[], error?: string }} */
function reportShops(req) {
  if (req.user.role !== 'admin' || req.query.shops === undefined) {
    return { shops: req.allShops ? stores.all() : [req.store] };
  }
  const ids = [...new Set(String(req.query.shops).split(',').map(s => s.trim()).filter(Boolean))];
  if (!ids.length) return { error: 'Изберете поне един магазин' };
  const shops = ids.map(id => stores.get(id));
  if (shops.some(s => !s)) return { error: 'Невалиден магазин' };
  // The combined report attaches each one (lib/combined-db.js).
  if (shops.length > MAX_COMBINED) return { error: `Изберете най-много ${MAX_COMBINED} магазина` };
  return { shops: /** @type {import('../types/app').Store[]} */ (shops).sort((a, b) => a.id - b.id) };
}

router.get('/api/reports', requireManager, (req, res) => {
  const today = localToday();
  const from = req.query.from || `${today.slice(0, 4)}-01-01`;
  const to = req.query.to || today;
  if (!isValidDate(from) || !isValidDate(to)) {
    return res.status(400).json({ error: 'Невалиден период' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'Началната дата е след крайната' });
  }
  if (daysBetweenDates(from, to) > 10 * 366) {
    return res.status(400).json({ error: 'Периодът е твърде дълъг (най-много 10 години)' });
  }
  const picked = reportShops(req);
  if (picked.error) return res.status(400).json({ error: picked.error });
  const shops = /** @type {import('../types/app').Store[]} */ (picked.shops);
  const covers = shops.map(s => s.id);
  if (shops.length === 1) return res.json({ ...buildReport(shops[0].db, { from, to, today }), shops: covers });

  // Several shops: their data at once, plus each one's headline figures
  // side by side (byShop; the total is the combined report's).
  const db = combinedDb(shops);
  try {
    /** @type {Record<string, any>} */
    const report = { ...buildReport(db, { from, to, today }), shops: covers };
    report.byShop = {
      shops: shops.map(store => ({
        id: store.id, name: store.name, prefix: store.prefix,
        ...shopSummary(buildReport(store.db, { from, to, today }))
      })),
      total: shopSummary(report)
    };
    res.json(report);
  } finally {
    db.close();
  }
});

// The latest backup runs (newest first), recorded by backup.js: shown at
// the bottom of Справки, and checked after an admin logs in.
router.get('/api/backups', requireAdmin, (req, res) => {
  res.json({ runs: readBackupLog(), keep: KEEP });
});

module.exports = router;
