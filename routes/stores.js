// @ts-check
// The shops (admins, Настройки → Магазини): list, add, rename, change the
// order-number prefix, archive and restore. Shops aren't deleted: their
// orders and history would go with them. An archived shop is out of
// everyday use but keeps its data (lib/stores.js).
const express = require('express');
const systemDb = require('../lib/system-db');
const stores = require('../lib/stores');
const { requireAdmin } = require('../lib/auth');
const { getSettings, saveSettings } = require('../lib/settings-store');
const { broadcastChange } = require('../lib/live');
const { logAdmin } = require('../lib/admin-log');

const router = express.Router();

// Shops in use: the all-shops reports attach every one's database, and
// SQLite attaches at most 10 (lib/combined-db.js).
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
    archived: store.archived,
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
    // Two shops with the same prefix would have look-alike order numbers
    // (archived ones too: their orders still show in Справки).
    const clash = prefix && stores.all({ archived: true }).find(s => s.prefix.toLowerCase() === prefix.toLowerCase() && s.id !== id);
    if (clash) return { error: `Префиксът „${prefix}“ вече се използва от „${clash.name}“` };
    out.prefix = prefix;
  }
  return out;
}

router.get('/api/stores', requireAdmin, (req, res) => {
  res.json(stores.all({ archived: true }).map(view));
});

router.post('/api/stores', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (body.name === undefined) body.name = '';
  if (stores.all().length >= MAX_SHOPS) {
    return res.status(400).json({ error: `Може да има най-много ${MAX_SHOPS} магазина в употреба` });
  }
  const shop = checkShop(body);
  if (shop.error) return res.status(400).json({ error: shop.error });
  const store = stores.create({ name: /** @type {string} */ (shop.name), prefix: shop.prefix || '' });
  console.log(`[${new Date().toISOString()}] Shop "${store.name}" added by ${req.user.username} (data/shop-${store.id}.db).`);
  logAdmin(req.user.username, 'shop_added', { name: store.name, prefix: store.prefix }, store.id);
  res.status(201).json(view(store));
});

// A new name is also the shop's name in its settings (printed on its
// cards), and the other way round (routes/settings.js).
router.put('/api/stores/:id', requireAdmin, (req, res) => {
  const store = stores.get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Магазинът не е намерен' });
  const shop = checkShop(req.body || {}, store.id);
  if (shop.error) return res.status(400).json({ error: shop.error });

  const changes = {};
  if (shop.name !== undefined && shop.name !== store.name) changes.name = { from: store.name, to: shop.name };
  if (shop.prefix !== undefined && shop.prefix !== store.prefix) changes.prefix = { from: store.prefix, to: shop.prefix };
  if (Object.keys(changes).length) logAdmin(req.user.username, 'shop_changed', { changes }, store.id);

  if (shop.name !== undefined) {
    systemDb.prepare('UPDATE stores SET name = ? WHERE id = ?').run(shop.name, store.id);
    const settings = getSettings(store.db);
    if (settings.shopName !== shop.name) saveSettings(store.db, { ...settings, shopName: shop.name });
  }
  if (shop.prefix !== undefined) systemDb.prepare('UPDATE stores SET prefix = ? WHERE id = ?').run(shop.prefix, store.id);

  broadcastChange('settings', store.id); // its screens show the new name
  res.json(view(/** @type {import('../types/app').Store} */ (stores.get(store.id))));
});

// Archiving: refused for the last shop in use, and while accounts still
// belong to the shop (they'd be locked out: move or remove them first).
router.post('/api/stores/:id/archive', requireAdmin, (req, res) => {
  const store = stores.get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Магазинът не е намерен' });
  if (store.archived) return res.status(400).json({ error: 'Магазинът вече е архивиран' });
  if (stores.all().length <= 1) return res.status(400).json({ error: 'Трябва да остане поне един магазин в употреба' });
  const accounts = /** @type {{ username: string }[]} */ (systemDb.prepare('SELECT username FROM users WHERE store_id = ? ORDER BY username').all(store.id));
  if (accounts.length) {
    return res.status(400).json({
      error: `Първо преместете в друг магазин или премахнете профилите му: ${accounts.map(a => a.username).join(', ')}`
    });
  }
  const archived = /** @type {import('../types/app').Store} */ (stores.setArchived(store.id, true));
  console.log(`[${new Date().toISOString()}] Shop "${store.name}" archived by ${req.user.username}.`);
  logAdmin(req.user.username, 'shop_archived', { name: store.name }, store.id);
  broadcastChange('settings'); // every screen: the picker changes
  res.json(view(archived));
});

router.post('/api/stores/:id/restore', requireAdmin, (req, res) => {
  const store = stores.get(req.params.id);
  if (!store) return res.status(404).json({ error: 'Магазинът не е намерен' });
  if (!store.archived) return res.status(400).json({ error: 'Магазинът не е архивиран' });
  if (stores.all().length >= MAX_SHOPS) {
    return res.status(400).json({ error: `Може да има най-много ${MAX_SHOPS} магазина в употреба` });
  }
  const restored = /** @type {import('../types/app').Store} */ (stores.setArchived(store.id, false));
  console.log(`[${new Date().toISOString()}] Shop "${store.name}" restored by ${req.user.username}.`);
  logAdmin(req.user.username, 'shop_restored', { name: store.name }, store.id);
  broadcastChange('settings');
  res.json(view(restored));
});

module.exports = router;
