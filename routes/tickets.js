// Orders: list, create, edit, delete, the service label, and the history.
const express = require('express');
const db = require('../db');
const STATUSES = require('../public/statuses');
const { buildServiceLabel } = require('../lbx');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { broadcastChange, getEditingBy } = require('../lib/live');
const { logAudit, diffTickets } = require('../lib/audit');
const { applyTransition } = require('../public/status-rules');
const { getSettings } = require('../lib/settings-store');
const { localToday, toPrice } = require('../lib/util');
const { validateTicketInput, normalizePravim, normalizeLoaner, normalizePassword } = require('../lib/ticket-input');

const router = express.Router();

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

  const result = db
    .prepare(
      `INSERT INTO tickets
        (ticket_no, customer_name, phone_contact, date_received, date_returned, phone_model, status, description, comment, repair_performed, loaner_phone, phone_password, pravim, kaparo, service_price, customer_price)
       VALUES (@ticket_no, @customer_name, @phone_contact, @date_received, @date_returned, @phone_model, @status, @description, @comment, @repair_performed, @loaner_phone, @phone_password, @pravim, @kaparo, @service_price, @customer_price)`
    )
    .run({ ticket_no: nextNo, ...fields });

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

  const diff = diffTickets(existing, next);
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
