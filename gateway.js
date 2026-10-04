// SMS from the shop's Android phone, through "SMS Gateway for Android"
// (https://sms-gate.app): the server asks the phone to send the SMS from
// its own SIM. Configured in .env:
//
//   SMS_GATEWAY_URL       Local server mode (phone on the shop Wi-Fi):
//                           http://<phone-ip>:8080
//                         Cloud mode (phone anywhere with internet):
//                           https://api.sms-gate.app/3rdparty/v1
//   SMS_GATEWAY_USER      username shown in the app
//   SMS_GATEWAY_PASSWORD  password shown in the app
//
// One of the SMS providers listed in sms.js.

const SEND_TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS = 5000;

function config() {
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

function authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
}

// Sends one SMS. Resolves to { gatewayId, state }, or throws an Error
// suitable for showing to staff.
async function send(phone, text) {
  const cfg = config();
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

// Current state of a sent message: { state, error }, or null if unknown.
async function state(gatewayId) {
  const cfg = config();
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
function checkValue(checks, key) {
  const c = checks && checks[key];
  if (!c) return null;
  return c.observedValue !== undefined ? c.observedValue : null;
}

function checkFailing(checks, key) {
  const c = checks && checks[key];
  return c && (c.status === 'warn' || c.status === 'fail');
}

// Returns { state, details } with state cloud / ready / warning / offline / auth.
async function serviceStatus() {
  const cfg = config();
  if (!cfg) return { state: 'off', details: {} };
  if (cfg.path === '/messages') return { state: 'cloud', details: {} };
  try {
    const res = await fetch(`${cfg.url}/health`, {
      headers: { Authorization: authHeader(cfg) },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (res.status === 401) return { state: 'auth', details: {} };
    // The app answers 503 (with a body) when a check fails; still useful.
    const body = await res.json().catch(() => ({}));
    const checks = body.checks || {};
    const problems = [];
    if (checkFailing(checks, 'battery:level')) problems.push('ниска батерия');
    if (checkFailing(checks, 'connection:status')) problems.push('няма интернет връзка');
    if (checkFailing(checks, 'messages:failed')) problems.push('неуспешни SMS през последния час');
    const healthy = body.status === 'pass' || (!body.status && res.ok);
    return {
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
  } catch (_) {
    return { state: 'offline', details: {} };
  }
}

module.exports = { config, send, state, serviceStatus };
