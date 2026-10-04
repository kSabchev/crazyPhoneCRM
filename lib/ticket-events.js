// Announces every change to an order, so the side effects (the change
// history, live updates on open screens) run in one place instead of
// after each write — see lib/ticket-listeners.js. No dependencies, so
// scheduled jobs and tests can emit freely.
//
//   'created'    { after, user }
//   'updated'    { before, after, user, at? }   at: history time (UTC, SQLite format)
//   'deleted'    { before, user }
//   'sms'        { ticket, phone, ok, user }    an SMS was sent (or failed)
//   'smsStates'  { count }                      delivery states changed
//
// Listeners run synchronously, inside the caller's database transaction
// if there is one, so the history is written together with the change.
const { EventEmitter } = require('events');

const ticketEvents = new EventEmitter();

module.exports = { ticketEvents };
