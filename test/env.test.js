// Tests must never read the real .env (env.js): a live SMSAPI token or NAS
// path there would otherwise leak into test runs and could send real SMS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, makeDataRoot } = require('./helpers');

// Runs env.js in a folder whose .env sets SMSAPI_TOKEN, and reports what
// the process ends up with.
function tokenSeen(extraEnv) {
  const dir = makeDataRoot();
  fs.writeFileSync(path.join(dir, '.env'), 'SMSAPI_TOKEN=live-token-from-dotenv\n');
  const env = { ...process.env, ...extraEnv };
  delete env.SMSAPI_TOKEN;
  const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'env.js'))}); console.log(process.env.SMSAPI_TOKEN || 'none')`], {
    cwd: dir, env, encoding: 'utf8'
  });
  return res.stdout.trim();
}

test('in tests (CRAZYPHONE_TEST=1) the .env file is ignored', () => {
  assert.equal(process.env.CRAZYPHONE_TEST, '1'); // set by helpers.js
  assert.equal(tokenSeen({ CRAZYPHONE_TEST: '1' }), 'none');
});

test('outside tests the .env file is read as usual', () => {
  assert.equal(tokenSeen({ CRAZYPHONE_TEST: '' }), 'live-token-from-dotenv');
});
