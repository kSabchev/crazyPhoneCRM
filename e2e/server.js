// Started by Playwright (see playwright.config.js): runs the real server.js
// against a fresh temp database with two staff logins, so browser tests
// never touch real data.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-e2e-'));
process.env.SESSION_SECRET = 'e2e-secret';

const bcrypt = require('bcrypt');
const db = require('../db');

for (const username of ['alice', 'bob']) {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, bcrypt.hashSync('secret123', 4));
}

require('../server');
