// @ts-check
// Checking and normalising order data sent by the forms.
const { isValidDate, toPrice } = require('./util');

const PRAVIM_VALUES = ['circle', 'tick', 'cross'];
function normalizePravim(v, fallback) {
  return PRAVIM_VALUES.includes(v) ? v : fallback;
}

// ---- Ticket input validation ----
// Required fields must be non-empty strings, text is length-capped so a
// stray paste can't bloat the DB/print, dates must be real YYYY-MM-DD
// dates (what <input type="date"> sends), prices must be numbers >= 0.
/** @type {Array<[key: string, label: string, max: number, required: boolean]>} */
const TICKET_TEXT_FIELDS = [
  // [body key, label, max length, required]
  ['customerName', 'Име на клиента', 200, true],
  ['phoneContact', 'Телефон за контакт', 50, true],
  ['phoneModel', 'Модел на телефона', 100, true],
  ['description', 'Описание на проблема', 5000, true],
  ['status', 'Статус', 100, false],
  ['comment', 'Коментар', 5000, false],
  ['repairPerformed', 'Извършен ремонт', 5000, false],
  ['phonePassword', 'Парола', 100, false],
  ['kaparo', 'Капаро', 50, false]
];

// "Оборотен телефон" is a да/не choice. Missing/empty means "не".
const LOANER_VALUES = ['да', 'не'];
// (Other values are rejected by validateTicketInput before this is used.)
/** @returns {'да' | 'не'} */
function normalizeLoaner(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /** @type {'да' | 'не'} */ (s === '' ? 'не' : s);
}

// The customer's unlock code: stored trimmed, empty means none.
function normalizePassword(v) {
  return String(v ?? '').trim() || null;
}
/** @type {Array<[key: string, label: string, required: boolean]>} */
const TICKET_DATE_FIELDS = [
  ['dateReceived', 'Дата на приемане', true],
  ['dateReturned', 'Дата на връщане', false]
];
/** @type {Array<[key: string, label: string]>} */
const TICKET_PRICE_FIELDS = [
  ['servicePrice', 'Изкупна цена'],
  ['customerPrice', 'Продажна цена']
];

// Returns an error message, or null if valid. With `partial` (edits),
// fields left out of the body are fine — only the ones sent are checked.
function validateTicketInput(t, { partial }) {
  for (const [key, label, max, required] of TICKET_TEXT_FIELDS) {
    let v = t[key];
    if (v === undefined) {
      if (required && !partial) return `${label} е задължително поле`;
      continue;
    }
    if (v === null && !required) continue;
    if (key === 'kaparo' && typeof v === 'number') v = String(v);
    if (typeof v !== 'string') return `${label}: невалидна стойност`;
    if (required && !v.trim()) return `${label} е задължително поле`;
    if (v.length > max) return `${label} е твърде дълго (най-много ${max} символа)`;
  }
  for (const [key, label, required] of TICKET_DATE_FIELDS) {
    const v = t[key];
    if (v === undefined) {
      if (required && !partial) return `${label} е задължително поле`;
      continue;
    }
    if (v === '' || v === null) {
      if (required) return `${label} е задължително поле`;
      continue;
    }
    if (typeof v !== 'string' || !isValidDate(v)) return `${label}: невалидна дата`;
  }
  for (const [key, label] of TICKET_PRICE_FIELDS) {
    const v = t[key];
    if (v === undefined || v === null || v === '') continue;
    const n = toPrice(v);
    if (!Number.isFinite(n) || n < 0) return `${label}: невалидна сума`;
  }
  if (t.loanerPhone !== undefined && t.loanerPhone !== null) {
    if (typeof t.loanerPhone !== 'string' || !LOANER_VALUES.includes(normalizeLoaner(t.loanerPhone))) {
      return 'Оборотен телефон: изберете „да“ или „не“';
    }
  }
  return null;
}

module.exports = { validateTicketInput, normalizePravim, normalizeLoaner, normalizePassword };
