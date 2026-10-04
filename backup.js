// Backs up the repair log database safely (using SQLite's own online backup
// API, which is safe to run while the app is live) to a local backups/
// folder, then optionally also copies it to a NAS path set via
// NAS_BACKUP_DIR in .env. Every nightly backup is kept indefinitely —
// nothing is ever deleted automatically.
//
// Run manually with:  node backup.js
// Schedule nightly with Windows Task Scheduler — see README for setup.

require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

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

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: database not found at ${DB_PATH}`);
    process.exit(1);
  }
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `repair-log_${timestamp}.db`;
  const localPath = path.join(LOCAL_BACKUP_DIR, filename);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(localPath);
  } finally {
    db.close();
  }
  console.log(`Local backup saved: ${localPath}`);

  // Copy to the NAS if configured. This must not crash the whole backup if
  // the NAS happens to be unreachable that night — log a warning instead.
  if (NAS_BACKUP_DIR) {
    try {
      fs.mkdirSync(NAS_BACKUP_DIR, { recursive: true });
      fs.copyFileSync(localPath, path.join(NAS_BACKUP_DIR, filename));
      console.log(`Copied to NAS: ${path.join(NAS_BACKUP_DIR, filename)}`);
    } catch (err) {
      console.error(`WARNING: could not reach NAS backup path (${NAS_BACKUP_DIR}): ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
