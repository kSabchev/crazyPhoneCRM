// SMS notifications to customers. Sent only when staff confirm it in the
// app (it asks when an order moves to "чака клиент") — see ../sms.js.
const express = require('express');
const db = require('../db');
const sms = require('../sms');
const { requireAuth } = require('../lib/auth');
const { broadcastChange } = require('../lib/live');
const { logAudit } = require('../lib/audit');
const { getSettings } = require('../lib/settings-store');
const { asyncRoute } = require('../lib/util');
const { ticketsRepo } = require('../lib/tickets-repo');

const router = express.Router();
const tickets = ticketsRepo(db);

const MAX_SMS_LENGTH = 600;
const RESEND_GUARD_SECONDS = 30;

router.get('/api/sms/config', requireAuth, (req, res) => {
  res.json({ enabled: sms.isConfigured(), provider: sms.provider() });
});

// Whether the shop phone is reachable and ready (see sms.getPhoneStatus).
// ?fresh=1 skips the 30-second cache, e.g. when opening the send window.
router.get('/api/sms/status', requireAuth, asyncRoute(async (req, res) => {
  res.json(await sms.getPhoneStatus({ fresh: req.query.fresh === '1' }));
}));

function smsForTicket(ticketId) {
  return db.prepare('SELECT * FROM sms_messages WHERE ticket_id = ? ORDER BY id DESC').all(ticketId);
}

router.get('/api/tickets/:id/sms', requireAuth, (req, res) => {
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });
  res.json(smsForTicket(ticket.id));
});

// What would be sent: the number in international form and the text from
// the template, for the confirmation window.
router.get('/api/tickets/:id/sms/preview', requireAuth, (req, res) => {
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const settings = getSettings();
  res.json({
    enabled: sms.isConfigured(),
    phone: sms.toInternationalBg(ticket.phone_contact),
    phoneAsEntered: ticket.phone_contact,
    text: sms.renderTemplate(settings.smsTemplate, ticket, settings.shopName)
  });
});

router.post('/api/tickets/:id/sms', requireAuth, asyncRoute(async (req, res) => {
  if (!sms.isConfigured()) return res.status(503).json({ error: 'SMS известията не са настроени' });
  const ticket = tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });

  const phone = sms.toInternationalBg(ticket.phone_contact);
  if (!phone) {
    return res.status(400).json({ error: `Номерът „${ticket.phone_contact}“ не е валиден български мобилен номер` });
  }
  const body = req.body || {};
  const settings = getSettings();
  const text = (typeof body.text === 'string' ? body.text : sms.renderTemplate(settings.smsTemplate, ticket, settings.shopName)).trim();
  if (!text) return res.status(400).json({ error: 'Текстът на SMS е празен' });
  if (text.length > MAX_SMS_LENGTH) return res.status(400).json({ error: `Текстът на SMS е твърде дълъг (най-много ${MAX_SMS_LENGTH} знака)` });

  // Guards against a double click or two colleagues sending at once.
  const recent = db.prepare(
    `SELECT id FROM sms_messages WHERE ticket_id = ? AND created_at > datetime('now', ?)`
  ).get(ticket.id, `-${RESEND_GUARD_SECONDS} seconds`);
  if (recent) return res.status(409).json({ error: 'За тази поръчка току-що беше изпратен SMS' });

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO sms_messages (ticket_id, ticket_no, phone, text, state, sent_by) VALUES (?, ?, ?, ?, 'Sending', ?)`
  ).run(ticket.id, ticket.ticket_no, phone, text, req.session.username);

  let failure = null;
  try {
    const { gatewayId, state } = await sms.sendSms(phone, text);
    db.prepare(`UPDATE sms_messages SET state = ?, gateway_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(state, gatewayId, lastInsertRowid);
  } catch (err) {
    failure = err.message;
    sms.resetPhoneStatusCache(); // so the phone indicator re-checks now
    db.prepare(`UPDATE sms_messages SET state = 'Failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(failure, lastInsertRowid);
  }

  logAudit(ticket.id, ticket.ticket_no, 'sms', { phone, ok: !failure }, req.session.username);
  broadcastChange('tickets');
  const saved = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(lastInsertRowid);
  if (failure) return res.status(502).json({ error: failure, sms: saved });
  res.status(201).json(saved);
}));

// Asks the phone/service how recent messages are doing (Sent / Delivered /
// Failed). Called every minute by server.js; only looks at the last 24 hours.
async function pollSmsStates() {
  if (!sms.isConfigured()) return 0;
  const open = db.prepare(`
    SELECT * FROM sms_messages
    WHERE gateway_id IS NOT NULL AND state IN (${sms.POLL_STATES.map(() => '?').join(',')})
      AND created_at > datetime('now', '-1 day')`).all(...sms.POLL_STATES);
  let changed = 0;
  for (const m of open) {
    const now = await sms.getSmsState(m.gateway_id).catch(() => null);
    if (now && now.state && now.state !== m.state) {
      db.prepare(`UPDATE sms_messages SET state = ?, error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(now.state, now.error, m.id);
      changed++;
    }
  }
  if (changed) broadcastChange('tickets');
  return changed;
}

module.exports = { router, pollSmsStates };
