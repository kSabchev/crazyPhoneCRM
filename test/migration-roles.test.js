// A database from before roles existed: its accounts become admins, so
// nobody loses access after the upgrade.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { loadApp } = require('./helpers');

const { app, db } = loadApp({
  beforeLoad(dataRoot) {
    fs.mkdirSync(path.join(dataRoot, 'data'));
    const old = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
    old.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    old.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('owner', bcrypt.hashSync('ownerpass1', 4));
    old.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('helper', bcrypt.hashSync('helperpass1', 4));
    old.close();
  }
});

test('existing accounts become admins and keep full access', async () => {
  const roles = db.prepare("SELECT username, role FROM users WHERE username IN ('owner', 'helper') ORDER BY username").all();
  assert.deepEqual(roles, [{ username: 'helper', role: 'admin' }, { username: 'owner', role: 'admin' }]);

  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username: 'helper', password: 'helperpass1' }).expect(200);
  assert.equal(res.body.role, 'admin');
  await agent.get('/api/reports').expect(200);
  await agent.get('/api/users').expect(200);
});
