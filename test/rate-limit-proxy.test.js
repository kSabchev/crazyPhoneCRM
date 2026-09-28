// With TRUST_PROXY set (app behind nginx/Caddy), the login limit must be
// counted per real client IP from X-Forwarded-For, not per proxy address.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp } = require('./helpers');

process.env.TRUST_PROXY = 'loopback';
const { app } = loadApp();

function attemptFrom(ip, password) {
  return request(app).post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ username: 'tester', password });
}

test('one client being blocked does not lock out others behind the same proxy', async () => {
  for (let i = 0; i < 10; i++) {
    await attemptFrom('100.64.0.10', 'wrong').expect(401);
  }
  const blocked = await attemptFrom('100.64.0.10', 'secret123');
  assert.equal(blocked.status, 429);

  await attemptFrom('100.64.0.11', 'secret123').expect(200);
});
