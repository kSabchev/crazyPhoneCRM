// Create or update a login account for the repair shop app.
// Usage:  node create-admin.js <username> <password>
const bcrypt = require('bcrypt');
const db = require('./db');

const [, , username, password] = process.argv;

if (!username || !password) {
  console.log('Usage: node create-admin.js <username> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.log('Please use a password with at least 8 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`Password updated for existing user "${username}".`);
} else {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`User "${username}" created.`);
}
