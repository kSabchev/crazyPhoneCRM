// @ts-check
// A shop's settings: what every shop shares (system.db, shared_settings)
// together with the shop's own (the settings row in its database), with the
// defaults and upgrades applied for shops set up by older versions.
//
//   shared, admins only: statuses, their colours, table columns, the
//                        phone-model list (SHARED_KEYS)
//   each shop's own:     name, tagline, phone, customer-print footer, SMS text
const STATUSES = require('../public/statuses');
const DEFAULTS = require('../default-settings');

// Table columns that can be shown or hidden in Settings.
const COLUMN_KEYS = ['customer', 'callBtn', 'model', 'issue', 'password', 'comment', 'repairPerformed', 'loanerPhone', 'pravim', 'status', 'kaparo', 'dateIn', 'dateReturned', 'servicePrice', 'customerPrice'];

// Badge colour per status, as #rrggbb. Statuses without a saved colour use
// the built-in one for that name, or neutral grey for custom statuses.
const DEFAULT_STATUS_COLORS = DEFAULTS.statusColors;
const FALLBACK_STATUS_COLOR = '#6B7280';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const SHARED_KEYS = ['statuses', 'statusColors', 'columns', 'devices'];
/** @param {Record<string, any>} settings */
const sharedPart = settings => Object.fromEntries(SHARED_KEYS.filter(k => k in settings).map(k => [k, settings[k]]));

// Required when used: system.db opens the data folder on load.
const systemDb = () => require('./system-db');

/** @returns {Record<string, any>} */
function readShared() {
  const row = /** @type {{ data: string } | undefined} */ (systemDb().prepare('SELECT data FROM shared_settings WHERE id = 1').get());
  return row ? JSON.parse(row.data) : {};
}

const OLD_DEFAULT_FOOTER = 'МАГАЗИНЪТ И СЕРВИЗЪТ НЕ НОСЯТ ОТГОВОРНОСТ ЗА:\nИЗГУБЕНА ПРИ РЕМОНТА ИНФОРМАЦИЯ ОТ МОБИЛНИТЕ АПАРАТИ\nАПАРАТИ НЕПОТЪРСЕНИ ДО 1 МЕСЕЦ ОТ ДАТАТА НА ПРИЕМАНЕ';

function withStatusColors(settings) {
  const saved = settings.statusColors || {};
  const statusColors = {};
  for (const s of settings.statuses) {
    statusColors[s] = saved[s] || DEFAULT_STATUS_COLORS[s] || FALLBACK_STATUS_COLOR;
  }
  return { ...settings, statusColors };
}

/** @param {import('better-sqlite3').Database} db the shop's database */
function getSettings(db) {
  const row = /** @type {{ data: string }} */ (db.prepare('SELECT data FROM settings WHERE id = 1').get());
  const saved = { ...JSON.parse(row.data), ...sharedPart(readShared()) };
  // The built-in statuses drive behaviour and can't be removed; a shop that
  // removed one before that was enforced gets it back (at the end).
  for (const s of STATUSES.SYSTEM) {
    if (!saved.statuses.includes(s)) saved.statuses.push(s);
  }
  // Shops set up before SMS existed get the default text.
  if (typeof saved.smsTemplate !== 'string') saved.smsTemplate = DEFAULTS.smsTemplate;
  // The customer card's title was replaced by the shop phone (SHOP_PHONE),
  // and the default warning gained the warranty line — upgrade shops that
  // never edited the old default text.
  if (saved.printCustomer) {
    delete saved.printCustomer.header;
    if (saved.printCustomer.footer === OLD_DEFAULT_FOOTER) {
      saved.printCustomer.footer = DEFAULTS.printCustomer.footer;
    }
  }
  return withStatusColors(saved);
}

// Saves a shop's settings: the shared part for every shop, the rest for this
// one. (The shop's row keeps a copy of the shared part too, so an older
// version of the app still finds everything after a rollback.) Returns
// whether the shared part changed.
/** @param {import('better-sqlite3').Database} db the shop's database @param {Record<string, any>} settings */
function saveSettings(db, settings) {
  const shared = JSON.stringify(sharedPart(settings));
  const changed = shared !== JSON.stringify(sharedPart(readShared()));
  if (changed) {
    systemDb().prepare("UPDATE shared_settings SET data = ?, updated_at = datetime('now') WHERE id = 1").run(shared);
  }
  db.prepare("UPDATE settings SET data = ?, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(settings));
  return changed;
}

// The phone number on the customer print: the shop's own (`phone`, set in
// Настройки), or else SHOP_PHONE from .env. Added to responses as
// `shopPhone`, never saved under that name.
function withShopPhone(settings) {
  return { ...settings, shopPhone: (settings.phone || process.env.SHOP_PHONE || '').trim() };
}

module.exports = { COLUMN_KEYS, HEX_COLOR, SHARED_KEYS, sharedPart, getSettings, saveSettings, withStatusColors, withShopPhone };
