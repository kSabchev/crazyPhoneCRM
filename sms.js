// SMS notifications through "SMS Gateway for Android" (https://sms-gate.app)
// running on the shop's Android phone: the server asks the phone to send
// the SMS from its own SIM. Configured in .env:
//
//   SMS_GATEWAY_URL       Local server mode (phone on the shop Wi-Fi):
//                           http://<phone-ip>:8080
//                         Cloud mode (phone anywhere with internet):
//                           https://api.sms-gate.app/3rdparty/v1
//   SMS_GATEWAY_USER      username shown in the app
//   SMS_GATEWAY_PASSWORD  password shown in the app
//
// Without these (and always in DEMO_MODE) SMS is switched off: nothing is
// ever sent and the app doesn't offer to send.

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

const isConfigured = () => gatewayConfig() !== null;

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

// Asks the phone to send one SMS. Resolves to { gatewayId, state }, or
// throws an Error with a message suitable for showing to staff.
async function sendSms(phone, text) {
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

// Returns { state, details, checkedAt } where state is one of:
//   off      SMS not configured
//   cloud    cloud mode: phone status not available here
//   ready    phone answered and reports no problems
//   warning  phone answered but reports a problem (e.g. low battery)
//   offline  phone didn't answer (off, not on the Wi-Fi, app stopped)
//   auth     phone answered but rejected the username/password
async function getPhoneStatus({ fresh = false } = {}) {
  const cfg = gatewayConfig();
  if (!cfg) return { state: 'off', details: {}, checkedAt: new Date().toISOString() };
  if (cfg.path === '/messages') return { state: 'cloud', details: {}, checkedAt: new Date().toISOString() };
  if (!fresh && cachedStatus && Date.now() - cachedStatus.at < STATUS_CACHE_MS) return cachedStatus.value;

  let value;
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
  value.checkedAt = new Date().toISOString();
  cachedStatus = { at: Date.now(), value };
  return value;
}

const resetPhoneStatusCache = () => { cachedStatus = null; };

// Final states: no point asking the phone again.
const FINAL_STATES = ['Sent', 'Delivered', 'Failed'];
// 'Sent' can still become 'Delivered', so keep asking for a while.
const POLL_STATES = ['Pending', 'Processed', 'Sent'];

module.exports = {
  isConfigured, toInternationalBg, renderTemplate, smsParts, sendSms, getSmsState, FINAL_STATES, POLL_STATES,
  getPhoneStatus, resetPhoneStatusCache
};
