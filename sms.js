// @ts-check
// SMS notifications to customers. Each way of sending is a provider module
// with the same four functions:
//
//   config(env)            its settings, or null/false when not set up
//   send(phone, text, env) -> { gatewayId, state }; throws an Error for staff
//   state(gatewayId, env)  -> { state, error } or null when unknown
//   serviceStatus(env)     -> { state, details } for the header pill
//
// `env` is where the settings come from: .env, or a shop's own (smsEnv
// below). For each shop, the first provider in PROVIDERS that is set up is
// used. Without any, SMS is switched off for that shop: nothing is ever sent
// and the app doesn't offer to send. A new way of sending is one new module
// and one line in the list.
//
// The functions below take the shop (`store`); without one, .env is used.
/** @type {Array<[name: string, provider: import('./types/app').SmsProvider]>} */
const PROVIDERS = [
  // In DEMO_MODE SMS is simulated inside the app and nothing ever leaves
  // the server. (The real providers also switch themselves off in
  // DEMO_MODE, so this holds whatever the order.)
  ['demo', require('./sms-demo')],
  // SMSAPI.bg — a paid SMS service, no phone needed (SMSAPI_TOKEN).
  ['smsapi', require('./smsapi')],
  // The shop's Android phone through SMS Gateway for Android (SMS_GATEWAY_URL).
  ['phone', require('./gateway')]
];

// ---- Each shop's SMS settings (stores.sms, set in Настройки) ----
//   mode 'env' (default)  as in .env
//   mode 'own'            only the shop's own keys below (its own phone, or
//                         its own SMSAPI token/sender); nothing from .env
//   mode 'off'            no SMS from this shop
// The SMSAPI address and DEMO_MODE always come from .env.
const SHOP_KEYS = ['SMSAPI_TOKEN', 'SMSAPI_SENDER', 'SMSAPI_TEST', 'SMS_GATEWAY_URL', 'SMS_GATEWAY_USER', 'SMS_GATEWAY_PASSWORD'];
// Never sent back to the browser: shown only as set / not set.
const SECRET_KEYS = ['SMSAPI_TOKEN', 'SMS_GATEWAY_PASSWORD'];
const MODES = ['env', 'own', 'off'];

/** @param {{ sms?: Record<string, any> } | null} [store] @returns {import('./types/app').SmsEnv} */
function smsEnv(store) {
  const own = (store && store.sms) || {};
  if (own.mode === 'off') return {};
  if (own.mode !== 'own') return process.env;
  /** @type {import('./types/app').SmsEnv} */
  const env = { SMSAPI_URL: process.env.SMSAPI_URL, DEMO_MODE: process.env.DEMO_MODE };
  for (const key of SHOP_KEYS) if (typeof own[key] === 'string' && own[key]) env[key] = own[key];
  return env;
}

// The provider a shop uses: { name, impl, env }, or null when SMS is off.
function active(store) {
  const env = smsEnv(store);
  const found = PROVIDERS.find(([, impl]) => impl.config(env));
  return found ? { name: found[0], impl: found[1], env } : null;
}

// Which way SMS goes: 'demo', 'smsapi', 'phone', or null when SMS is off.
function provider(store) {
  const p = active(store);
  return p ? p.name : null;
}
const isConfigured = store => provider(store) !== null;

// Bulgarian number in international form: "0888 123 456" or
// "+359 88 812 3456" -> "+359888123456". Anything else -> null.
function toInternationalBg(phone) {
  const digits = String(phone || '').replace(/[\s\-./()]/g, '');
  const m = digits.match(/^(?:0|\+359)(\d{9})$/);
  return m ? `+359${m[1]}` : null;
}

// Fills {номер}, {клиент}, {модел}, {магазин} in the template.
function renderTemplate(template, ticket, shopName) {
  const values = {
    'номер': String(ticket.ticket_no),
    'клиент': ticket.customer_name || '',
    'модел': ticket.phone_model || '',
    'магазин': shopName || ''
  };
  return String(template || '').replace(/\{(номер|клиент|модел|магазин)\}/g, (_, key) => values[key]);
}

// How many SMS parts a text takes. Cyrillic (any non-GSM character) means
// UCS-2: 70 characters in one SMS, 67 per part once split.
const GSM_CHARS = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
function smsParts(text) {
  const len = [...String(text)].length;
  if (len === 0) return 0;
  const [single, multi] = GSM_CHARS.test(text) ? [160, 153] : [70, 67];
  return len <= single ? 1 : Math.ceil(len / multi);
}

// Sends one SMS through the provider in use. Resolves to
// { gatewayId, state }, or throws an Error suitable for showing to staff.
async function sendSms(phone, text, store) {
  const p = active(store);
  if (!p) throw new Error('SMS известията не са настроени');
  return p.impl.send(phone, text, p.env);
}

// Current state of a sent message: { state, error }, or null if unknown.
async function getSmsState(gatewayId, store) {
  const p = active(store);
  if (!p || !gatewayId) return null;
  return p.impl.state(gatewayId, p.env);
}

// ---- Is the service / phone reachable and ready? ----
// Asked at most every 30 seconds unless `fresh` (e.g. when opening the send
// window). Returns { state, provider, details, checkedAt }; state is one of:
//   off      SMS not configured
//   cloud    phone in cloud mode: its status isn't available here
//   ready    the service/phone answered and reports no problems
//   warning  it answered but reports a problem (low credit/battery, …)
//   offline  it didn't answer
//   auth     it rejected the token / username+password
// Per shop, since each can have its own phone.
const STATUS_CACHE_MS = 30 * 1000;
const cachedStatus = new Map(); // shop id (or 'env') -> { at, provider, value }
const cacheKey = store => (store && store.id) || 'env';

async function getPhoneStatus({ fresh = false, store = null } = {}) {
  const p = active(store);
  if (!p) return { state: 'off', provider: null, details: {}, checkedAt: new Date().toISOString() };
  const cached = cachedStatus.get(cacheKey(store));
  if (!fresh && cached && cached.provider === p.name && Date.now() - cached.at < STATUS_CACHE_MS) {
    return cached.value;
  }
  const value = { ...(await p.impl.serviceStatus(p.env)), provider: p.name, checkedAt: new Date().toISOString() };
  cachedStatus.set(cacheKey(store), { at: Date.now(), provider: p.name, value });
  return value;
}

// One shop's, or every shop's without one.
const resetPhoneStatusCache = store => { if (store) cachedStatus.delete(cacheKey(store)); else cachedStatus.clear(); };

// Final states: no point asking the provider again.
const FINAL_STATES = ['Sent', 'Delivered', 'Failed'];
// 'Sent' can still become 'Delivered', so keep asking for a while.
const POLL_STATES = ['Pending', 'Processed', 'Sent'];

module.exports = {
  isConfigured, provider, toInternationalBg, renderTemplate, smsParts, sendSms, getSmsState, FINAL_STATES, POLL_STATES,
  getPhoneStatus, resetPhoneStatusCache, PROVIDERS, smsEnv, SHOP_KEYS, SECRET_KEYS, MODES
};
