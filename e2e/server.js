// Started by Playwright (see playwright.config.js): runs the real server.js
// against a fresh temp database with two staff logins, so browser tests
// never touch real data. SMS goes to a fake phone gateway (port 3199) that
// only records what it was asked to send — inspect it at /__sent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGateway } = require('../test/fake-sms-gateway');

const FAKE_SMS_PORT = 3199;

(async () => {
  process.env.DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-e2e-'));
  process.env.SESSION_SECRET = 'e2e-secret';

  const gateway = await startFakeGateway({ port: FAKE_SMS_PORT, user: 'sms', password: 'secret' });
  process.env.SMS_GATEWAY_URL = gateway.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';

  const bcrypt = require('bcrypt');
  const db = require('../db');

  for (const username of ['alice', 'bob']) {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, bcrypt.hashSync('secret123', 4));
  }

  require('../server');
})();
