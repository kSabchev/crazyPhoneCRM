// @ts-check
// What happens after every change to an order (lib/ticket-events.js):
// it's written to the change history, and open screens are told to
// refresh. Registered once, by app.js.
const { ticketEvents } = require('./ticket-events');
const { logAudit, diffTickets } = require('./audit');
const { broadcastChange } = require('./live');

// ---- Change history ----
ticketEvents.on('created', ({ after: t, user }) => {
  logAudit(t.id, t.ticket_no, 'created', {
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
ticketEvents.on('updated', ({ before, after, user, at }) => {
  const diff = diffTickets(before, after);
  if (Object.keys(diff).length > 0) logAudit(before.id, before.ticket_no, 'updated', diff, user, at);
});

ticketEvents.on('deleted', ({ before: t, user }) => {
  logAudit(t.id, t.ticket_no, 'deleted', {
    customer_name: t.customer_name,
    phone_contact: t.phone_contact,
    phone_model: t.phone_model,
    status: t.status
  }, user);
});

ticketEvents.on('sms', ({ ticket, phone, ok, user }) => {
  logAudit(ticket.id, ticket.ticket_no, 'sms', { phone, ok }, user);
});

// ---- Live updates ----
// One message per burst of changes (e.g. the hourly job changing several
// orders at once): screens reload once, not once per order.
let pending = false;
function refreshScreens() {
  if (pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    broadcastChange('tickets');
  });
}
for (const event of ['created', 'updated', 'deleted', 'sms', 'smsStates']) {
  ticketEvents.on(event, refreshScreens);
}
