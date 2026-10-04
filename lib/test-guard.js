// Keeps test runs (CRAZYPHONE_TEST=1, set by test/helpers.js and
// e2e/server.js) from touching anything real: they may only use folders
// inside the system temp folder, and only send requests to this computer.
// Outside tests these checks do nothing.
//
// Used wherever the app writes files (db.js, backup.js, restore.js) or
// talks to an SMS service (smsapi.js, gateway.js).
const os = require('os');
const path = require('path');

const inTests = () => process.env.CRAZYPHONE_TEST === '1';

function isInside(dir, parent) {
  const rel = path.relative(parent, dir);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// `dir` must be inside the temp folder. `what` names it in the error.
function assertTestFolder(dir, what) {
  if (!inTests()) return;
  const norm = p => path.resolve(p).toLowerCase(); // Windows paths ignore case
  if (!dir || !isInside(norm(dir), norm(os.tmpdir()))) {
    throw new Error(`Test safety: ${what} must be a temp folder during tests, not "${dir || '(not set — the app folder)'}". ` +
      'Tests must never use real data (see test/helpers.js loadApp).');
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// `url` must point at this computer (the tests' fake SMS services).
function assertTestUrl(url, what) {
  if (!inTests()) return;
  let host = null;
  try { host = new URL(url).hostname; } catch (_) { /* reported below */ }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Test safety: ${what} must be on this computer during tests, not "${url}".`);
  }
}

module.exports = { assertTestFolder, assertTestUrl };
