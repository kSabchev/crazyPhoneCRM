// @ts-check
// The shops (admins, Настройки → Магазини): list, add, rename, change the
// order-number prefix. Shops aren't removed here: their orders and history
// would go with them.
const express = require('express');
const systemDb = require('../lib/system-db');
const stores = require('../lib/stores');
const { requireAdmin } = require('../lib/auth');
const { getSettings, saveSettings } = require('../lib/settings-store');
const { broadcastChange } = require('../lib/live');

const router = express.Router();

// The all-shops reports attach every shop's database, and SQLite attaches
// at most 10 (lib/combined-db.js).
const MAX_SHOPS = 10;
const MAX_NAME = 60;
// Shown before order numbers ("Л-123"): letters and digits, up to 5.
const PREFIX = /^[\p{L}\p{N}]{0,5}$/u;

/** @param {import('../types/app').Store} store */
function view(store) {
  return {
    id: store.id,
    name: store.name,
    prefix: store.prefix,
    orders: /** @type {{ n: number }} */ (store.db.prepare('SELECT COUNT(*) AS n FROM tickets').get()).n
  };
}

// The name and prefix sent, checked; `id`: the shop being changed (its own
// prefix doesn't clash with itself). Returns { error } or the clean values.
/** @returns {{ error?: string, name?: string, prefix?: string }} */
function checkShop(body, id = null) {
  /** @type {{ name?: string, prefix?: string }} */
  const out = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'Името на магазина не може да бъде празно' };
    if (name.length > MAX_NAME) return { error: `Името на магазина е твърде дълго (най-много ${MAX_NAME} знака)` };
    out.name = name;
  }
  if (body.prefix !== undefined) {
    const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : null;
    if (prefix === null || !PREFIX.test(prefix)) {
      return { error: 'Префиксът може да съдържа само букви и цифри (най-много 5)' };
    }
    // Two shops with the same prefix would have look-alike order numbers.
    const clash = prefix && stores.all().find(s => s.prefix.toLowerCase() === prefix.toLowerCase() && s.id !== id);
    if (clash) return { error: `Префиксът „${prefix}“ вече се използва от „${clash.name}“` };
    out.prefix = prefix;
  }
  return out;
}

router.get('/api/stores', requireAdmin, (req, res) => {
  res.json(stores.all().map(view));
});

router.post('/api/stores', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (body.name === undefined) body.name = '';
  if (stores.all().length >= MAX_SHOPS) {
    return res.status(400).json({ error: `Може да има най-много ${MAX_SHOPS} магазина` });
  }
  const shop = checkShop(body);
  if (shop.error) return res.status(400).json({ error: shop.error });
  const store = stores.create({ name: /** @type {string} */ (shop.name), prefix: shop.prefix || '' });
  console.log(`[${new Date().toISOString()}] Shop "${store.name}" added by ${req.user.username} (data/shop-${store.id}.db).`);
  res.status(201).json(view(store));
});

// A new name is also the shop's name in its settings (printed on its
// cards), and the other way round (routes/settings.js).
router.put('/api/stores/:id', requireAdmin, (req, res) => {
  const store = stores.get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Магазинът не е намерен' });
  const shop = checkShop(req.body || {}, store.id);
  if (shop.error) return res.status(400).json({ error: shop.error });

  if (shop.name !== undefined) {
    systemDb.prepare('UPDATE stores SET name = ? WHERE id = ?').run(shop.name, store.id);
    const settings = getSettings(store.db);
    if (settings.shopName !== shop.name) saveSettings(store.db, { ...settings, shopName: shop.name });
  }
  if (shop.prefix !== undefined) systemDb.prepare('UPDATE stores SET prefix = ? WHERE id = ?').run(shop.prefix, store.id);

  broadcastChange('settings', store.id); // its screens show the new name
  res.json(view(/** @type {import('../types/app').Store} */ (stores.get(store.id))));
});

module.exports = router;
