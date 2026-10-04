// Tests can't touch anything real (lib/test-guard.js): no data, backup or
// NAS folder outside the temp folder, no requests to real SMS services.
//
// The probes point at a harmless folder inside test/ that doesn't exist —
// never at the real data/ folder — and check it's still not there after.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./helpers');

const PROBE = path.join(ROOT, 'test', '.guard-probe');

function run(script, env) {
  const childEnv = { ...process.env, CRAZYPHONE_TEST: '1', ...env };
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
  return spawnSync(process.execPath, script.endsWith('.js') ? [path.join(ROOT, script)] : ['-e', script], {
    cwd: ROOT, env: childEnv, encoding: 'utf8', timeout: 15000
  });
}

function assertRefused(res, pattern) {
  const created = fs.existsSync(PROBE);
  if (created) fs.rmSync(PROBE, { recursive: true, force: true });
  assert.notEqual(res.status, 0, 'should have stopped');
  assert.match(res.stderr, pattern);
  assert.equal(created, false, 'nothing may be created outside the temp folder');
}

test('the database refuses a non-temp DATA_ROOT, or none, during tests', () => {
  assertRefused(run("require('./db')", { DATA_ROOT: PROBE }), /Test safety: DATA_ROOT/);
  assertRefused(run("require('./db')", { DATA_ROOT: undefined }), /not set — the app folder/);
});

test('backup and restore refuse a non-temp DATA_ROOT during tests', () => {
  assertRefused(run('backup.js', { DATA_ROOT: PROBE, NAS_BACKUP_DIR: '' }), /Test safety: DATA_ROOT/);
  assertRefused(run('restore.js', { DATA_ROOT: PROBE }), /Test safety: DATA_ROOT/);
});

test('backup refuses a real NAS folder during tests', () => {
  const dataRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'crazyphone-guard-'));
  assertRefused(run('backup.js', { DATA_ROOT: dataRoot, NAS_BACKUP_DIR: PROBE }), /Test safety: NAS_BACKUP_DIR/);
});

test('SMS requests to anything but this computer are refused during tests', async () => {
  const smsapi = require('../smsapi');
  const gateway = require('../gateway');
  const saved = { ...process.env };
  try {
    process.env.SMSAPI_TOKEN = 'token';
    delete process.env.SMSAPI_URL; // the real https://api.smsapi.bg
    delete process.env.DEMO_MODE;
    await assert.rejects(smsapi.send('+359888123456', 'x'), /Test safety: SMSAPI_URL/);

    process.env.SMS_GATEWAY_URL = 'http://192.0.2.10:8080'; // a reserved, never-used address
    await assert.rejects(gateway.send('+359888123456', 'x'), /Test safety: SMS_GATEWAY_URL/);
    await assert.rejects(gateway.state('abc'), /Test safety/);
    await assert.rejects(gateway.serviceStatus(), /Test safety/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('outside tests the guard does nothing', () => {
  const res = run(
    "const g=require('./lib/test-guard');g.assertTestFolder('C:/real/data','x');g.assertTestUrl('https://api.smsapi.bg','y');console.log('ok')",
    { CRAZYPHONE_TEST: undefined }
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /ok/);
});
