// The shop's settings (Настройки) and the phone-model suggestion list.
const express = require('express');
const db = require('../db');
const STATUSES = require('../public/statuses');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { broadcastChange } = require('../lib/live');
const { COLUMN_KEYS, HEX_COLOR, getSettings, withStatusColors, withShopPhone } = require('../lib/settings-store');
const { ticketsRepo } = require('../lib/tickets-repo');

const router = express.Router();
const tickets = ticketsRepo(db);

router.get('/api/settings', requireAuth, (req, res) => {
  res.json(withShopPhone(getSettings()));
});

router.put('/api/settings', requireAdmin, (req, res) => {
  const current = getSettings();
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

  db.prepare('UPDATE settings SET data = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(JSON.stringify(next));

  broadcastChange('settings');
  res.json(withShopPhone(next));
});

// Merges the admin-curated device list with phone models actually used on
// tickets, so the dropdown "learns" new models as they're typed in.
router.get('/api/devices', requireAuth, (req, res) => {
  const settings = getSettings();
  const used = tickets.usedPhoneModels();

  const seen = new Map(); // lowercase -> original casing
  for (const d of [...settings.devices, ...used]) {
    const key = d.toLowerCase();
    if (!seen.has(key)) seen.set(key, d);
  }
  const merged = [...seen.values()].sort((a, b) => a.localeCompare(b));
  res.json(merged);
});

module.exports = router;
