// backup.js / restore.js are run as real CLI processes, exactly as Task
// Scheduler or an admin would, against a throwaway DATA_ROOT.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { makeDataRoot, runScript } = require('./helpers');

function dbPath(dataRoot) {
  return path.join(dataRoot, 'data', 'repair-log.db');
}

function createDb(dataRoot, names) {
  fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });
  const db = new Database(dbPath(dataRoot));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (name TEXT)');
  for (const n of names) db.prepare('INSERT INTO t VALUES (?)').run(n);
  return db;
}

function namesIn(file) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT name FROM t ORDER BY rowid').all().map(r => r.name);
  } finally {
    db.close();
  }
}

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

// Simulates the app being killed (crash, power loss, hard service stop)
// right after a write: the row exists only in the -wal file, never
// checkpointed into the main .db file.
function writeThenCrash(dataRoot, name) {
  const script = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1]);
    db.pragma('wal_autocheckpoint = 0');
    db.prepare('INSERT INTO t VALUES (?)').run(process.argv[2]);
    process.kill(process.pid, 'SIGKILL');
  `;
  spawnSync(process.execPath, ['-e', script, dbPath(dataRoot), name], {
    cwd: path.join(__dirname, '..')
  });
}

test('backup copies the live database, including writes still in the WAL', () => {
  const dataRoot = makeDataRoot();
  const live = createDb(dataRoot, ['a']);
  live.pragma('wal_autocheckpoint = 0');
  live.prepare('INSERT INTO t VALUES (?)').run('in-wal-only');

  try {
    const res = runScript('backup.js', [], dataRoot);
    assert.equal(res.status, 0, res.stderr);
  } finally {
    live.close();
  }

  const backups = listDir(path.join(dataRoot, 'backups')).filter(f => f.endsWith('.db')); // not backup-log.json
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^repair-log_.*\.db$/);
  assert.deepEqual(namesIn(path.join(dataRoot, 'backups', backups[0])), ['a', 'in-wal-only']);
});

test('backup fails clearly when there is no database', () => {
  const res = runScript('backup.js', [], makeDataRoot());
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /database not found/);
});

test('restore with no arguments lists backups and changes nothing', () => {
  const dataRoot = makeDataRoot();
  createDb(dataRoot, ['a']).close();
  runScript('backup.js', [], dataRoot);

  const res = runScript('restore.js', [], dataRoot);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /repair-log_.*\.db/);
  assert.deepEqual(listDir(path.join(dataRoot, 'data', 'pre-restore')), []);
});

test('restore latest replaces the live database and keeps a safety copy', () => {
  const dataRoot = makeDataRoot();
  const db = createDb(dataRoot, ['original']);
  db.close();
  runScript('backup.js', [], dataRoot);

  const after = new Database(dbPath(dataRoot));
  after.prepare('INSERT INTO t VALUES (?)').run('added-after-backup');
  after.close();

  const res = runScript('restore.js', ['latest'], dataRoot);
  assert.equal(res.status, 0, res.stderr);

  assert.deepEqual(namesIn(dbPath(dataRoot)), ['original']);
  const safety = listDir(path.join(dataRoot, 'data', 'pre-restore'));
  assert.equal(safety.length, 1);
  assert.deepEqual(
    namesIn(path.join(dataRoot, 'data', 'pre-restore', safety[0])),
    ['original', 'added-after-backup']
  );
});

// Regression test for the WAL data-loss bug: the safety copy must include
// writes that only ever reached the -wal file before the app died.
test('the pre-restore safety copy includes writes left only in the WAL', () => {
  const dataRoot = makeDataRoot();
  createDb(dataRoot, ['original']).close();
  runScript('backup.js', [], dataRoot);

  writeThenCrash(dataRoot, 'unsaved-before-crash');
  const wal = dbPath(dataRoot) + '-wal';
  assert.ok(fs.existsSync(wal) && fs.statSync(wal).size > 0, 'precondition: WAL holds the write');

  const res = runScript('restore.js', ['latest'], dataRoot);
  assert.equal(res.status, 0, res.stderr);

  assert.ok(!fs.existsSync(wal), 'stale WAL removed so it cannot replay onto the restored db');
  assert.deepEqual(namesIn(dbPath(dataRoot)), ['original']);
  const [safety] = listDir(path.join(dataRoot, 'data', 'pre-restore'));
  assert.deepEqual(
    namesIn(path.join(dataRoot, 'data', 'pre-restore', safety)),
    ['original', 'unsaved-before-crash']
  );
});

test('restore of a missing backup file fails and leaves the live database alone', () => {
  const dataRoot = makeDataRoot();
  createDb(dataRoot, ['keep-me']).close();

  const res = runScript('restore.js', ['repair-log_nope.db'], dataRoot);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /backup file not found/);
  assert.deepEqual(namesIn(dbPath(dataRoot)), ['keep-me']);
});
