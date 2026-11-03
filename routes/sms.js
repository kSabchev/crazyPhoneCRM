// @ts-check
// SMS notifications to customers. Sent only when staff confirm it in the
// app (it asks when an order moves to "чака клиент") — see ../sms.js.
const express = require('express');
const sms = require('../sms');
const { requireAuth } = require('../lib/auth');
const { ticketEvents } = require('../lib/ticket-events');
const { getSettings } = require('../lib/settings-store');
const { asyncRoute } = require('../lib/util');
const stores = require('../lib/stores');

const router = express.Router();

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

/** @param {import('better-sqlite3').Database} db the shop's database */
function smsForTicket(db, ticketId) {
  return db.prepare('SELECT * FROM sms_messages WHERE ticket_id = ? ORDER BY id DESC').all(ticketId);
}

router.get('/api/tickets/:id/sms', requireAuth, (req, res) => {
  const ticket = req.store.tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });
  res.json(smsForTicket(req.store.db, ticket.id));
});

// What would be sent: the number in international form and the text from
// the template, for the confirmation window.
router.get('/api/tickets/:id/sms/preview', requireAuth, (req, res) => {
  const ticket = req.store.tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const settings = getSettings(req.store.db);
  res.json({
    enabled: sms.isConfigured(),
    phone: sms.toInternationalBg(ticket.phone_contact),
    phoneAsEntered: ticket.phone_contact,
    text: sms.renderTemplate(settings.smsTemplate, ticket, settings.shopName)
  });
});

router.post('/api/tickets/:id/sms', requireAuth, asyncRoute(async (req, res) => {
  if (!sms.isConfigured()) return res.status(503).json({ error: 'SMS известията не са настроени' });
  const ticket = req.store.tickets.get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Поръчката не е намерена' });

  const phone = sms.toInternationalBg(ticket.phone_contact);
  if (!phone) {
    return res.status(400).json({ error: `Номерът „${ticket.phone_contact}“ не е валиден български мобилен номер` });
  }
  const body = req.body || {};
  const settings = getSettings(req.store.db);
  const text = (typeof body.text === 'string' ? body.text : sms.renderTemplate(settings.smsTemplate, ticket, settings.shopName)).trim();
  if (!text) return res.status(400).json({ error: 'Текстът на SMS е празен' });
  if (text.length > MAX_SMS_LENGTH) return res.status(400).json({ error: `Текстът на SMS е твърде дълъг (най-много ${MAX_SMS_LENGTH} знака)` });

  // Guards against a double click or two colleagues sending at once.
  const recent = req.store.db.prepare(
    `SELECT id FROM sms_messages WHERE ticket_id = ? AND created_at > datetime('now', ?)`
  ).get(ticket.id, `-${RESEND_GUARD_SECONDS} seconds`);
  if (recent) return res.status(409).json({ error: 'За тази поръчка току-що беше изпратен SMS' });

  const { lastInsertRowid } = req.store.db.prepare(
    `INSERT INTO sms_messages (ticket_id, ticket_no, phone, text, state, sent_by) VALUES (?, ?, ?, ?, 'Sending', ?)`
  ).run(ticket.id, ticket.ticket_no, phone, text, req.session.username);

  let failure = null;
  try {
    const { gatewayId, state } = await sms.sendSms(phone, text);
    req.store.db.prepare(`UPDATE sms_messages SET state = ?, gateway_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(state, gatewayId, lastInsertRowid);
  } catch (err) {
    failure = err.message;
    sms.resetPhoneStatusCache(); // so the phone indicator re-checks now
    req.store.db.prepare(`UPDATE sms_messages SET state = 'Failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(failure, lastInsertRowid);
  }

  ticketEvents.emit('sms', { store: req.store, ticket, phone, ok: !failure, user: req.session.username });
  const saved = req.store.db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(lastInsertRowid);
  if (failure) return res.status(502).json({ error: failure, sms: saved });
  res.status(201).json(saved);
}));

// Asks the phone/service how recent messages are doing (Sent / Delivered /
// Failed). Called every minute by server.js, for every shop; only looks at
// the last 24 hours. Returns how many changed in all.
async function pollSmsStates() {
  if (!sms.isConfigured()) return 0;
  let changed = 0;
  for (const store of stores.all()) changed += await pollShopSmsStates(store);
  return changed;
}

/** @param {import('../types/app').Store} store */
async function pollShopSmsStates(store) {
  const db = store.db;
  const open = /** @type {import('../types/app').SmsMessage[]} */ (db.prepare(`
    SELECT * FROM sms_messages
    WHERE gateway_id IS NOT NULL AND state IN (${sms.POLL_STATES.map(() => '?').join(',')})
      AND created_at > datetime('now', '-1 day')`).all(...sms.POLL_STATES));
  let changed = 0;
  for (const m of open) {
    const now = await sms.getSmsState(m.gateway_id).catch(() => null);
    if (now && now.state && now.state !== m.state) {
      db.prepare(`UPDATE sms_messages SET state = ?, error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(now.state, now.error, m.id);
      changed++;
    }
  }
  if (changed) ticketEvents.emit('smsStates', { store, count: changed });
  return changed;
}

module.exports = { router, pollSmsStates };
