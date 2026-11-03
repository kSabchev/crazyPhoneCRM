// @ts-check
// Login checks used by the routes. They also tie the request to a shop
// (req.store):
//   staff, shop managers  their own shop (users.store_id), nothing else
//   admins                the shop they've picked (session.storeId; the
//                         first shop until they pick one), or all shops
//                         (session.allShops: req.allShops, with req.store
//                         the first shop for what isn't per order)
const db = require('./system-db');
const stores = require('./stores');

/** @typedef {Pick<import('../types/app').UserRow, 'id' | 'username' | 'role' | 'store_id'>} SessionUser */

const ROLES = ['admin', 'shop_manager', 'staff'];

// Managers and admins: Справки and deleting orders.
/** @param {{ role: string }} user */
const canManage = user => user.role === 'admin' || user.role === 'shop_manager';

const NO_SHOP = 'Профилът ви не е свързан с магазин. Обърнете се към администратор.';

// The shop a user works on: null for a shop account whose shop is missing.
/** @param {SessionUser} user @param {{ storeId?: number }} [session] */
function storeFor(user, session) {
  if (user.role === 'admin') {
    return (session && session.storeId && stores.get(session.storeId)) || stores.defaultStore();
  }
  return user.store_id ? stores.get(user.store_id) : null;
}

// The logged-in user is looked up on every request, so a role change, a move
// to another shop or a removed account takes effect immediately, even for
// open sessions.
function requireAuth(req, res, next) {
  const user = req.session && req.session.userId
    ? /** @type {SessionUser | undefined} */ (
        db.prepare('SELECT id, username, role, store_id FROM users WHERE id = ?').get(req.session.userId))
    : null;
  if (!user) {
    if (req.session && req.session.userId) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Не сте влезли в системата' });
  }
  const store = storeFor(user, req.session);
  if (!store) return res.status(403).json({ error: NO_SHOP });
  req.user = user;
  req.store = store;
  req.allShops = user.role === 'admin' && !!req.session.allShops;
  req.session.username = user.username;
  next();
}

// Admin-only actions: saving Settings, backups and managing accounts.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Само администратор може да направи това' });
    }
    next();
  });
}

// Managers and admins: Справки (money) and deleting orders.
function requireManager(req, res, next) {
  requireAuth(req, res, () => {
    if (!canManage(req.user)) {
      return res.status(403).json({ error: 'Само управител или администратор може да направи това' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, requireManager, storeFor, canManage, ROLES, NO_SHOP };
