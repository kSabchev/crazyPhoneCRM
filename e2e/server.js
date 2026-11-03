// Started by Playwright (see playwright.config.js): runs the real server.js
// against a fresh temp database with two shops and a login for each role,
// so browser tests never touch real data. SMS goes to a fake phone gateway (port 3199) that
// only records what it was asked to send — inspect it at /__sent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeGateway } = require('../test/fake-sms-gateway');

const FAKE_SMS_PORT = 3199;

(async () => {
  // Never read the real .env (see env.js) — e.g. a live SMSAPI_TOKEN.
  process.env.CRAZYPHONE_TEST = '1';
  process.env.DATA_ROOT = process.env.CRAZYPHONE_E2E_DATA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'crazyphone-e2e-'));
  process.env.SESSION_SECRET = 'e2e-secret';

  const gateway = await startFakeGateway({ port: FAKE_SMS_PORT, user: 'sms', password: 'secret' });
  process.env.SMS_GATEWAY_URL = gateway.url;
  process.env.SMS_GATEWAY_USER = 'sms';
  process.env.SMS_GATEWAY_PASSWORD = 'secret';

  const bcrypt = require('bcrypt');
  const db = require('../lib/system-db'); // accounts
  const stores = require('../lib/stores');

  // The first shop, where the tests work, and a second one.
  const first = stores.defaultStore();
  const second = stores.create({ name: 'Магазин Лозенец', prefix: 'Л' });

  // alice is an admin (all shops), bob staff and vera the manager of the
  // first shop, dora staff in the second — so every view is tested.
  for (const [username, role, shop] of [
    ['alice', 'admin', null], ['bob', 'staff', first], ['vera', 'shop_manager', first], ['dora', 'staff', second]
  ]) {
    db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?, ?, ?, ?)')
      .run(username, bcrypt.hashSync('secret123', 4), role, shop ? shop.id : null);
  }

  require('../server');
})();
