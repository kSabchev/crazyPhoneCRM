// SMS notifications to customers. Each way of sending is a provider module
// with the same four functions:
//
//   config()         settings from .env, or null/false when not set up
//   send(phone, text) -> { gatewayId, state }; throws an Error for staff
//   state(gatewayId)  -> { state, error } or null when unknown
//   serviceStatus()   -> { state, details } for the header pill
//
// The first provider in PROVIDERS that is set up is used. Without any, SMS
// is switched off: nothing is ever sent and the app doesn't offer to send.
// A new way of sending is one new module and one line in the list.
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

// The provider in use: { name, impl }, or null when SMS is off.
function active() {
  const found = PROVIDERS.find(([, impl]) => impl.config());
  return found ? { name: found[0], impl: found[1] } : null;
}

// Which way SMS goes: 'demo', 'smsapi', 'phone', or null when SMS is off.
function provider() {
  const p = active();
  return p ? p.name : null;
}
const isConfigured = () => provider() !== null;

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
async function sendSms(phone, text) {
  const p = active();
  if (!p) throw new Error('SMS известията не са настроени');
  return p.impl.send(phone, text);
}

// Current state of a sent message: { state, error }, or null if unknown.
async function getSmsState(gatewayId) {
  const p = active();
  if (!p || !gatewayId) return null;
  return p.impl.state(gatewayId);
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
const STATUS_CACHE_MS = 30 * 1000;
let cachedStatus = null; // { at, provider, value }

async function getPhoneStatus({ fresh = false } = {}) {
  const p = active();
  if (!p) return { state: 'off', provider: null, details: {}, checkedAt: new Date().toISOString() };
  if (!fresh && cachedStatus && cachedStatus.provider === p.name && Date.now() - cachedStatus.at < STATUS_CACHE_MS) {
    return cachedStatus.value;
  }
  const value = { ...(await p.impl.serviceStatus()), provider: p.name, checkedAt: new Date().toISOString() };
  cachedStatus = { at: Date.now(), provider: p.name, value };
  return value;
}

const resetPhoneStatusCache = () => { cachedStatus = null; };

// Final states: no point asking the provider again.
const FINAL_STATES = ['Sent', 'Delivered', 'Failed'];
// 'Sent' can still become 'Delivered', so keep asking for a while.
const POLL_STATES = ['Pending', 'Processed', 'Sent'];

module.exports = {
  isConfigured, provider, toInternationalBg, renderTemplate, smsParts, sendSms, getSmsState, FINAL_STATES, POLL_STATES,
  getPhoneStatus, resetPhoneStatusCache, PROVIDERS
};
