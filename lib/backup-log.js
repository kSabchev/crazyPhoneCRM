// The last few backup runs, newest first, kept in backup-log.json in the
// backups folder: written by backup.js, shown in Справки, and used for the
// "a backup failed" notice after an admin logs in.
//
// A file rather than a database table, so a run that failed because the
// database couldn't be read is still recorded, and restoring an old
// backup doesn't roll the log back with it.
//
// Each run: { startedAt, finishedAt (ISO times), ok, file, sizeBytes,
//             nas: 'ok' | 'failed' | 'off', error }
const fs = require('fs');
const path = require('path');

const KEEP = 5;
const LOG_NAME = 'backup-log.json';

// The backups folder: next to data/, in DATA_ROOT or the app folder (the
// same rule as db.js, backup.js and restore.js).
function backupDir() {
  const base = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : path.join(__dirname, '..');
  return path.join(base, 'backups');
}

// Newest first. A missing or unreadable log is treated as empty.
function readBackupLog(dir = backupDir()) {
  try {
    const runs = JSON.parse(fs.readFileSync(path.join(dir, LOG_NAME), 'utf8'));
    return Array.isArray(runs) ? runs.slice(0, KEEP) : [];
  } catch (_) {
    return [];
  }
}

// Adds a run and keeps only the latest KEEP. Written to a temporary file
// first, so the log is never left half-written.
function recordBackupRun(run, dir = backupDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const runs = [run, ...readBackupLog(dir)].slice(0, KEEP);
  const file = path.join(dir, LOG_NAME);
  fs.writeFileSync(file + '.tmp', JSON.stringify(runs, null, 2));
  fs.renameSync(file + '.tmp', file);
  return runs;
}

module.exports = { backupDir, readBackupLog, recordBackupRun, KEEP };
