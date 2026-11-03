// @ts-check
// Announces every change to an order, so the side effects (the change
// history, live updates on open screens) run in one place instead of
// after each write — see lib/ticket-listeners.js. No dependencies, so
// scheduled jobs and tests can emit freely.
//
// Every payload has `store`: the shop the change happened in (at least
// its database), so the history goes to the right shop.
//
//   'created'    { store, after, user }
//   'updated'    { store, before, after, user, at? }   at: history time (UTC, SQLite format)
//   'deleted'    { store, before, user }
//   'sms'        { store, ticket, phone, ok, user }    an SMS was sent (or failed)
//   'smsStates'  { store, count }                      delivery states changed
//
// Listeners run synchronously, inside the caller's database transaction
// if there is one, so the history is written together with the change.
const { EventEmitter } = require('events');

// Typed: only the events above, each with its own payload (types/app.d.ts).
/** @type {EventEmitter<import('../types/app').TicketEventMap>} */
const ticketEvents = new EventEmitter();

module.exports = { ticketEvents };
