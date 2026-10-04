// Backs up the repair log database safely (using SQLite's own online backup
// API, which is safe to run while the app is live) to a local backups/
// folder, then optionally also copies it to a NAS path set via
// NAS_BACKUP_DIR in .env. Every nightly backup is kept indefinitely —
// nothing is ever deleted automatically. Each run (success or failure) is
// recorded in backups/backup-log.json, shown in Справки (lib/backup-log.js).
//
// Run manually with:  node backup.js
// Schedule nightly with Windows Task Scheduler — see README for setup.

require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { recordBackupRun } = require('./lib/backup-log');

// Same DATA_ROOT override as db.js — see the comment there. Keeping the
// logic identical across files means the database, backups, and
// pre-restore safety copies all move together if you ever set it.
const BASE_DIR = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : __dirname;

const DB_PATH = path.join(BASE_DIR, 'data', 'repair-log.db');
const LOCAL_BACKUP_DIR = path.join(BASE_DIR, 'backups');

// Set NAS_BACKUP_DIR in .env (not here) so it survives every future code
// update untouched — see .env.example for the exact format needed for a
// UNC path with backslashes/Cyrillic/spaces.
const NAS_BACKUP_DIR = process.env.NAS_BACKUP_DIR || null;

// Tests: only temp folders, never the real data or the NAS.
const { assertTestFolder } = require('./lib/test-guard');
assertTestFolder(process.env.DATA_ROOT, 'DATA_ROOT');
if (NAS_BACKUP_DIR) assertTestFolder(NAS_BACKUP_DIR, 'NAS_BACKUP_DIR');

// Makes the backup, filling in `run` as it goes. Throws if no backup
// could be made; an unreachable NAS only marks the run as failed.
async function backUp(run) {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: database not found at ${DB_PATH}`);
    throw new Error(`Базата данни не е намерена (${DB_PATH})`);
  }
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `repair-log_${timestamp}.db`;
  const localPath = path.join(LOCAL_BACKUP_DIR, filename);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(localPath);
  } catch (err) {
    console.error('Backup failed:', err);
    throw new Error(`Резервното копие не можа да бъде създадено: ${err.message}`);
  } finally {
    db.close();
  }
  run.file = filename;
  run.sizeBytes = fs.statSync(localPath).size;
  console.log(`Local backup saved: ${localPath}`);

  // Copy to the NAS if configured. This must not crash the whole backup if
  // the NAS happens to be unreachable that night — log a warning instead,
  // and mark the run as failed so it shows in Справки.
  if (NAS_BACKUP_DIR) {
    try {
      fs.mkdirSync(NAS_BACKUP_DIR, { recursive: true });
      fs.copyFileSync(localPath, path.join(NAS_BACKUP_DIR, filename));
      run.nas = 'ok';
      console.log(`Copied to NAS: ${path.join(NAS_BACKUP_DIR, filename)}`);
    } catch (err) {
      run.nas = 'failed';
      run.error = `Локалното копие е запазено, но копирането към NAS не успя: ${err.message}`;
      console.error(`WARNING: could not reach NAS backup path (${NAS_BACKUP_DIR}): ${err.message}`);
    }
  }
}

async function main() {
  const run = {
    startedAt: new Date().toISOString(), finishedAt: null, ok: false,
    file: null, sizeBytes: null, nas: NAS_BACKUP_DIR ? 'failed' : 'off', error: null
  };
  try {
    await backUp(run);
  } catch (err) {
    run.error = err.message;
    process.exitCode = 1;
  } finally {
    run.finishedAt = new Date().toISOString();
    run.ok = !run.error;
    try {
      recordBackupRun(run, LOCAL_BACKUP_DIR);
    } catch (err) {
      console.error(`WARNING: could not update the backup log: ${err.message}`);
    }
  }
}

main();
