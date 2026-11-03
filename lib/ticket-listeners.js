// @ts-check
// What happens after every change to an order (lib/ticket-events.js):
// it's written to the change history, and open screens are told to
// refresh. Registered once, by app.js.
const { ticketEvents } = require('./ticket-events');
const { logAudit, diffTickets } = require('./audit');
const { broadcastChange } = require('./live');

// ---- Change history ----
// Each event says which shop it happened in; its history is in that
// shop's database.
ticketEvents.on('created', ({ store, after: t, user }) => {
  logAudit(store.db, t.id, t.ticket_no, 'created', {
    customer_name: t.customer_name,
    phone_contact: t.phone_contact,
    date_received: t.date_received,
    date_returned: t.date_returned,
    phone_model: t.phone_model,
    status: t.status,
    description: t.description,
    comment: t.comment,
    repair_performed: t.repair_performed,
    loaner_phone: t.loaner_phone,
    // Never the value itself — only whether one was entered.
    phone_password_set: !!t.phone_password,
    pravim: t.pravim,
    kaparo: t.kaparo,
    service_price: t.service_price,
    customer_price: t.customer_price
  }, user);
});

// Only what actually changed; an edit that changed nothing isn't recorded.
ticketEvents.on('updated', ({ store, before, after, user, at }) => {
  const diff = diffTickets(before, after);
  if (Object.keys(diff).length > 0) logAudit(store.db, before.id, before.ticket_no, 'updated', diff, user, at);
});

ticketEvents.on('deleted', ({ store, before: t, user }) => {
  logAudit(store.db, t.id, t.ticket_no, 'deleted', {
    customer_name: t.customer_name,
    phone_contact: t.phone_contact,
    phone_model: t.phone_model,
    status: t.status
  }, user);
});

ticketEvents.on('sms', ({ store, ticket, phone, ok, user }) => {
  logAudit(store.db, ticket.id, ticket.ticket_no, 'sms', { phone, ok }, user);
});

// ---- Live updates ----
// To the screens of the shop that changed. One message per burst of changes
// (e.g. the hourly job changing several orders at once): screens reload
// once, not once per order.
/** @type {Set<number | null>} */
const pending = new Set();
/** @param {{ store: import('../types/app').EventStore }} event */
function refreshScreens({ store }) {
  const id = store.id ?? null; // no id: every screen
  if (pending.has(id)) return;
  pending.add(id);
  setImmediate(() => {
    pending.delete(id);
    broadcastChange('tickets', id);
  });
}
for (const event of ['created', 'updated', 'deleted', 'sms', 'smsStates']) {
  ticketEvents.on(event, refreshScreens);
}
