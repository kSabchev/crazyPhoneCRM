// Settings for running behind a hosting platform's HTTPS proxy (Render):
// TRUST_PROXY=1 and COOKIE_SECURE=true.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp } = require('./helpers');

process.env.TRUST_PROXY = '1';
process.env.COOKIE_SECURE = 'true';
const { app } = loadApp();

function loginFrom(ip, password, proto = 'https') {
  return request(app).post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .set('X-Forwarded-Proto', proto)
    .send({ username: 'tester', password });
}

test('a numeric TRUST_PROXY is a hop count, not an address', () => {
  assert.equal(app.get('trust proxy'), 1);
});

test('over HTTPS (as reported by the proxy) the login cookie is marked Secure', async () => {
  const res = await loginFrom('203.0.113.5', 'secret123').expect(200);
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /;\s*Secure/i);
  assert.match(cookie, /;\s*HttpOnly/i);
});

test('with COOKIE_SECURE, no login cookie is ever sent over plain HTTP', async () => {
  const res = await loginFrom('203.0.113.6', 'secret123', 'http').expect(200);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('the login limit counts each visitor\'s real IP behind the proxy', async () => {
  for (let i = 0; i < 10; i++) await loginFrom('198.51.100.1', 'wrong').expect(401);
  await loginFrom('198.51.100.1', 'secret123').expect(429);
  await loginFrom('198.51.100.2', 'secret123').expect(200);
});
