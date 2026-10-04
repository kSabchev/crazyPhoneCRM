// The status rules (public/status-rules.js), shared by the server and the
// order form: what happens when an order enters a status.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const STATUSES = require('../public/statuses');
const { applyTransition, RULES, FORGET_AFTER_DAYS } = require('../public/status-rules');

const today = '2026-10-04';
const order = (fields = {}) => ({
  status: STATUSES.IN_SERVICE, date_returned: null, kaparo: '20', service_price: 30, customer_price: 80, ...fields
});

test('becoming "издаден" fills in today\'s return date only when it is empty', () => {
  const before = order();
  assert.equal(applyTransition(before, { ...before, status: STATUSES.COMPLETED }, { today }).date_returned, today);
  const dated = applyTransition(before, { ...before, status: STATUSES.COMPLETED, date_returned: '2026-10-01' }, { today });
  assert.equal(dated.date_returned, '2026-10-01');
});

test('becoming "отказан" zeroes the deposit and both prices', () => {
  const before = order();
  const after = applyTransition(before, { ...before, status: STATUSES.REFUSED }, { today });
  assert.deepEqual([after.kaparo, after.service_price, after.customer_price], ['0', 0, 0]);
});

test('rules run only on entering a status, not when it stays the same', () => {
  const refused = order({ status: STATUSES.REFUSED, kaparo: '5' });
  assert.equal(applyTransition(refused, { ...refused, customer_price: 10 }, { today }).customer_price, 10);
  const completed = order({ status: STATUSES.COMPLETED });
  assert.equal(applyTransition(completed, { ...completed }, { today }).date_returned, null);
});

test('a new order (no "before") gets the rules for the status it is created with', () => {
  assert.equal(applyTransition(null, order({ status: STATUSES.COMPLETED }), { today }).date_returned, today);
  assert.equal(applyTransition(null, order({ status: STATUSES.REFUSED }), { today }).customer_price, 0);
});

test('other statuses change nothing, and the inputs are never modified', () => {
  const before = order();
  const after = { ...before, status: STATUSES.WAITING };
  const copy = { ...after };
  assert.deepEqual(applyTransition(before, after, { today }), copy);
  assert.deepEqual(after, copy);
});

test('Настройки lists every rule, including the 30-day "забравен" one', () => {
  assert.deepEqual(RULES.map(r => r.status), [STATUSES.COMPLETED, STATUSES.REFUSED, STATUSES.FORGOTTEN]);
  for (const r of RULES) assert.ok(r.when && r.text, r.status);
  assert.match(RULES[2].text, new RegExp(`${FORGET_AFTER_DAYS} дни`));
});
