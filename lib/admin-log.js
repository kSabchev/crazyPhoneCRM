// @ts-check
// The admin log: changes to shops, accounts and settings, which the
// activity log (orders) doesn't cover. Kept in system.db (admin_log), so
// it's backed up with the accounts; shown at the bottom of Настройки.
//
// Each entry: who, when, what (action), which shop (if any) and the details
// of the change. Secrets (passwords, SMS tokens) are never written: only
// that they were set or removed.
//
// Actions: shop_added, shop_changed, shop_archived, shop_restored,
//          user_added, user_changed, user_removed, password_changed,
//          settings_changed, sms_settings_changed
const db = require('./system-db');

/**
 * @param {string} username who made the change ("create-admin.js" from the command line)
 * @param {string} action
 * @param {Record<string, unknown>} [details]
 * @param {number | null} [storeId] the shop it concerns
 */
function logAdmin(username, action, details = {}, storeId = null) {
  db.prepare('INSERT INTO admin_log (performed_by, action, store_id, details) VALUES (?, ?, ?, ?)')
    .run(username, action, storeId, JSON.stringify(details));
}

const LIMIT = 200;

// The newest entries first, each with its shop's current name.
function readAdminLog(limit = LIMIT) {
  return /** @type {any[]} */ (db.prepare(`
    SELECT a.id, a.performed_at, a.performed_by, a.action, a.store_id, a.details, s.name AS store_name
    FROM admin_log a LEFT JOIN stores s ON s.id = a.store_id
    ORDER BY a.performed_at DESC, a.id DESC LIMIT ?`).all(limit))
    .map(r => ({ ...r, details: JSON.parse(r.details) }));
}

module.exports = { logAdmin, readAdminLog };
