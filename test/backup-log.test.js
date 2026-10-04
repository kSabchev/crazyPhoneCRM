// Every backup run is recorded (lib/backup-log.js): the latest 5, shown
// in Справки and checked after an admin logs in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const request = require('supertest');
const { ROOT, loadApp, login, makeDataRoot } = require('./helpers');
const { readBackupLog, recordBackupRun, KEEP } = require('../lib/backup-log');

const { app, db } = loadApp();

function makeLiveDb(dataRoot) {
  fs.mkdirSync(path.join(dataRoot, 'data'), { recursive: true });
  const live = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
  live.exec('CREATE TABLE t (x)');
  live.close();
}
function backup(dataRoot, nasDir = '') {
  return spawnSync(process.execPath, [path.join(ROOT, 'backup.js')], {
    cwd: ROOT, env: { ...process.env, DATA_ROOT: dataRoot, NAS_BACKUP_DIR: nasDir }, encoding: 'utf8'
  });
}
const logOf = dataRoot => readBackupLog(path.join(dataRoot, 'backups'));

test('a successful backup is recorded with its file and size', () => {
  const dataRoot = makeDataRoot();
  makeLiveDb(dataRoot);
  assert.equal(backup(dataRoot).status, 0);
  const [run] = logOf(dataRoot);
  assert.equal(run.ok, true);
  assert.equal(run.error, null);
  assert.equal(run.nas, 'off');
  assert.match(run.file, /^repair-log_.*\.db$/);
  assert.ok(run.sizeBytes > 0);
  assert.ok(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));
});

test('a backup that could not be made is recorded as failed, with the reason', () => {
  const dataRoot = makeDataRoot(); // no database in it
  assert.notEqual(backup(dataRoot).status, 0);
  const [run] = logOf(dataRoot);
  assert.equal(run.ok, false);
  assert.match(run.error, /Базата данни не е намерена/);
  assert.equal(run.file, null);
});

test('an unreachable NAS marks the run failed, though the local copy was saved', () => {
  const dataRoot = makeDataRoot();
  makeLiveDb(dataRoot);
  // A file where the NAS folder should be: creating the folder fails.
  const notAFolder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-nas-')), 'nas');
  fs.writeFileSync(notAFolder, 'x');
  const res = backup(dataRoot, path.join(notAFolder, 'backups'));
  assert.equal(res.status, 0, 'the nightly job itself still succeeds, as before');
  const [run] = logOf(dataRoot);
  assert.equal(run.ok, false);
  assert.equal(run.nas, 'failed');
  assert.match(run.error, /Локалното копие е запазено/);
  assert.ok(run.file);
});

test('a backup copied to the NAS is recorded as such', () => {
  const dataRoot = makeDataRoot();
  makeLiveDb(dataRoot);
  const nas = fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-nas-'));
  assert.equal(backup(dataRoot, nas).status, 0);
  const [run] = logOf(dataRoot);
  assert.equal(run.ok, true);
  assert.equal(run.nas, 'ok');
  assert.ok(fs.existsSync(path.join(nas, run.file)));
});

test(`only the latest ${KEEP} runs are kept, newest first`, () => {
  const dir = path.join(makeDataRoot(), 'backups');
  for (let i = 1; i <= KEEP + 2; i++) recordBackupRun({ startedAt: `run ${i}`, ok: true }, dir);
  assert.deepEqual(readBackupLog(dir).map(r => r.startedAt), ['run 7', 'run 6', 'run 5', 'run 4', 'run 3']);
});

test('a missing or unreadable log counts as empty, and is replaced on the next run', () => {
  const dir = path.join(makeDataRoot(), 'backups');
  assert.deepEqual(readBackupLog(dir), []);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'backup-log.json'), '{ not json');
  assert.deepEqual(readBackupLog(dir), []);
  recordBackupRun({ startedAt: 'new', ok: true }, dir);
  assert.deepEqual(readBackupLog(dir).map(r => r.startedAt), ['new']);
});

test('admins see the backup log; staff and visitors do not', async () => {
  // This app's own backups folder (loadApp's temp DATA_ROOT).
  recordBackupRun({ startedAt: '2026-10-04T01:00:00.000Z', ok: false, error: 'грешка' });
  const admin = await login(request.agent(app));
  const body = (await admin.get('/api/backups').expect(200)).body;
  assert.equal(body.keep, KEEP);
  assert.equal(body.runs[0].error, 'грешка');

  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('staff1', ?, 'staff')")
    .run(require('bcrypt').hashSync('secret123', 4));
  const staff = await login(request.agent(app), 'staff1');
  await staff.get('/api/backups').expect(403);
  await request(app).get('/api/backups').expect(401);
});
