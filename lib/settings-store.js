// Reading the shop's settings (single row in the settings table), with the
// defaults and upgrades applied for shops set up by older versions.
const db = require('../db');
const STATUSES = require('../public/statuses');
const DEFAULTS = require('../default-settings');

// Table columns that can be shown or hidden in Settings.
const COLUMN_KEYS = ['customer', 'callBtn', 'model', 'issue', 'password', 'comment', 'repairPerformed', 'loanerPhone', 'pravim', 'status', 'kaparo', 'dateIn', 'dateReturned', 'servicePrice', 'customerPrice'];

// Badge colour per status, as #rrggbb. Statuses without a saved colour use
// the built-in one for that name, or neutral grey for custom statuses.
const DEFAULT_STATUS_COLORS = DEFAULTS.statusColors;
const FALLBACK_STATUS_COLOR = '#6B7280';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const OLD_DEFAULT_FOOTER = 'МАГАЗИНЪТ И СЕРВИЗЪТ НЕ НОСЯТ ОТГОВОРНОСТ ЗА:\nИЗГУБЕНА ПРИ РЕМОНТА ИНФОРМАЦИЯ ОТ МОБИЛНИТЕ АПАРАТИ\nАПАРАТИ НЕПОТЪРСЕНИ ДО 1 МЕСЕЦ ОТ ДАТАТА НА ПРИЕМАНЕ';

function withStatusColors(settings) {
  const saved = settings.statusColors || {};
  const statusColors = {};
  for (const s of settings.statuses) {
    statusColors[s] = saved[s] || DEFAULT_STATUS_COLORS[s] || FALLBACK_STATUS_COLOR;
  }
  return { ...settings, statusColors };
}

function getSettings() {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  const saved = JSON.parse(row.data);
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

// The shop's phone number for the customer print comes from the environment
// (SHOP_PHONE), not the database, so it's added to responses but never saved.
function withShopPhone(settings) {
  return { ...settings, shopPhone: (process.env.SHOP_PHONE || '').trim() };
}

module.exports = { COLUMN_KEYS, HEX_COLOR, getSettings, withStatusColors, withShopPhone };
