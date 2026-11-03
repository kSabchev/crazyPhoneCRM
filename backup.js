// Backs up the databases safely (using SQLite's own online backup
// API, which is safe to run while the app is live) to a local backups/
// folder, then optionally also copies it to a NAS path set via
// NAS_BACKUP_DIR in .env. Every nightly backup is kept indefinitely —
// nothing is ever deleted automatically. Each run (success or failure) is
// recorded in backups/backup-log.json, shown in Справки (lib/backup-log.js).
//
// Each run backs up, with the same time stamp:
//   repair-log_<time>.db   the first shop (data/repair-log.db)
//   system_<time>.db       accounts, shops, shared settings (data/system.db)
//   shop-<id>_<time>.db    every other shop (data/shop-<id>.db)
//
// Run manually with:  node backup.js
// Schedule nightly with Windows Task Scheduler — see README for setup.

require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { recordBackupRun } = require('./lib/backup-log');

// Same DATA_ROOT rule as the app (lib/data-dir.js). Keeping the
// logic identical across files means the database, backups, and
// pre-restore safety copies all move together if you ever set it.
const BASE_DIR = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : __dirname;

const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'repair-log.db');
// Accounts, the list of shops and shared settings (lib/system-db.js).
const SYSTEM_PATH = path.join(DATA_DIR, 'system.db');
const LOCAL_BACKUP_DIR = path.join(BASE_DIR, 'backups');

// Set NAS_BACKUP_DIR in .env (not here) so it survives every future code
// update untouched — see .env.example for the exact format needed for a
// UNC path with backslashes/Cyrillic/spaces.
const NAS_BACKUP_DIR = process.env.NAS_BACKUP_DIR || null;

// Tests: only temp folders, never the real data or the NAS.
const { assertTestFolder } = require('./lib/test-guard');
assertTestFolder(process.env.DATA_ROOT, 'DATA_ROOT');
if (NAS_BACKUP_DIR) assertTestFolder(NAS_BACKUP_DIR, 'NAS_BACKUP_DIR');

// The other shops' database files, from the list of shops in system.db.
// None before the app has first started on a version with system.db.
function otherShopFiles() {
  if (!fs.existsSync(SYSTEM_PATH)) return [];
  const systemDb = new Database(SYSTEM_PATH, { readonly: true });
  try {
    return systemDb.prepare('SELECT name, db_file FROM stores ORDER BY id').all()
      .filter(s => s.db_file !== 'repair-log.db');
  } finally {
    systemDb.close();
  }
}

// Backs up one database to backups/<file>. `what` names it in errors.
async function backUpFile(sourcePath, file, what) {
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: database not found at ${sourcePath}`);
    throw new Error(`Базата данни ${what} не е намерена (${sourcePath})`);
  }
  const db = new Database(sourcePath, { readonly: true });
  try {
    await db.backup(path.join(LOCAL_BACKUP_DIR, file));
  } catch (err) {
    console.error(`Backup of ${sourcePath} failed:`, err);
    throw new Error(`Резервното копие ${what} не можа да бъде създадено: ${err.message}`);
  } finally {
    db.close();
  }
  console.log(`Local backup saved: ${path.join(LOCAL_BACKUP_DIR, file)}`);
}

// Makes the backup, filling in `run` as it goes. Throws if any database
// couldn't be backed up; an unreachable NAS only marks the run as failed.
async function backUp(run) {
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const filename = `repair-log_${timestamp}.db`;
  await backUpFile(DB_PATH, filename, 'на поръчките');
  run.file = filename;
  run.sizeBytes = fs.statSync(path.join(LOCAL_BACKUP_DIR, filename)).size;
  const files = [filename];

  // Accounts, shops and shared settings. Missing only before the app has
  // first started on a version with system.db.
  if (fs.existsSync(SYSTEM_PATH)) {
    const systemFile = `system_${timestamp}.db`;
    await backUpFile(SYSTEM_PATH, systemFile, 'на акаунтите (system.db)');
    run.systemFile = systemFile;
    files.push(systemFile);
  }

  // Every other shop.
  for (const shop of otherShopFiles()) {
    const shopFile = `${path.basename(shop.db_file, '.db')}_${timestamp}.db`;
    await backUpFile(path.join(DATA_DIR, shop.db_file), shopFile, `на магазин „${shop.name}“`);
    run.shopFiles.push(shopFile);
    run.sizeBytes += fs.statSync(path.join(LOCAL_BACKUP_DIR, shopFile)).size;
    files.push(shopFile);
  }

  // Copy to the NAS if configured. This must not crash the whole backup if
  // the NAS happens to be unreachable that night — log a warning instead,
  // and mark the run as failed so it shows in Справки.
  if (NAS_BACKUP_DIR) {
    try {
      fs.mkdirSync(NAS_BACKUP_DIR, { recursive: true });
      for (const f of files) {
        fs.copyFileSync(path.join(LOCAL_BACKUP_DIR, f), path.join(NAS_BACKUP_DIR, f));
        console.log(`Copied to NAS: ${path.join(NAS_BACKUP_DIR, f)}`);
      }
      run.nas = 'ok';
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
    file: null, systemFile: null, shopFiles: [], sizeBytes: null, nas: NAS_BACKUP_DIR ? 'failed' : 'off', error: null
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
