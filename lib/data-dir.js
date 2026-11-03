// @ts-check
// Where the databases live: the data/ folder in DATA_ROOT, or in the app
// folder when DATA_ROOT isn't set. DATA_ROOT lets the databases, backups and
// pre-restore safety copies all live outside the versioned app folder (e.g.
// a stable D:\CrazyPhoneData), so redeploying never touches them.
const fs = require('fs');
const path = require('path');
const { assertTestFolder } = require('./test-guard');

/** @returns {string} */
function dataDir() {
  // Tests must always use their own temp folder (test/helpers.js sets it in
  // loadApp) — never the app folder or a real data folder.
  assertTestFolder(process.env.DATA_ROOT, 'DATA_ROOT');
  const base = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : path.join(__dirname, '..');
  const dir = path.join(base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { dataDir };
