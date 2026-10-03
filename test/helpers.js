// Shared test setup. Each test file runs in its own process (node --test),
// so pointing DATA_ROOT at a fresh temp folder before the app is required
// gives every file its own empty database, never touching real data.
// Never read the real .env in tests (see env.js): a live SMSAPI_TOKEN or
// NAS path there must not leak into test runs. Inherited by the scripts
// and servers the tests start.
process.env.CRAZYPHONE_TEST = '1';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function makeDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-test-'));
}

// Loads the app against a fresh temp database and seeds one login.
// `beforeLoad(dataRoot)` can prepare the data folder first (e.g. an old
// schema, to exercise the migrations in db.js).
function loadApp({ beforeLoad } = {}) {
  const dataRoot = makeDataRoot();
  process.env.DATA_ROOT = dataRoot;
  process.env.SESSION_SECRET = 'test-secret';
  if (beforeLoad) beforeLoad(dataRoot);

  const bcrypt = require('bcrypt');
  const db = require('../db');
  const app = require('../app');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run('tester', bcrypt.hashSync('secret123', 4));
  return { app, db, dataRoot };
}

async function login(agent, username = 'tester', password = 'secret123') {
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  // Kept for raw http requests (e.g. the SSE stream) that bypass the agent.
  agent.sessionCookie = res.headers['set-cookie'][0].split(';')[0];
  return agent;
}

function validTicket(overrides = {}) {
  return {
    customerName: 'Иван Петров',
    phoneContact: '0888123456',
    phoneModel: 'iPhone 15',
    dateReceived: '2026-09-01',
    description: 'Счупен дисплей',
    ...overrides
  };
}

// Runs one of the CLI scripts (backup.js, restore.js) the way Task
// Scheduler / an admin would, against the given data folder.
function runScript(script, args, dataRoot) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    env: { ...process.env, DATA_ROOT: dataRoot, NAS_BACKUP_DIR: '' },
    encoding: 'utf8'
  });
}

module.exports = { ROOT, makeDataRoot, loadApp, login, validTicket, runScript };
