// @ts-check
// SMS notifications to customers. Sent only when staff confirm it in the
// app (it asks when an order moves to "чака клиент") — see ../sms.js.
const express = require('express');
const sms = require('../sms');
const { requireAuth, requireAdmin } = require('../lib/auth');
const systemDb = require('../lib/system-db');
const { broadcastChange } = require('../lib/live');
const { ticketEvents } = require('../lib/ticket-events');
const { getSettings } = require('../lib/settings-store');
const { asyncRoute } = require('../lib/util');
const stores = require('../lib/stores');

const router = express.Router();

const MAX_SMS_LENGTH = 600;
const RESEND_GUARD_SECONDS = 30;

router.get('/api/sms/config', requireAuth, (req, res) => {
  res.json({ enabled: sms.isConfigured(req.store), provider: sms.provider(req.store) });
});

// Whether the shop phone is reachable and ready (see sms.getPhoneStatus).
// ?fresh=1 skips the 30-second cache, e.g. when opening the send window.
router.get('/api/sms/status', requireAuth, asyncRoute(async (req, res) => {
  res.json(await sms.getPhoneStatus({ fresh: req.query.fresh === '1', store: req.store }));
}));

// ---- The current shop's SMS settings (admins, Настройки) ----
// See sms.js smsEnv. The token and the phone's password are never sent
// back: only whether they're set.
/** @param {import('../types/app').Store} store */
function smsSettingsView(store) {
  const own = store.sms || {};
  return {
    mode: sms.MODES.includes(own.mode) ? own.mode : 'env',
    SMSAPI_SENDER: own.SMSAPI_SENDER || '',
    SMSAPI_TEST: own.SMSAPI_TEST === 'true',
    SMS_GATEWAY_URL: own.SMS_GATEWAY_URL || '',
    SMS_GATEWAY_USER: own.SMS_GATEWAY_USER || '',
    secrets: Object.fromEntries(sms.SECRET_KEYS.map(k => [k, !!own[k]])),
    provider: sms.provider(store),     // what this shop uses now
    envProvider: sms.provider(null)    // what .env would give
  };
}

const LIMITS = { SMSAPI_TOKEN: 500, SMSAPI_SENDER: 11, SMS_GATEWAY_URL: 300, SMS_GATEWAY_USER: 100, SMS_GATEWAY_PASSWORD: 200 };

router.get('/api/sms/shop-settings', requireAdmin, (req, res) => {
  res.json(smsSettingsView(req.store));
});

// Fields not sent stay as they are; so does a secret sent empty (the page
// never has it). A secret sent as null is removed.
router.put('/api/sms/shop-settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const next = { ...(req.store.sms || {}) };

  if (body.mode !== undefined) {
    if (!sms.MODES.includes(body.mode)) return res.status(400).json({ error: 'Невалиден избор за SMS' });
    next.mode = body.mode;
  }
  for (const key of sms.SHOP_KEYS) {
    if (key === 'SMSAPI_TEST' || body[key] === undefined) continue;
    const secret = sms.SECRET_KEYS.includes(key);
    if (body[key] === null) { delete next[key]; continue; }
    if (typeof body[key] !== 'string') return res.status(400).json({ error: `Невалидна стойност за ${key}` });
    const value = body[key].trim();
    if (secret && !value) continue;
    if (value.length > LIMITS[key]) return res.status(400).json({ error: `${key} е твърде дълго (най-много ${LIMITS[key]} знака)` });
    if (key === 'SMS_GATEWAY_URL' && value && !/^https?:\/\/\S+$/i.test(value)) {
      return res.status(400).json({ error: 'Адресът на телефона трябва да започва с http:// или https://' });
    }
    if (value) next[key] = value; else delete next[key];
  }
  if (body.SMSAPI_TEST !== undefined) {
    if (body.SMSAPI_TEST === true) next.SMSAPI_TEST = 'true'; else delete next.SMSAPI_TEST;
  }
  if (next.mode === 'own' && !next.SMSAPI_TOKEN && !next.SMS_GATEWAY_URL) {
    return res.status(400).json({ error: 'За собствени настройки въведете SMSAPI ключ или адрес на телефона' });
  }

  systemDb.prepare('UPDATE stores SET sms = ? WHERE id = ?').run(JSON.stringify(next), req.store.id);
  const store = /** @type {import('../types/app').Store} */ (stores.get(req.store.id)); // refreshed
  sms.resetPhoneStatusCache(store);
  broadcastChange('settings', store.id); // the shop's screens re-check SMS
  res.json(smsSettingsView(store));
});

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
    enabled: sms.isConfigured(req.store),
    phone: sms.toInternationalBg(ticket.phone_contact),
    phoneAsEntered: ticket.phone_contact,
    text: sms.renderTemplate(settings.smsTemplate, ticket, settings.shopName)
  });
});

router.post('/api/tickets/:id/sms', requireAuth, asyncRoute(async (req, res) => {
  if (!sms.isConfigured(req.store)) return res.status(503).json({ error: 'SMS известията не са настроени' });
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
    const { gatewayId, state } = await sms.sendSms(phone, text, req.store);
    req.store.db.prepare(`UPDATE sms_messages SET state = ?, gateway_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(state, gatewayId, lastInsertRowid);
  } catch (err) {
    failure = err.message;
    sms.resetPhoneStatusCache(req.store); // so the phone indicator re-checks now
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
  let changed = 0;
  for (const store of stores.all()) {
    if (sms.isConfigured(store)) changed += await pollShopSmsStates(store);
  }
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
    const now = await sms.getSmsState(m.gateway_id, store).catch(() => null);
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
