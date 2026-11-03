// @ts-check
// Which shop an order belongs to, for the routes that take an order :id.
//
// Order ids repeat between shops. In the admins' "all shops" view the page
// gets ids as "<shop id>:<order id>" (present() below), so an edit reaches
// the right shop's database. Plain ids mean the shop the request works on
// (req.store). Only admins may name another shop.
const stores = require('./stores');

/** @typedef {import('../types/app').Store} Store */

/** @returns {{ store: Store, id: number | string } | null} */
function ticketTarget(req) {
  const m = /^(\d+):(\d+)$/.exec(String(req.params.id));
  if (!m) return { store: req.store, id: req.params.id };
  if (req.user.role !== 'admin') return null;
  const store = stores.get(m[1]);
  return store && !store.archived ? { store, id: Number(m[2]) } : null;
}

// The order an :id means, from its shop: { store, ticket }, or null.
/** @returns {{ store: Store, ticket: import('../types/app').Ticket } | null} */
function findTicket(req) {
  const target = ticketTarget(req);
  const ticket = target && target.store.tickets.get(target.id);
  return ticket ? { store: target.store, ticket } : null;
}

// An order as the page gets it: with its shop, and in the all-shops view
// with the shop in its id.
/** @template {{ id: number }} T @param {any} req @param {Store} store @param {T} row */
function present(req, store, row) {
  const withShop = { ...row, store_id: store.id, store_name: store.name, store_prefix: store.prefix };
  return req.allShops ? { ...withShop, id: `${store.id}:${row.id}` } : withShop;
}

// The shops a request covers: every shop in the all-shops view, otherwise
// its own.
/** @returns {Store[]} */
const shopsOf = req => (req.allShops ? stores.all() : [req.store]);

// The order number as people see it: with the shop's prefix ("Л-123").
/** @param {Pick<Store, 'prefix'>} store @param {{ ticket_no: number }} ticket */
const orderNumber = (store, ticket) => (store.prefix ? `${store.prefix}-${ticket.ticket_no}` : String(ticket.ticket_no));

module.exports = { ticketTarget, findTicket, present, shopsOf, orderNumber };
