const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login } = require('./helpers');

const { app } = loadApp();

test('login succeeds with correct credentials and /me reports the user', async () => {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username: 'tester', password: 'secret123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'tester');

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'tester');
});

test('login rejects a wrong password and an unknown user', async () => {
  const wrongPw = await request(app).post('/api/auth/login').send({ username: 'tester', password: 'nope' });
  assert.equal(wrongPw.status, 401);
  const unknown = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'secret123' });
  assert.equal(unknown.status, 401);
});

test('login requires both username and password', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'tester' });
  assert.equal(res.status, 400);
});

test('logout ends the session', async () => {
  const agent = await login(request.agent(app));
  await agent.post('/api/auth/logout').expect(200);
  await agent.get('/api/auth/me').expect(401);
  await agent.get('/api/tickets').expect(401);
});

test('every protected route returns 401 without a session', async () => {
  const anon = request(app);
  const routes = [
    ['get', '/api/tickets'],
    ['post', '/api/tickets'],
    ['put', '/api/tickets/1'],
    ['delete', '/api/tickets/1'],
    ['get', '/api/tickets/1/history'],
    ['post', '/api/tickets/1/editing/start'],
    ['post', '/api/tickets/1/editing/stop'],
    ['get', '/api/settings'],
    ['put', '/api/settings'],
    ['get', '/api/devices'],
    ['get', '/api/audit'],
    ['get', '/api/events']
  ];
  for (const [method, url] of routes) {
    const res = await anon[method](url);
    assert.equal(res.status, 401, `${method.toUpperCase()} ${url}`);
  }
});
