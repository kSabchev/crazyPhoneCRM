// @ts-check
// The shops: each one's details (from system.db) with its own database and
// order queries. Every request is tied to a shop (req.store, set by
// lib/auth.js), and the routes use req.store.db / req.store.tickets.
//
//   stores.get(id)           one shop, or null
//   stores.all()             every shop, in order
//   stores.defaultStore()    the first shop
//   stores.create({ name, prefix })   a new shop, with an empty database
const path = require('path');
const crypto = require('crypto');
const systemDb = require('./system-db');
const { openShopDb } = require('./shop-db');
const { ticketsRepo } = require('./tickets-repo');
const { dataDir } = require('./data-dir');

/** @typedef {import('../types/app').Store} Store */

/** @type {Map<number, Store>} */
const loaded = new Map();

/** @param {{ id: number, name: string, prefix: string, db_file: string, sms: string }} row @returns {Store} */
function fromRow(row) {
  const cached = loaded.get(row.id);
  if (cached) {
    // Name, prefix and SMS settings can change while the app runs.
    Object.assign(cached, { name: row.name, prefix: row.prefix, sms: parseSms(row.sms) });
    return cached;
  }
  const db = openShopDb(path.join(dataDir(), row.db_file));
  /** @type {Store} */
  const store = { id: row.id, name: row.name, prefix: row.prefix, sms: parseSms(row.sms), db, tickets: ticketsRepo(db) };
  loaded.set(row.id, store);
  return store;
}

/** @param {string} text */
function parseSms(text) {
  try { return JSON.parse(text || '{}'); } catch (_) { return {}; }
}

const SELECT = 'SELECT id, name, prefix, db_file, sms FROM stores';

/** @param {number | string} id @returns {Store | null} */
function get(id) {
  const row = /** @type {any} */ (systemDb.prepare(`${SELECT} WHERE id = ?`).get(id));
  return row ? fromRow(row) : null;
}

/** @returns {Store[]} */
function all() {
  return /** @type {any[]} */ (systemDb.prepare(`${SELECT} ORDER BY id`).all()).map(fromRow);
}

/** @returns {Store} */
function defaultStore() {
  return all()[0];
}

// A new shop's database is data/shop-<id>.db. Its settings start from the
// defaults, with the shop's name.
/** @param {{ name: string, prefix?: string }} shop @returns {Store} */
function create({ name, prefix = '' }) {
  const id = systemDb.transaction(() => {
    // db_file is unique, so a placeholder until the id is known.
    const { lastInsertRowid } = systemDb.prepare('INSERT INTO stores (name, prefix, db_file) VALUES (?, ?, ?)')
      .run(name, prefix, `new-${crypto.randomUUID()}`);
    systemDb.prepare('UPDATE stores SET db_file = ? WHERE id = ?').run(`shop-${lastInsertRowid}.db`, lastInsertRowid);
    return Number(lastInsertRowid);
  })();
  const store = /** @type {Store} */ (get(id));
  const settings = JSON.parse(/** @type {{ data: string }} */ (store.db.prepare('SELECT data FROM settings WHERE id = 1').get()).data);
  store.db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify({ ...settings, shopName: name }));
  return store;
}

module.exports = { get, all, defaultStore, create };
