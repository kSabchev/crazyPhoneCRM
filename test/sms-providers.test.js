// The SMS provider list in sms.js: every provider has the same four
// functions, and the first one set up is the one used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers'); // never read the real .env
const sms = require('../sms');

const ENV = ['DEMO_MODE', 'SMSAPI_TOKEN', 'SMS_GATEWAY_URL'];
async function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  try { return await fn(); } finally {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('every provider has config, send, state and serviceStatus', () => {
  assert.ok(sms.PROVIDERS.length >= 3);
  for (const [name, impl] of sms.PROVIDERS) {
    for (const fn of ['config', 'send', 'state', 'serviceStatus']) {
      assert.equal(typeof impl[fn], 'function', `${name}.${fn}`);
    }
  }
  const names = sms.PROVIDERS.map(([name]) => name);
  assert.equal(new Set(names).size, names.length, 'provider names are unique');
});

test('the first provider that is set up is used', async () => {
  await withEnv({}, () => assert.equal(sms.provider(), null));
  await withEnv({ SMS_GATEWAY_URL: 'http://127.0.0.1:1' }, () => assert.equal(sms.provider(), 'phone'));
  await withEnv({ SMS_GATEWAY_URL: 'http://127.0.0.1:1', SMSAPI_TOKEN: 't' }, () => assert.equal(sms.provider(), 'smsapi'));
  // Demo mode always wins, so the public demo can never send real SMS.
  await withEnv({ SMS_GATEWAY_URL: 'http://127.0.0.1:1', SMSAPI_TOKEN: 't', DEMO_MODE: 'true' }, () => assert.equal(sms.provider(), 'demo'));
});

test('with SMS off, nothing is sent and no state is looked up', async () => {
  await withEnv({}, async () => {
    await assert.rejects(sms.sendSms('+359888123456', 'x'), /не са настроени/);
    assert.equal(await sms.getSmsState('abc'), null);
    assert.equal((await sms.getPhoneStatus({ fresh: true })).state, 'off');
  });
});
