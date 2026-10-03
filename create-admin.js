// Create or update a login account for the repair shop app. Accounts are
// normally managed in the app (Настройки → Потребители); this is for the
// first admin, or to get back in if no admin can log in.
//
// Usage:  node create-admin.js <username> <password> [--staff | --admin]
//   New accounts are admins unless --staff is given.
//   For an existing account the password is reset; its role only changes
//   if --staff or --admin is given.
const bcrypt = require('bcrypt');
const db = require('./db');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const [username, password] = args.filter(a => !a.startsWith('--'));
const role = flags.includes('--staff') ? 'staff' : flags.includes('--admin') ? 'admin' : null;

if (!username || !password || flags.some(f => f !== '--staff' && f !== '--admin')) {
  console.log('Usage: node create-admin.js <username> <password> [--staff | --admin]');
  process.exit(1);
}

if (password.length < 8) {
  console.log('Please use a password with at least 8 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  if (role) db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username);
  console.log(`Password updated for existing user "${username}" (${role || existing.role}).`);
} else {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role || 'admin');
  console.log(`User "${username}" created (${role || 'admin'}).`);
}
