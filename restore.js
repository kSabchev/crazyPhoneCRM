// Restores the repair log database from a backup file created by
// backup.js. The current live database is never deleted — it's moved
// aside into data/pre-restore/ with a timestamp first, so a mistaken
// restore can always be undone.
//
// IMPORTANT: stop the app (or the RepairLog Windows service) before
// running this. Restoring into a database file the server has open can
// corrupt it.
//
// Usage:
//   node restore.js                          List available backups
//   node restore.js <filename>                Restore that specific backup
//   node restore.js latest                    Restore the most recent backup
//                                            of the first shop
//
// The name says which database a backup replaces:
//   repair-log_…   the first shop (data/repair-log.db)
//   system_…       accounts, shops, shared settings (data/system.db)
//   shop-<id>_…    another shop (data/shop-<id>.db)

require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Same DATA_ROOT rule as the app (lib/data-dir.js).
const BASE_DIR = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : __dirname;

const DATA_DIR = path.join(BASE_DIR, 'data');
const BACKUP_DIR = path.join(BASE_DIR, 'backups');
const PRE_RESTORE_DIR = path.join(BASE_DIR, 'data', 'pre-restore');

// Tests: only temp folders, never the real database.
require('./lib/test-guard').assertTestFolder(process.env.DATA_ROOT, 'DATA_ROOT');

function listBackups(prefix = 'repair-log_') {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.db'))
    .sort() // filenames are ISO timestamps, so this sorts chronologically
    .reverse();
}

// The database a backup file replaces ("shop-2_2026-….db" -> "shop-2"),
// or null for a file that isn't one of ours.
function databaseOf(filename) {
  const m = /^(repair-log|system|shop-\d+)_\d{4}-\d{2}-\d{2}T[\d-]+\.db$/.exec(filename);
  return m ? m[1] : null;
}

// Backups of the other shops, grouped by database: { 'shop-2': [...] }.
function otherShopBackups() {
  const groups = {};
  for (const f of listBackups('shop-')) {
    const name = databaseOf(f);
    if (name) (groups[name] = groups[name] || []).push(f);
  }
  return groups;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// On Windows, a file that another process has open can't be deleted or
// overwritten (EBUSY) — even a moment after that process is told to stop,
// the OS can take a beat to actually release the lock. Retry a few times
// before giving up, rather than failing on the first timing hiccup.
function unlinkWithRetry(filePath, attempts = 5, delayMs = 1000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') return; // already gone — fine
      if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
      if (i === attempts) {
        const lockedErr = new Error(
          `"${filePath}" is still locked by another process after ${attempts} attempts.\n\n` +
          `This almost always means the app (or the RepairLog service) is still running.\n` +
          `  - If using the service: run "nssm status RepairLog" — it should say SERVICE_STOPPED.\n` +
          `    Stop it with "nssm stop RepairLog" and wait a few seconds.\n` +
          `  - If running "node server.js" directly: make sure that window was actually closed\n` +
          `    or Ctrl+C'd, not just minimized.\n` +
          `  - Check Task Manager for a lingering node.exe process and end it if one remains.\n\n` +
          `Nothing has been lost — your original database at ${filePath} is untouched.\n` +
          `Stop the app fully, then run this restore command again.`
        );
        lockedErr.code = err.code;
        throw lockedErr;
      }
      console.log(`File is locked (attempt ${i}/${attempts}) — waiting a moment and retrying...`);
      sleepSync(delayMs);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  const backups = listBackups();

  if (!arg) {
    if (backups.length === 0) {
      console.log(`No backups found in ${BACKUP_DIR}`);
      return;
    }
    console.log(`Available backups (newest first), in ${BACKUP_DIR}:\n`);
    console.log(`The first shop (data/repair-log.db):\n`);
    backups.forEach(f => console.log('  ' + f));
    const byNumber = (a, b) => Number(a[0].slice(5)) - Number(b[0].slice(5)); // "shop-2" before "shop-10"
    for (const [name, files] of Object.entries(otherShopBackups()).sort(byNumber)) {
      console.log(`\nShop ${name} (data/${name}.db):\n`);
      files.forEach(f => console.log('  ' + f));
    }
    const systemBackups = listBackups('system_');
    if (systemBackups.length) {
      console.log(`\nAccounts and shops (system.db) — restore only if accounts were lost:\n`);
      systemBackups.forEach(f => console.log('  ' + f));
    }
    console.log(`\nRestore one with:  node restore.js <filename>`);
    console.log(`Or the newest with: node restore.js latest`);
    return;
  }

  const filename = arg === 'latest' ? backups[0] : arg;
  if (!filename) {
    console.error('No backups available to restore.');
    process.exit(1);
  }

  const sourcePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: backup file not found: ${sourcePath}`);
    console.error(`Run "node restore.js" with no arguments to see available backups.`);
    process.exit(1);
  }

  // Move the current live database aside rather than deleting it, so a
  // mistaken restore is always recoverable. This uses the same online
  // backup API as backup.js — NOT a raw file copy/rename — because in
  // WAL mode, recent writes can sit in the -wal file for a long time
  // before SQLite auto-checkpoints them into the main .db file. A raw
  // file operation on the main file alone (or deleting the sidecar
  // files) can silently discard real, uncommitted data. Going through
  // db.backup() always captures the true, complete, current state.
  // The name says which database it replaces (databaseOf).
  const label = databaseOf(filename);
  if (!label) {
    console.error(`ERROR: "${filename}" is not a backup made by backup.js.`);
    process.exit(1);
  }
  const targetPath = path.join(DATA_DIR, `${label}.db`);

  if (fs.existsSync(targetPath)) {
    fs.mkdirSync(PRE_RESTORE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const savedPath = path.join(PRE_RESTORE_DIR, `${label}_before-restore_${stamp}.db`);

    const currentDb = new Database(targetPath, { readonly: true });
    try {
      await currentDb.backup(savedPath);
    } finally {
      currentDb.close();
    }
    console.log(`Current database safely backed up to: ${savedPath}`);

    // Now safe to remove the live file and its WAL/SHM sidecars — the
    // safety copy above already captured their true combined state.
    // (Reads succeed even while the app has the file open, per SQLite's
    // WAL design — it's specifically deleting/overwriting that Windows
    // blocks while another process holds the file open, hence the retry.)
    unlinkWithRetry(targetPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = targetPath + suffix;
      if (fs.existsSync(sidecar)) unlinkWithRetry(sidecar);
    }
  }

  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Restored "${filename}" as the live database.`);
  console.log(`Restart the app (or the RepairLog service) now.`);
}

main().catch(err => {
  console.error('\nRestore failed:\n');
  console.error(err.message);
  process.exit(1);
});
