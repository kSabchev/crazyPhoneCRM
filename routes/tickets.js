// Orders: list, create, edit, delete, the service label, and the history.
const express = require('express');
const db = require('../db');
const STATUSES = require('../public/statuses');
const { buildServiceLabel } = require('../lbx');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { broadcastChange, getEditingBy } = require('../lib/live');
const { logAudit, TRACKED_FIELDS } = require('../lib/audit');
const { getSettings } = require('../lib/settings-store');
const { localToday, toPrice } = require('../lib/util');
const { validateTicketInput, normalizePravim, normalizeLoaner, normalizePassword } = require('../lib/ticket-input');

const router = express.Router();

const COMPLETED_STATUS = STATUSES.COMPLETED;
// Moving an order to this status zeroes what it would cost (see PUT).
const REFUSED_STATUS = STATUSES.REFUSED;
const REFUSED_AMOUNTS = { kaparo: '0', service_price: 0, customer_price: 0 };

router.get('/api/tickets', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tickets ORDER BY date_received DESC, ticket_no DESC').all();
  for (const row of rows) {
    row.editing_by = getEditingBy(row.id);
  }
  res.json(rows);
});

router.post('/api/tickets', requireAuth, (req, res) => {
  const t = req.body || {};
  const invalid = validateTicketInput(t, { partial: false });
  if (invalid) return res.status(400).json({ error: invalid });

  const nextNoRow = db.prepare('SELECT MAX(ticket_no) AS maxNo FROM tickets').get();
  const nextNo = (nextNoRow.maxNo || 0) + 1;

  // Created already refused: nothing to charge (see the rule in PUT).
  const refusedOnCreate = t.status === REFUSED_STATUS;

  const result = db
    .prepare(
      `INSERT INTO tickets
        (ticket_no, customer_name, phone_contact, date_received, date_returned, phone_model, status, description, comment, repair_performed, loaner_phone, phone_password, pravim, kaparo, service_price, customer_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextNo,
      t.customerName,
      t.phoneContact,
      t.dateReceived,
      t.dateReturned || (t.status === COMPLETED_STATUS ? localToday() : null),
      t.phoneModel,
      t.status || STATUSES.FOR_SERVICE,
      t.description,
      t.comment || '',
      t.repairPerformed || '',
      normalizeLoaner(t.loanerPhone),
      normalizePassword(t.phonePassword),
      normalizePravim(t.pravim, 'circle'),
      refusedOnCreate ? REFUSED_AMOUNTS.kaparo : (t.kaparo && String(t.kaparo).trim() ? String(t.kaparo).trim() : 'Не'),
      refusedOnCreate ? REFUSED_AMOUNTS.service_price : toPrice(t.servicePrice),
      refusedOnCreate ? REFUSED_AMOUNTS.customer_price : toPrice(t.customerPrice)
    );

  const created = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);

  logAudit(created.id, created.ticket_no, 'created', {
    customer_name: created.customer_name,
    phone_contact: created.phone_contact,
    date_received: created.date_received,
    date_returned: created.date_returned,
    phone_model: created.phone_model,
    status: created.status,
    description: created.description,
    comment: created.comment,
    repair_performed: created.repair_performed,
    loaner_phone: created.loaner_phone,
    // Never the value itself — only whether one was entered.
    phone_password_set: !!created.phone_password,
    pravim: created.pravim,
    kaparo: created.kaparo,
    service_price: created.service_price,
    customer_price: created.customer_price
  }, req.session.username);

  broadcastChange('tickets');
  res.status(201).json(created);
});

router.put('/api/tickets/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });

  const t = req.body || {};
  const invalid = validateTicketInput(t, { partial: true });
  if (invalid) return res.status(400).json({ error: invalid });

  const next = {
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

  // Marking a ticket "издаден" means it was handed back today, unless a
  // return date is already set or was sent. Keeps reports accurate even
  // when the status is changed without touching the date field.
  if (next.status === COMPLETED_STATUS && existing.status !== COMPLETED_STATUS && !next.date_returned) {
    next.date_returned = localToday();
  }
  // A refused repair costs nothing: moving an order to "отказан" sets the
  // deposit and both prices to 0 (staff can still change them afterwards).
  if (next.status === REFUSED_STATUS && existing.status !== REFUSED_STATUS) {
    Object.assign(next, REFUSED_AMOUNTS);
  }

  db.prepare(
    `UPDATE tickets SET
      customer_name = ?, phone_contact = ?, date_received = ?, date_returned = ?, phone_model = ?,
      status = ?, description = ?, comment = ?, repair_performed = ?, loaner_phone = ?, phone_password = ?,
      pravim = ?, kaparo = ?, service_price = ?, customer_price = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    next.customer_name, next.phone_contact, next.date_received, next.date_returned,
    next.phone_model, next.status, next.description, next.comment, next.repair_performed, next.loaner_phone,
    next.phone_password, next.pravim, next.kaparo, next.service_price, next.customer_price,
    req.params.id
  );

  // Record only what actually changed, for a readable audit trail. The
  // unlock code is sensitive: the history only notes that it changed,
  // never the old or new value.
  const diff = {};
  for (const [col] of TRACKED_FIELDS) {
    if (String(existing[col] ?? '') !== String(next[col] ?? '')) {
      diff[col] = col === 'phone_password' ? { changed: true } : { from: existing[col], to: next[col] };
    }
  }
  if (Object.keys(diff).length > 0) {
    logAudit(existing.id, existing.ticket_no, 'updated', diff, req.session.username);
  }

  const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  broadcastChange('tickets');
  res.json(updated);
});

router.delete('/api/tickets/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });

  logAudit(existing.id, existing.ticket_no, 'deleted', {
    customer_name: existing.customer_name,
    phone_contact: existing.phone_contact,
    phone_model: existing.phone_model,
    status: existing.status
  }, req.session.username);

  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  broadcastChange('tickets');
  res.json({ ok: true });
});

// Service label for the Brother QL-600: a P-touch Editor .lbx file filled
// in from print-templates/service-label.lbx. Opening it starts P-touch
// Editor, which prints it.
router.get('/api/tickets/:id/service-label.lbx', requireAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const file = buildServiceLabel(ticket, getSettings().shopName);
  res.set('Content-Type', 'application/octet-stream');
  res.attachment(`poruchka-${ticket.ticket_no}.lbx`);
  res.send(file);
});

// ---- History ----
router.get('/api/tickets/:id/history', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE ticket_id = ? ORDER BY performed_at DESC, id DESC')
    .all(req.params.id);
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes) })));
});

router.get('/api/audit', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM audit_log ORDER BY performed_at DESC, id DESC LIMIT 200')
    .all();
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes) })));
});

module.exports = router;
