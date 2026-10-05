// @ts-check
// Login checks used by the routes.
const db = require('../db');

// The logged-in user is looked up on every request, so a role change or a
// removed account takes effect immediately, even for open sessions.
function requireAuth(req, res, next) {
  const user = req.session && req.session.userId
    ? /** @type {Pick<import('../types/app').UserRow, 'id' | 'username' | 'role'> | undefined} */ (
        db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId))
    : null;
  if (!user) {
    if (req.session && req.session.userId) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Не сте влезли в системата' });
  }
  req.user = user;
  req.session.username = user.username;
  next();
}

// Admin-only actions: deleting orders, saving Settings, reports (money),
// and managing accounts.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Само администратор може да направи това' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
