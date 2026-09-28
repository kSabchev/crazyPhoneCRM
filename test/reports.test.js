const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login } = require('./helpers');
const { buildReport, parseKaparo, monthsBetween } = require('../reports');

const { app, db } = loadApp();

// A small shop history where every expected figure is worked out by hand.
function seed() {
  const insert = db.prepare(`
    INSERT INTO tickets (ticket_no, customer_name, phone_contact, phone_model, description,
      date_received, date_returned, status, customer_price, service_price, kaparo)
    VALUES (@no, @name, '0888', 'iPhone', 'x', @received, @returned, @status, @price, @cost, @kaparo)`);
  const t = (no, fields) => insert.run({
    no, name: `T${no}`, returned: null, status: 'издаден', price: null, cost: null, kaparo: 'Не', ...fields
  }).lastInsertRowid;

  const ids = {
    t1: t(1, { received: '2026-01-05', returned: '2026-01-10', price: 100, cost: 40 }),        // 5 days
    t2: t(2, { received: '2026-01-20', returned: '2026-02-03', price: 59.99 }),                 // 14 days, no cost
    t3: t(3, { received: '2026-02-01', returned: '2026-02-02' }),                               // 1 day, no price
    t4: t(4, { received: '2025-12-01', returned: '2025-12-20', price: 500, cost: 100 }),        // before range
    t5: t(5, { received: '2026-03-01', status: 'в сервиз', kaparo: 20 }),                       // open 30 days
    t6: t(6, { received: '2026-03-20', status: 'за сервиз', kaparo: '15,50 €' }),               // open 11 days
    t7: t(7, { received: '2026-03-25', status: 'за сервиз', kaparo: '20лв' }),                  // unreadable deposit
    t8: t(8, { received: '2026-03-02' }),                                                       // issued, no return date
    t9: t(9, { received: '2026-03-10', returned: '2026-03-12', price: 0.1, cost: 0.05 }),
    t10: t(10, { received: '2026-03-10', returned: '2026-03-12', price: 0.2, cost: 0.05 })
  };

  const audit = db.prepare(`
    INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, 0, ?, ?, 'tester', ?)`);
  const created = (id, status, at) => audit.run(id, 'created', JSON.stringify({ status }), at);
  const moved = (id, from, to, at) => audit.run(id, 'updated', JSON.stringify({ status: { from, to } }), at);

  created(ids.t1, 'за сервиз', '2026-01-05 10:00:00');
  audit.run(ids.t1, 'updated', JSON.stringify({ comment: { from: '', to: 'x' } }), '2026-01-06 10:00:00');
  moved(ids.t1, 'за сервиз', 'в сервиз', '2026-01-07 10:00:00');   // 2 days за сервиз
  moved(ids.t1, 'в сервиз', 'издаден', '2026-01-10 10:00:00');     // 3 days в сервиз
  created(ids.t5, 'за сервиз', '2026-03-01 10:00:00');
  moved(ids.t5, 'за сервиз', 'в сервиз', '2026-03-04 10:00:00');   // 3 days за сервиз
  created(ids.t4, 'за сервиз', '2025-12-01 10:00:00');
  moved(ids.t4, 'за сервиз', 'издаден', '2025-12-20 10:00:00');    // ends before range
  created(9999, 'за сервиз', '2026-01-01 10:00:00');               // deleted ticket
  moved(9999, 'за сервиз', 'издаден', '2026-02-01 10:00:00');
  return ids;
}
seed();

const report = buildReport(db, { from: '2026-01-01', to: '2026-03-31', today: '2026-03-31' });

test('revenue is counted in the month a ticket was returned, to the cent', () => {
  assert.deepEqual(report.revenue.months, [
    { month: '2026-01', returned: 1, priced: 1, revenue: 100, cost: 40, profit: 60 },
    { month: '2026-02', returned: 2, priced: 1, revenue: 59.99, cost: 0, profit: 59.99 },
    { month: '2026-03', returned: 2, priced: 2, revenue: 0.3, cost: 0.1, profit: 0.2 }
  ]);
  assert.deepEqual(report.revenue.totals, {
    returned: 5, priced: 4, revenue: 160.29, cost: 40.1, profit: 120.19, averageTicket: 40.07
  });
});

test('months with no returns still appear, as zero', () => {
  const r = buildReport(db, { from: '2025-11-01', to: '2026-01-31', today: '2026-03-31' });
  assert.deepEqual(r.revenue.months.map(m => [m.month, m.revenue]), [
    ['2025-11', 0], ['2025-12', 500], ['2026-01', 100]
  ]);
});

test('turnaround covers tickets returned in the range', () => {
  // days: 5, 14, 1, 2, 2
  assert.deepEqual(report.turnaround, { count: 5, averageDays: 4.8, medianDays: 2, maxDays: 14 });
});

test('time in status is rebuilt from the audit log', () => {
  assert.deepEqual(report.statusTime, [
    { status: 'в сервиз', count: 1, averageDays: 3 },
    { status: 'за сервиз', count: 2, averageDays: 2.5 }
  ]);
});

test('workload lists open tickets, oldest first, and deposits currently held', () => {
  const w = report.workload;
  assert.equal(w.openCount, 3);
  assert.deepEqual(w.byStatus, [
    { status: 'за сервиз', count: 2, oldestDays: 11 },
    { status: 'в сервиз', count: 1, oldestDays: 30 }
  ]);
  assert.deepEqual(w.oldest.map(t => [t.ticketNo, t.daysOpen]), [[5, 30], [6, 11], [7, 6]]);
  assert.deepEqual(w.depositsHeld, { amount: 35.5, tickets: 2 });
});

test('data problems that skew the numbers are listed', () => {
  const q = report.dataQuality;
  const nos = key => q[key].tickets.map(t => t.ticketNo);
  assert.deepEqual(nos('returnedWithoutPrice'), [3]);
  assert.deepEqual(nos('returnedWithoutCost'), [2]);
  assert.deepEqual(nos('issuedWithoutReturnDate'), [8]);
  assert.deepEqual(nos('unreadableKaparo'), [7]);
});

test('kaparo parsing', () => {
  assert.equal(parseKaparo(20), 20);
  assert.equal(parseKaparo('20'), 20);
  assert.equal(parseKaparo(' 15,50 € '), 15.5);
  assert.equal(parseKaparo('30 EUR'), 30);
  assert.equal(parseKaparo('Не'), null);
  assert.equal(parseKaparo('не'), null);
  assert.equal(parseKaparo(''), null);
  assert.equal(parseKaparo(null), null);
  assert.equal(parseKaparo('20лв'), undefined);
  assert.equal(parseKaparo('да'), undefined);
});

test('monthsBetween spans year boundaries', () => {
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('GET /api/reports requires login', async () => {
  await request(app).get('/api/reports').expect(401);
});

test('GET /api/reports returns the report for the requested range', async () => {
  const agent = await login(request.agent(app));
  const res = await agent.get('/api/reports?from=2026-01-01&to=2026-03-31').expect(200);
  assert.deepEqual(res.body.range, { from: '2026-01-01', to: '2026-03-31' });
  assert.equal(res.body.revenue.totals.revenue, 160.29);
});

test('GET /api/reports defaults to this year so far', async () => {
  const agent = await login(request.agent(app));
  const res = await agent.get('/api/reports').expect(200);
  const year = String(new Date().getFullYear());
  assert.equal(res.body.range.from, `${year}-01-01`);
  assert.match(res.body.range.to, new RegExp(`^${year}-\\d{2}-\\d{2}$`));
});

test('GET /api/reports rejects bad ranges', async () => {
  const agent = await login(request.agent(app));
  await agent.get('/api/reports?from=2026-13-01&to=2026-12-31').expect(400);
  await agent.get('/api/reports?from=2026-05-01&to=2026-04-01').expect(400);
  await agent.get('/api/reports?from=2000-01-01&to=2026-01-01').expect(400);
});
