// @ts-check
// Orders: list, create, edit, delete, the service label, and the history.
// In the admins' all-shops view, every shop's orders (lib/ticket-target.js).
const express = require('express');
const STATUSES = require('../public/statuses');
const { buildServiceLabel } = require('../lbx');
const { requireAuth, requireManager } = require('../lib/auth');
const { getEditingBy } = require('../lib/live');
const { ticketEvents } = require('../lib/ticket-events');
const { applyTransition } = require('../public/status-rules');
const { getSettings } = require('../lib/settings-store');
const { localToday, toPrice } = require('../lib/util');
const { validateTicketInput, normalizePravim, normalizeLoaner, normalizePassword } = require('../lib/ticket-input');
const { findTicket, present, shopsOf, orderNumber } = require('../lib/ticket-target');
const stores = require('../lib/stores');

const NOT_FOUND = 'Поръчката не е намерена';


const router = express.Router();

router.get('/api/tickets', requireAuth, (req, res) => {
  // With who's viewing each order right now ("👁 name" in the table).
  res.json(shopsOf(req).flatMap(store => store.tickets.list()
    .map(row => present(req, store, { ...row, editing_by: getEditingBy(store.id, row.id) }))));
});

router.post('/api/tickets', requireAuth, (req, res) => {
  const t = req.body || {};
  const invalid = validateTicketInput(t, { partial: false });
  if (invalid) return res.status(400).json({ error: invalid });
  // In the all-shops view the new order's shop is chosen in the form.
  const store = req.allShops ? stores.get(t.storeId) : req.store;
  if (!store) return res.status(400).json({ error: 'Изберете магазин за поръчката' });

  // New orders get the status rules too (e.g. created already refused:
  // nothing to charge) — see public/status-rules.js.
  const fields = applyTransition(null, {
    customer_name: t.customerName,
    phone_contact: t.phoneContact,
    date_received: t.dateReceived,
    date_returned: t.dateReturned || null,
    phone_model: t.phoneModel,
    status: t.status || STATUSES.FOR_SERVICE,
    description: t.description,
    comment: t.comment || '',
    repair_performed: t.repairPerformed || '',
    loaner_phone: normalizeLoaner(t.loanerPhone),
    phone_password: normalizePassword(t.phonePassword),
    pravim: normalizePravim(t.pravim, 'circle'),
    kaparo: t.kaparo && String(t.kaparo).trim() ? String(t.kaparo).trim() : 'Не',
    service_price: toPrice(t.servicePrice),
    customer_price: toPrice(t.customerPrice)
  }, { today: localToday() });

  const created = store.tickets.create(fields);
  // History and live updates: lib/ticket-listeners.js.
  ticketEvents.emit('created', { store, after: created, user: req.session.username });
  res.status(201).json(present(req, store, created));
});

router.put('/api/tickets/:id', requireAuth, (req, res) => {
  const found = findTicket(req);
  if (!found) return res.status(404).json({ error: NOT_FOUND });
  const { store, ticket: existing } = found;

  const t = req.body || {};
  const invalid = validateTicketInput(t, { partial: true });
  if (invalid) return res.status(400).json({ error: invalid });

  let next = {
    customer_name: t.customerName ?? existing.customer_name,
    phone_contact: t.phoneContact ?? existing.phone_contact,
    date_received: t.dateReceived ?? existing.date_received,
    date_returned: t.dateReturned !== undefined ? (t.dateReturned || null) : existing.date_returned,
    phone_model: t.phoneModel ?? existing.phone_model,
    status: t.status ?? existing.status,
    description: t.description ?? existing.description,
    comment: t.comment !== undefined ? t.comment : existing.comment,
    repair_performed: t.repairPerformed !== undefined ? t.repairPerformed : existing.repair_performed,
    loaner_phone: t.loanerPhone !== undefined ? normalizeLoaner(t.loanerPhone) : existing.loaner_phone,
    phone_password: t.phonePassword !== undefined ? normalizePassword(t.phonePassword) : existing.phone_password,
    pravim: t.pravim !== undefined ? normalizePravim(t.pravim, existing.pravim) : existing.pravim,
    kaparo: t.kaparo !== undefined
      ? (String(t.kaparo ?? '').trim() || 'Не')
      : existing.kaparo,
    service_price: toPrice(t.servicePrice),
    customer_price: toPrice(t.customerPrice)
  };
  if (t.servicePrice === undefined) next.service_price = existing.service_price;
  if (t.customerPrice === undefined) next.customer_price = existing.customer_price;

  // E.g. "издаден" fills in today's return date, "отказан" zeroes the
  // amounts — see public/status-rules.js.
  next = applyTransition(existing, next, { today: localToday() });

  const updated = store.tickets.update(existing.id, next);
  ticketEvents.emit('updated', { store, before: existing, after: updated, user: req.session.username });
  res.json(present(req, store, updated));
});

// Managers and admins only.
router.delete('/api/tickets/:id', requireManager, (req, res) => {
  const found = findTicket(req);
  if (!found) return res.status(404).json({ error: NOT_FOUND });
  const { store, ticket: existing } = found;

  store.tickets.remove(existing.id);
  ticketEvents.emit('deleted', { store, before: existing, user: req.session.username });
  res.json({ ok: true });
});

// Service label for the Brother QL-600: a P-touch Editor .lbx file filled
// in from print-templates/service-label.lbx. Opening it starts P-touch
// Editor, which prints it.
router.get('/api/tickets/:id/service-label.lbx', requireAuth, (req, res) => {
  const found = findTicket(req);
  if (!found) return res.status(404).json({ error: NOT_FOUND });
  const { store, ticket } = found;
  const number = orderNumber(store, ticket);
  const file = buildServiceLabel({ ...ticket, ticket_no: number }, getSettings(store.db).shopName);
  res.set('Content-Type', 'application/octet-stream');
  res.attachment(`poruchka-${number}.lbx`);
  res.send(file);
});

// ---- History ----
router.get('/api/tickets/:id/history', requireAuth, (req, res) => {
  const found = findTicket(req);
  if (!found) return res.status(404).json({ error: NOT_FOUND });
  const rows = /** @type {import('../types/app').AuditRow[]} */ (found.store.db
    .prepare('SELECT * FROM audit_log WHERE ticket_id = ? ORDER BY performed_at DESC, id DESC')
    .all(found.ticket.id));
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes) })));
});

// The newest 200 changes; in the all-shops view, from every shop, each with
// its shop (store_name, store_prefix).
const ACTIVITY_LIMIT = 200;
router.get('/api/audit', requireAuth, (req, res) => {
  const rows = shopsOf(req).flatMap(store =>
    /** @type {import('../types/app').AuditRow[]} */ (store.db
      .prepare('SELECT * FROM audit_log ORDER BY performed_at DESC, id DESC LIMIT ?')
      .all(ACTIVITY_LIMIT))
      .map(r => ({ ...r, changes: JSON.parse(r.changes), store_id: store.id, store_name: store.name, store_prefix: store.prefix })));
  rows.sort((a, b) => (a.performed_at < b.performed_at ? 1 : a.performed_at > b.performed_at ? -1 : b.id - a.id));
  res.json(rows.slice(0, ACTIVITY_LIMIT));
});

module.exports = router;
