// SMS notifications to customers. Two ways to send, chosen by .env:
//
// 1. SMSAPI.bg — a paid SMS service, no phone needed (see smsapi.js).
//    Used whenever SMSAPI_TOKEN is set.
//
// 2. The shop's Android phone, through "SMS Gateway for Android"
//    (https://sms-gate.app): the server asks the phone to send the SMS from
//    its own SIM.
//      SMS_GATEWAY_URL       Local server mode (phone on the shop Wi-Fi):
//                              http://<phone-ip>:8080
//                            Cloud mode (phone anywhere with internet):
//                              https://api.sms-gate.app/3rdparty/v1
//      SMS_GATEWAY_USER      username shown in the app
//      SMS_GATEWAY_PASSWORD  password shown in the app
//
// Without either SMS is switched off: nothing is ever sent and the app
// doesn't offer to send.
//
// In DEMO_MODE neither is used, even if set: SMS is simulated inside the
// app instead (see sms-demo.js) and nothing ever leaves the server.
const smsapi = require('./smsapi');
const smsDemo = require('./sms-demo');

const SEND_TIMEOUT_MS = 15000;

function gatewayConfig() {
  const url = (process.env.SMS_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  if (!url || process.env.DEMO_MODE === 'true') return null;
  return {
    url,
    user: process.env.SMS_GATEWAY_USER || '',
    password: process.env.SMS_GATEWAY_PASSWORD || '',
    // The cloud API uses /messages, the phone's local server /message.
    path: url.includes('/3rdparty/') ? '/messages' : '/message'
  };
}

// Which way SMS goes: 'demo', 'smsapi', 'phone', or null when SMS is off.
function provider() {
  if (smsDemo.config()) return 'demo';
  if (smsapi.config()) return 'smsapi';
  if (gatewayConfig()) return 'phone';
  return null;
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

function authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
}

// Sends one SMS (through SMSAPI or the phone). Resolves to
// { gatewayId, state }, or throws an Error suitable for showing to staff.
async function sendSms(phone, text) {
  if (provider() === 'demo') return smsDemo.send(phone, text);
  if (provider() === 'smsapi') return smsapi.send(phone, text);
  const cfg = gatewayConfig();
  if (!cfg) throw new Error('SMS известията не са настроени');
  let res;
  try {
    res = await fetch(cfg.url + cfg.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(cfg) },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phone], withDeliveryReport: true }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
  } catch (err) {
    throw new Error('Телефонът за SMS не отговаря. Проверете дали е включен, свързан към мрежата и приложението работи.');
  }
  if (res.status === 401) throw new Error('Грешно потребителско име или парола за SMS приложението');
  if (!res.ok) throw new Error(`SMS приложението върна грешка (${res.status})`);
  const body = await res.json().catch(() => ({}));
  return { gatewayId: body.id || null, state: body.state || 'Pending' };
}

// Current state of a sent message: { state, error }.
async function getSmsState(gatewayId) {
  if (provider() === 'demo') return smsDemo.state(gatewayId);
  if (provider() === 'smsapi') return smsapi.state(gatewayId);
  const cfg = gatewayConfig();
  if (!cfg || !gatewayId) return null;
  const res = await fetch(`${cfg.url}${cfg.path}/${encodeURIComponent(gatewayId)}`, {
    headers: { Authorization: authHeader(cfg) },
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  const recipient = Array.isArray(body.recipients) ? body.recipients[0] : null;
  return {
    state: (recipient && recipient.state) || body.state || null,
    error: (recipient && recipient.error) || body.reason || null
  };
}

// ---- Is the phone reachable and ready? ----
// Local server mode: the app's /health endpoint reports an overall status
// (pass / warn / fail) plus checks such as battery level, charging, network
// and failed messages. In cloud mode the phone can't be asked directly, so
// the state is reported as "cloud" rather than guessed.
const HEALTH_TIMEOUT_MS = 5000;
const STATUS_CACHE_MS = 30 * 1000;
let cachedStatus = null; // { at, value }

function checkValue(checks, key) {
  const c = checks && checks[key];
  if (!c) return null;
  return c.observedValue !== undefined ? c.observedValue : null;
}

function checkFailing(checks, key) {
  const c = checks && checks[key];
  return c && (c.status === 'warn' || c.status === 'fail');
}

// Returns { state, provider, details, checkedAt }; provider is 'demo',
// 'smsapi' or 'phone', and state one of:
//   off      SMS not configured
//   cloud    phone in cloud mode: its status isn't available here
//   ready    the service/phone answered and reports no problems
//   warning  it answered but reports a problem (low credit/battery, …)
//   offline  it didn't answer
//   auth     it rejected the token / username+password
async function getPhoneStatus({ fresh = false } = {}) {
  const which = provider();
  if (!which) return { state: 'off', provider: null, details: {}, checkedAt: new Date().toISOString() };
  if (!fresh && cachedStatus && cachedStatus.provider === which && Date.now() - cachedStatus.at < STATUS_CACHE_MS) {
    return cachedStatus.value;
  }

  let value;
  if (which === 'demo' || which === 'smsapi') {
    value = { ...(await (which === 'demo' ? smsDemo : smsapi).serviceStatus()), provider: which };
    value.checkedAt = new Date().toISOString();
    cachedStatus = { at: Date.now(), provider: which, value };
    return value;
  }

  const cfg = gatewayConfig();
  if (cfg.path === '/messages') return { state: 'cloud', provider: 'phone', details: {}, checkedAt: new Date().toISOString() };
  try {
    const res = await fetch(`${cfg.url}/health`, {
      headers: { Authorization: authHeader(cfg) },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (res.status === 401) {
      value = { state: 'auth', details: {} };
    } else {
      // The app answers 503 (with a body) when a check fails; still useful.
      const body = await res.json().catch(() => ({}));
      const checks = body.checks || {};
      const problems = [];
      if (checkFailing(checks, 'battery:level')) problems.push('ниска батерия');
      if (checkFailing(checks, 'connection:status')) problems.push('няма интернет връзка');
      if (checkFailing(checks, 'messages:failed')) problems.push('неуспешни SMS през последния час');
      const healthy = body.status === 'pass' || (!body.status && res.ok);
      value = {
        state: healthy && problems.length === 0 ? 'ready' : 'warning',
        details: {
          battery: checkValue(checks, 'battery:level'),
          charging: checkValue(checks, 'battery:charging'),
          network: checkValue(checks, 'connection:transport'),
          failedLastHour: checkValue(checks, 'messages:failed'),
          version: body.version || null,
          problems: problems.length ? problems : (healthy ? [] : ['телефонът съобщава за проблем'])
        }
      };
    }
  } catch (_) {
    value = { state: 'offline', details: {} };
  }
  value.provider = 'phone';
  value.checkedAt = new Date().toISOString();
  cachedStatus = { at: Date.now(), provider: which, value };
  return value;
}

const resetPhoneStatusCache = () => { cachedStatus = null; };

// Final states: no point asking the phone again.
const FINAL_STATES = ['Sent', 'Delivered', 'Failed'];
// 'Sent' can still become 'Delivered', so keep asking for a while.
const POLL_STATES = ['Pending', 'Processed', 'Sent'];

module.exports = {
  isConfigured, provider, toInternationalBg, renderTemplate, smsParts, sendSms, getSmsState, FINAL_STATES, POLL_STATES,
  getPhoneStatus, resetPhoneStatusCache
};
