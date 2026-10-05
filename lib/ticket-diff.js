// @ts-check
// Which order fields the change history tracks, and what changed between
// two versions of an order. No database access, so scheduled jobs and
// tests can use it freely (lib/audit.js writes the history).

// Order fields whose changes are recorded on edit.
const TRACKED_FIELDS = [
  ['customer_name', 'Име на клиента'],
  ['phone_contact', 'Телефон за контакт'],
  ['date_received', 'Дата на приемане'],
  ['date_returned', 'Дата на връщане'],
  ['phone_model', 'Модел на телефона'],
  ['status', 'Статус'],
  ['description', 'Описание на проблема'],
  ['phone_password', 'Парола'],
  ['comment', 'Коментар'],
  ['repair_performed', 'Извършен ремонт'],
  ['loaner_phone', 'Оборотен телефон'],
  ['pravim', 'Правим'],
  ['kaparo', 'Капаро'],
  ['service_price', 'Изкупна цена'],
  ['customer_price', 'Продажна цена']
];

// { field: { from, to } } for each tracked field that differs. The unlock
// code is sensitive: the history only notes that it changed, never the
// old or new value.
function diffTickets(before, after) {
  const diff = {};
  for (const [col] of TRACKED_FIELDS) {
    if (String(before[col] ?? '') !== String(after[col] ?? '')) {
      diff[col] = col === 'phone_password' ? { changed: true } : { from: before[col], to: after[col] };
    }
  }
  return diff;
}

module.exports = { TRACKED_FIELDS, diffTickets };
