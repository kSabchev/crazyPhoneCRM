// lib/tickets-repo.js: the one place with SQL for orders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers');
const { ticketsRepo } = require('../lib/tickets-repo');

const { db } = loadApp();
const tickets = ticketsRepo(db);

const fields = (over = {}) => ({
  customer_name: 'Мария', phone_contact: '0888123456', date_received: '2026-10-01', date_returned: null,
  phone_model: 'iPhone 13', status: 'за сервиз', description: 'Счупен дисплей', comment: '',
  repair_performed: '', loaner_phone: 'не', phone_password: null, pravim: 'circle', kaparo: 'Не',
  service_price: null, customer_price: null, ...over
});

test('create numbers orders one after another and returns the saved order', () => {
  const a = tickets.create(fields());
  const b = tickets.create(fields({ customer_name: 'Иван' }));
  assert.equal(b.ticket_no, a.ticket_no + 1);
  assert.equal(b.customer_name, 'Иван');
  assert.deepEqual(tickets.get(b.id), b);
});

test('update saves only the given fields; others keep their value', () => {
  const t = tickets.create(fields({ comment: 'пази кутията' }));
  const saved = tickets.update(t.id, { status: 'в сервиз', customer_price: 80 });
  assert.equal(saved.status, 'в сервиз');
  assert.equal(saved.customer_price, 80);
  assert.equal(saved.comment, 'пази кутията');
  // Fields that aren't order columns are ignored, not written.
  assert.equal(tickets.update(t.id, { ticket_no: 999, id: 5 }).ticket_no, t.ticket_no);
});

test('missing orders: get and update give null, remove gives false', () => {
  assert.equal(tickets.get(999999), null);
  assert.equal(tickets.update(999999, { comment: 'x' }), null);
  assert.equal(tickets.remove(999999), false);
});

test('remove deletes the order', () => {
  const t = tickets.create(fields());
  assert.equal(tickets.remove(t.id), true);
  assert.equal(tickets.get(t.id), null);
});

test('list is newest first, and the phone models typed are offered once each', () => {
  tickets.create(fields({ date_received: '2030-01-01', phone_model: 'Pixel 8' }));
  assert.equal(tickets.list()[0].date_received, '2030-01-01');
  const models = tickets.usedPhoneModels();
  assert.ok(models.includes('Pixel 8'));
  assert.equal(models.filter(m => m === 'iPhone 13').length, 1);
});

test('withStatusSince gives when each order entered a status, from the history', () => {
  const t = tickets.create(fields({ status: 'чака клиент' }));
  db.prepare(`INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
    VALUES (?, ?, 'updated', ?, 'x', '2026-09-01 10:00:00')`)
    .run(t.id, t.ticket_no, JSON.stringify({ status: { from: 'в сервиз', to: 'чака клиент' } }));
  const row = tickets.withStatusSince('чака клиент').find(r => r.id === t.id);
  assert.equal(row.status_since, '2026-09-01 10:00:00');
});
