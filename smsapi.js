// @ts-check
// SMS through SMSAPI.bg (https://www.smsapi.bg) — a paid SMS service, no
// phone needed. Configured in .env:
//
//   SMSAPI_TOKEN   OAuth token from portal.smsapi.bg → OAuth tokens
//   SMSAPI_SENDER  optional: an approved sender name (max 11 characters);
//                  without it SMSAPI uses its default sender
//   SMSAPI_TEST    optional: "true" = test mode — SMSAPI accepts the
//                  message but doesn't deliver or charge it
//   SMSAPI_URL     optional: API address (default https://api.smsapi.bg)
//
// One of the SMS providers listed in sms.js; used instead of the phone
// gateway whenever SMSAPI_TOKEN is set.

const { assertTestUrl } = require('./lib/test-guard');

const TIMEOUT_MS = 15000;
// Below this many credits the header shows a "top up soon" warning.
const LOW_CREDIT = 5;

function config() {
  const token = (process.env.SMSAPI_TOKEN || '').trim();
  if (!token || process.env.DEMO_MODE === 'true') return null;
  return {
    token,
    url: (process.env.SMSAPI_URL || 'https://api.smsapi.bg').trim().replace(/\/+$/, ''),
    sender: (process.env.SMSAPI_SENDER || '').trim(),
    test: process.env.SMSAPI_TEST === 'true'
  };
}

// SMSAPI error codes we can explain better; others show SMSAPI's own text.
const ERROR_HINTS = {
  101: 'грешен или изтекъл API ключ (SMSAPI_TOKEN)',
  102: 'грешни данни за вход',
  103: 'няма достатъчно кредит в SMSAPI — заредете профила',
  13: 'невалиден телефонен номер',
  14: 'името на подателя (SMSAPI_SENDER) не е одобрено в SMSAPI'
};

function smsapiError(body, status) {
  const code = body && body.error;
  const hint = ERROR_HINTS[code];
  const text = body && body.message ? `${body.message}` : `HTTP ${status}`;
  const err = /** @type {Error & { code?: number }} */ (new Error(`SMSAPI: ${hint ? hint + ' — ' : ''}${text}${code ? ` (код ${code})` : ''}`));
  err.code = code;
  return err;
}

// SMSAPI status names -> the app's SMS states (see sms.js).
/** @typedef {import('./types/app').SmsProvider} SmsProvider The interface every provider implements (see sms.js). */

/** @type {Record<string, import('./types/app').SmsState>} */
const STATE_MAP = {
  QUEUE: 'Pending', ACCEPTED: 'Pending', PENDING: 'Pending', RENEWAL: 'Pending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  UNDELIVERED: 'Failed', FAILED: 'Failed', EXPIRED: 'Failed', REJECTED: 'Failed', STOP: 'Failed'
};
const FAILURE_TEXT = {
  UNDELIVERED: 'не е доставено (невалиден или недостъпен номер)',
  FAILED: 'изпращането се провали',
  EXPIRED: 'изтече, без да бъде доставено',
  REJECTED: 'отхвърлено от оператора',
  STOP: 'спряно'
};

// `body` is whatever SMSAPI answered (JSON), not checked further.
/**
 * @param {{ url: string, token: string }} cfg
 * @param {string} path
 * @param {{ method?: string, form?: Record<string, string> }} [options]
 * @returns {Promise<{ res: Response, body: any }>}
 */
async function call(cfg, path, { method = 'GET', form } = {}) {
  assertTestUrl(cfg.url, 'SMSAPI_URL'); // tests: only the fake SMSAPI
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

// Sends one SMS. `phone` is "+359…"; SMSAPI wants digits only.
// Resolves to { gatewayId, state } or throws an Error for staff to read.
/** @param {string} phone @param {string} [text] @returns {ReturnType<SmsProvider['send']>} */
async function send(phone, text) {
  const cfg = config();
  if (!cfg) throw new Error('SMSAPI не е настроен');
  assertTestUrl(cfg.url, 'SMSAPI_URL'); // before the try below, so the reason shows
  const form = {
    to: phone.replace(/^\+/, ''),
    message: text,
    format: 'json',
    encoding: 'utf-8'
  };
  if (cfg.sender) form.from = cfg.sender;
  if (cfg.test) form.test = '1';

  let result;
  try {
    result = await call(cfg, '/sms.do', { method: 'POST', form });
  } catch (_) {
    throw new Error('SMSAPI не отговаря. Проверете интернет връзката на компютъра и опитайте отново.');
  }
  const { res, body } = result;
  if (body.error || !res.ok) throw smsapiError(body, res.status);
  const item = Array.isArray(body.list) ? body.list[0] : null;
  if (!item || !item.id) throw new Error('SMSAPI не върна номер на съобщението');
  return { gatewayId: String(item.id), state: STATE_MAP[item.status] || 'Pending' };
}

// Current state of a sent message: { state, error } or null if unknown.
// NOTE: uses SMSAPI's sms.do?status=<id> lookup — confirm against a real
// account; if SMSAPI answers differently the SMS simply stays "Pending".
/** @param {string} id @returns {ReturnType<SmsProvider['state']>} */
async function state(id) {
  const cfg = config();
  if (!cfg || !id) return null;
  const { res, body } = await call(cfg, `/sms.do?status=${encodeURIComponent(id)}&format=json`);
  if (!res.ok || body.error) return null;
  const item = Array.isArray(body.list) ? body.list[0] : null;
  const name = item && (item.status_name || item.status);
  if (!name || !STATE_MAP[name]) return null;
  return { state: STATE_MAP[name], error: FAILURE_TEXT[name] || null };
}

// Is SMSAPI reachable and the token valid? Also reports the credit left.
// Returns { state, details } with state ready / warning / offline / auth.
/** @returns {ReturnType<SmsProvider['serviceStatus']>} */
async function serviceStatus() {
  const cfg = config();
  if (!cfg) return { state: 'off', details: {} };
  try {
    const { res, body } = await call(cfg, '/profile');
    if (res.status === 401 || res.status === 403 || body.error === 101) return { state: 'auth', details: { provider: 'smsapi' } };
    if (!res.ok) return { state: 'offline', details: { provider: 'smsapi' } };
    const credit = typeof body.points === 'number' ? body.points : null;
    const problems = [];
    if (credit !== null && credit < LOW_CREDIT) problems.push('малко кредит — заредете профила в SMSAPI');
    if (cfg.test) problems.push('тестов режим — SMS не се доставят (SMSAPI_TEST)');
    return {
      state: problems.length ? 'warning' : 'ready',
      details: { provider: 'smsapi', credit, sender: cfg.sender || null, test: cfg.test, problems }
    };
  } catch (_) {
    return { state: 'offline', details: { provider: 'smsapi' } };
  }
}

module.exports = { config, send, state, serviceStatus, LOW_CREDIT };
