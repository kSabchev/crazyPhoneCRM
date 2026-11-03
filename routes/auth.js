// @ts-check
// Logging in and out, picking a shop (admins), your own password, and
// managing accounts (admins).
const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const db = require('../lib/system-db'); // accounts
const stores = require('../lib/stores');
const { requireAuth, requireAdmin, storeFor, ROLES, NO_SHOP } = require('../lib/auth');

const router = express.Router();

// Slows down password guessing: after 10 failed logins from one IP within
// 15 minutes, that IP is blocked from logging in until the window passes.
// Successful logins don't count, so staff typos never add up over a day.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Твърде много неуспешни опити за вход. Опитайте отново след 15 минути.' }
});

router.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Потребителското име и паролата са задължителни' });
  }

  const user = /** @type {import('../types/app').UserRow | undefined} */ (db.prepare('SELECT * FROM users WHERE username = ?').get(username));
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Невалидно потребителско име или парола' });
  }

  const store = storeFor(user);
  if (!store) return res.status(403).json({ error: NO_SHOP });

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json(sessionInfo(user, store));
});

router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(sessionInfo(req.user, req.store, req.allShops));
});

// Who's logged in and the shop they work on. Admins also get every shop,
// to pick from.
/** @param {{ username: string, role: string }} user @param {import('../types/app').Store} store @param {boolean} [allShops] */
function sessionInfo(user, store, allShops = false) {
  /** @param {import('../types/app').Store} s */
  const shop = s => ({ id: s.id, name: s.name, prefix: s.prefix });
  return {
    username: user.username,
    role: user.role,
    store: shop(store),
    ...(user.role === 'admin' ? { stores: stores.all().map(shop), allShops } : {})
  };
}

// Admins: work on another shop, or on all shops ("all"). Shop accounts
// always work on their own.
router.post('/api/auth/store', requireAdmin, (req, res) => {
  const { storeId } = req.body || {};
  if (storeId === 'all') {
    req.session.allShops = true;
    return res.json(sessionInfo(req.user, req.store, true));
  }
  const store = stores.get(storeId);
  if (!store) return res.status(400).json({ error: 'Невалиден магазин' });
  req.session.storeId = store.id;
  req.session.allShops = false;
  res.json(sessionInfo(req.user, store, false));
});

// ---- Accounts ----
const MIN_PASSWORD = 8;
const USERNAME = /^[\p{L}\p{N}._-]{3,40}$/u;
const hashPassword = pw => bcrypt.hashSync(pw, 12);

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Паролата трябва да е поне ${MIN_PASSWORD} знака`;
  if (pw.length > 200) return 'Паролата е твърде дълга';
  return null;
}

// Safety net: the "at least one admin" checks below can't currently trigger
// through the app — only admins manage accounts and they can't demote or
// remove themselves, so any admin they act on is a second admin. Kept in
// case that ever changes.
const adminCount = () => /** @type {{ n: number }} */ (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).n;

// Anyone: change your own password (the current one is required).
router.post('/api/auth/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = /** @type {{ password_hash: string }} */ (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id));
  if (typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'Текущата парола е грешна' });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

// The shop a shop account gets: the one asked for, or else `fallback`.
// Admins have none (they see every shop).
/** @returns {{ storeId?: number | null, error?: string }} */
function shopForRole(role, storeId, fallback) {
  if (role === 'admin') return { storeId: null };
  if (storeId === undefined || storeId === null || storeId === '') return { storeId: fallback };
  const store = stores.get(storeId);
  return store ? { storeId: store.id } : { error: 'Невалиден магазин' };
}

const USER_FIELDS = 'id, username, role, store_id, created_at';

// Admins: list, add, change and remove accounts. A shop account without a
// shop given goes to the shop the admin is working on.
router.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT ${USER_FIELDS} FROM users ORDER BY username`).all());
});

router.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role, storeId } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME.test(name)) {
    return res.status(400).json({ error: 'Потребителското име трябва да е 3–40 знака: букви, цифри, точка, тире или долна черта' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Невалидна роля' });
  const shop = shopForRole(role, storeId, req.store.id);
  if (shop.error) return res.status(400).json({ error: shop.error });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(name)) {
    return res.status(409).json({ error: `Потребител „${name}“ вече съществува` });
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?, ?, ?, ?)')
    .run(name, hashPassword(password), role, shop.storeId ?? null);
  res.status(201).json(db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(lastInsertRowid));
});

router.put('/api/users/:id', requireAdmin, (req, res) => {
  const target = /** @type {Pick<import('../types/app').UserRow, 'id' | 'username' | 'role' | 'store_id'> | undefined} */ (
    db.prepare('SELECT id, username, role, store_id FROM users WHERE id = ?').get(req.params.id));
  if (!target) return res.status(404).json({ error: 'Потребителят не е намерен' });
  const { role, password, storeId } = req.body || {};

  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Невалидна роля' });
    if (target.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Не можете да премахнете собствените си администраторски права' });
    }
    if (target.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
      return res.status(400).json({ error: 'Трябва да остане поне един администратор' });
    }
  }
  // A new role or shop: an account becoming a shop account keeps its shop,
  // or else gets the one the admin is working on.
  let shop = null;
  if (role !== undefined || storeId !== undefined) {
    shop = shopForRole(role ?? target.role, storeId, target.store_id ?? req.store.id);
    if (shop.error) return res.status(400).json({ error: shop.error });
  }
  if (password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
  }

  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  if (shop) db.prepare('UPDATE users SET store_id = ? WHERE id = ?').run(shop.storeId ?? null, target.id);
  if (password !== undefined) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
  res.json(db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(target.id));
});

router.delete('/api/users/:id', requireAdmin, (req, res) => {
  const target = /** @type {Pick<import('../types/app').UserRow, 'id' | 'role'> | undefined} */ (db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id));
  if (!target) return res.status(404).json({ error: 'Потребителят не е намерен' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Не можете да премахнете собствения си профил' });
  if (target.role === 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'Трябва да остане поне един администратор' });
  }
  // Their open sessions stop working on their next request (requireAuth).
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = router;
