// Справки (admins): revenue, turnaround, workload, SMS — see ../reports.js.
const express = require('express');
const db = require('../db');
const { buildReport } = require('../reports');
const { requireAdmin } = require('../lib/auth');
const { localToday, isValidDate, daysBetweenDates } = require('../lib/util');
const { readBackupLog, KEEP } = require('../lib/backup-log');

const router = express.Router();

router.get('/api/reports', requireAdmin, (req, res) => {
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
  res.json(buildReport(db, { from, to, today }));
});

// The latest backup runs (newest first), recorded by backup.js: shown at
// the bottom of Справки, and checked after an admin logs in.
router.get('/api/backups', requireAdmin, (req, res) => {
  res.json({ runs: readBackupLog(), keep: KEEP });
});

module.exports = router;
