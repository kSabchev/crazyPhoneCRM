// Create or update a login account for the repair shop app. Accounts are
// normally managed in the app (Настройки → Потребители); this is for the
// first admin, or to get back in if no admin can log in.
//
// Usage:  node create-admin.js <username> <password> [--staff | --manager | --admin]
//   New accounts are admins unless --staff or --manager (shop manager) is
//   given. Staff and managers made here work in the first shop; another
//   shop can be picked in Настройки → Потребители.
//   For an existing account the password is reset; its role only changes
//   if one of the flags is given.
const bcrypt = require('bcrypt');
const db = require('./lib/system-db'); // accounts (all shops)

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const [username, password] = args.filter(a => !a.startsWith('--'));
const ROLE_FLAGS = { '--staff': 'staff', '--manager': 'shop_manager', '--admin': 'admin' };
const role = flags.map(f => ROLE_FLAGS[f]).find(Boolean) || null;

if (!username || !password || flags.some(f => !ROLE_FLAGS[f])) {
  console.log('Usage: node create-admin.js <username> <password> [--staff | --manager | --admin]');
  process.exit(1);
}

if (password.length < 8) {
  console.log('Please use a password with at least 8 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare('SELECT id, role, store_id FROM users WHERE username = ?').get(username);
const firstShop = db.prepare('SELECT MIN(id) AS id FROM stores').get().id;
// Admins see every shop; a shop account keeps its shop, or gets the first.
const shopOf = (newRole, current) => (newRole === 'admin' ? null : current || firstShop);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  if (role) db.prepare('UPDATE users SET role = ?, store_id = ? WHERE username = ?').run(role, shopOf(role, existing.store_id), username);
  console.log(`Password updated for existing user "${username}" (${role || existing.role}).`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, role, store_id) VALUES (?, ?, ?, ?)')
    .run(username, hash, role || 'admin', shopOf(role || 'admin', null));
  console.log(`User "${username}" created (${role || 'admin'}).`);
}
