// @ts-check
// Настройки — the shared settings and the current shop's own (see
// lib/settings-store.js) — and the phone-model suggestion list.
const express = require('express');
const STATUSES = require('../public/statuses');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { broadcastChange } = require('../lib/live');
const systemDb = require('../lib/system-db');
const stores = require('../lib/stores');
const { shopsOf } = require('../lib/ticket-target');
const { COLUMN_KEYS, HEX_COLOR, getSettings, saveSettings, withStatusColors, withShopPhone } = require('../lib/settings-store');

const router = express.Router();

// Shared settings with the shop's own. In the all-shops view also every
// shop's own (`shops`, by shop id), for printing each order with its shop's
// name, phone and footer.
const OWN_KEYS = ['shopName', 'shopTagline', 'shopPhone', 'printCustomer', 'smsTemplate'];
router.get('/api/settings', requireAuth, (req, res) => {
  const settings = withShopPhone(getSettings(req.store.db));
  if (req.allShops) {
    settings.shops = Object.fromEntries(stores.all().map(store => {
      const own = withShopPhone(getSettings(store.db));
      return [store.id, Object.fromEntries(OWN_KEYS.map(k => [k, own[k]]))];
    }));
  }
  res.json(settings);
});

router.put('/api/settings', requireAdmin, (req, res) => {
  const current = getSettings(req.store.db);
  const body = req.body || {};
  const next = { ...current };

  if (body.shopName !== undefined) {
    if (typeof body.shopName !== 'string' || !body.shopName.trim()) {
      return res.status(400).json({ error: 'Името на сервиза не може да бъде празно' });
    }
    next.shopName = body.shopName.trim();
  }

  if (body.shopTagline !== undefined) {
    next.shopTagline = typeof body.shopTagline === 'string' ? body.shopTagline.trim() : current.shopTagline;
  }

  // The shop's own phone number; empty means SHOP_PHONE from .env.
  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || body.phone.trim().length > 40) {
      return res.status(400).json({ error: 'Невалиден телефон на магазина' });
    }
    next.phone = body.phone.trim();
  }

  if (body.statuses !== undefined) {
    const statuses = (body.statuses || []).map(s => String(s).trim()).filter(Boolean);
    if (statuses.length === 0) {
      return res.status(400).json({ error: 'Трябва да има поне един статус' });
    }
    const missing = STATUSES.SYSTEM.find(s => !statuses.includes(s));
    if (missing) {
      return res.status(400).json({ error: `Статусът „${missing}“ е системен и не може да бъде премахнат (${STATUSES.PURPOSE[missing]})` });
    }
    next.statuses = [...new Set(statuses)];
  }

  if (body.statusColors !== undefined) {
    const incoming = body.statusColors;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Невалидни цветове на статусите' });
    }
    for (const [status, color] of Object.entries(incoming)) {
      if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
        return res.status(400).json({ error: `Невалиден цвят за статус „${status}“` });
      }
    }
    next.statusColors = { ...current.statusColors, ...incoming };
  }
  if (body.smsTemplate !== undefined) {
    if (typeof body.smsTemplate !== 'string' || !body.smsTemplate.trim()) {
      return res.status(400).json({ error: 'Текстът на SMS не може да бъде празен' });
    }
    if (body.smsTemplate.length > 600) {
      return res.status(400).json({ error: 'Текстът на SMS е твърде дълъг (най-много 600 знака)' });
    }
    next.smsTemplate = body.smsTemplate.trim();
  }

  // Keep colours only for statuses that still exist (fills in defaults for new ones).
  const saved = withStatusColors(next);
  next.statusColors = saved.statusColors;

  if (body.columns !== undefined) {
    const columns = (body.columns || []).filter(c => COLUMN_KEYS.includes(c));
    next.columns = columns;
  }

  if (body.devices !== undefined) {
    const devices = (body.devices || []).map(d => String(d).trim()).filter(Boolean);
    next.devices = [...new Set(devices)].sort((a, b) => a.localeCompare(b));
  }

  // The customer copy's layout is fixed (matches the shop's paper service
  // card) — only its footer warning text is editable.
  if (body.printCustomer !== undefined) {
    const incoming = body.printCustomer || {};
    next.printCustomer = {
      footer: typeof incoming.footer === 'string' ? incoming.footer : current.printCustomer.footer
    };
  }

  // The service copy is a fixed small label (shop name, order number,
  // problem description) — nothing about it is configurable.

  delete next.shopPhone; // added to responses only (withShopPhone)
  delete next.shops;     // likewise (the all-shops view)
  const sharedChanged = saveSettings(req.store.db, next);
  // The shop's name is also its name in the list of shops.
  if (next.shopName !== current.shopName) {
    systemDb.prepare('UPDATE stores SET name = ? WHERE id = ?').run(next.shopName, req.store.id);
  }

  // Shared settings: every shop's screens; otherwise just this shop's.
  broadcastChange('settings', sharedChanged ? null : req.store.id);
  res.json(withShopPhone(next));
});

// Merges the admin-curated device list with phone models actually used on
// tickets, so the dropdown "learns" new models as they're typed in.
router.get('/api/devices', requireAuth, (req, res) => {
  const settings = getSettings(req.store.db);
  const used = shopsOf(req).flatMap(store => store.tickets.usedPhoneModels());

  const seen = new Map(); // lowercase -> original casing
  for (const d of [...settings.devices, ...used]) {
    const key = d.toLowerCase();
    if (!seen.has(key)) seen.set(key, d);
  }
  const merged = [...seen.values()].sort((a, b) => a.localeCompare(b));
  res.json(merged);
});

module.exports = router;
