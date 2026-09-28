// Kept in its own file: the login limiter counts per process, so running
// it next to other login-heavy tests would make them interfere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp } = require('./helpers');

const { app } = loadApp();

function attempt(password) {
  return request(app).post('/api/auth/login').send({ username: 'tester', password });
}

test('successful logins never count towards the limit', async () => {
  for (let i = 0; i < 15; i++) {
    await attempt('secret123').expect(200);
  }
});

test('after 10 failed logins the IP is blocked, even with the right password', async () => {
  for (let i = 0; i < 10; i++) {
    await attempt('wrong').expect(401);
  }
  const blocked = await attempt('secret123');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Твърде много неуспешни опити/);
  assert.ok(blocked.headers['retry-after'], 'tells the client when to retry');
});

test('the limit applies only to login, not to the rest of the API', async () => {
  await request(app).get('/health').expect(200);
  await request(app).get('/api/auth/me').expect(401);
});
