// The change history (audit_log): who did what, to which order, and when.
const db = require('../db');

function logAudit(ticketId, ticketNo, action, changes, username) {
  db.prepare(
    `INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, ticketNo, action, JSON.stringify(changes), username);
}

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

module.exports = { logAudit, TRACKED_FIELDS };
