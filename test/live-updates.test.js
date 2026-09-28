// Live updates (SSE) and the "currently editing" presence indicator. These
// need a real listening server so a second client can hold the event
// stream open while the first one makes changes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let server, base, alice, bob;

test.before(async () => {
  const bcrypt = require('bcrypt');
  require('../db').prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run('bob', bcrypt.hashSync('secret123', 4));

  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  alice = await login(request.agent(base));
  bob = await login(request.agent(base), 'bob');
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});

// Opens the event stream as `agent` and resolves with each `data:` message.
function openStream(agent) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, { headers: { Cookie: agent.sessionCookie } }, res => {
      assert.equal(res.statusCode, 200);
      const messages = [];
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', chunk => {
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          messages.push(line.slice(6));
          while (waiters.length) waiters.shift()();
        }
      });
      const next = type => new Promise((res2, rej2) => {
        const timer = setTimeout(() => rej2(new Error(`no "${type}" event within 2s`)), 2000);
        const check = () => {
          const i = messages.indexOf(type);
          if (i === -1) return waiters.push(check);
          messages.splice(0, i + 1);
          clearTimeout(timer);
          res2();
        };
        check();
      });
      resolve({ next, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

test('a ticket change is pushed to other open sessions', async () => {
  const stream = await openStream(bob);
  try {
    const waiting = stream.next('tickets');
    await alice.post('/api/tickets').send(validTicket()).expect(201);
    await waiting;
  } finally {
    stream.close();
  }
});

test('a settings change is pushed to other open sessions', async () => {
  const stream = await openStream(bob);
  try {
    const waiting = stream.next('settings');
    await alice.put('/api/settings').send({ shopTagline: 'x' }).expect(200);
    await waiting;
  } finally {
    stream.close();
  }
});

test('presence: opening a ticket shows who is editing it, closing clears it', async () => {
  const t = (await alice.post('/api/tickets').send(validTicket())).body;

  await alice.post(`/api/tickets/${t.id}/editing/start`).expect(200);
  let row = (await bob.get('/api/tickets')).body.find(r => r.id === t.id);
  assert.equal(row.editing_by, 'tester');

  await alice.post(`/api/tickets/${t.id}/editing/stop`).expect(200);
  row = (await bob.get('/api/tickets')).body.find(r => r.id === t.id);
  assert.equal(row.editing_by, null);
});

test('presence: another user cannot clear someone else\'s editing marker', async () => {
  const t = (await alice.post('/api/tickets').send(validTicket())).body;

  await alice.post(`/api/tickets/${t.id}/editing/start`).expect(200);
  await bob.post(`/api/tickets/${t.id}/editing/stop`).expect(200);
  const row = (await alice.get('/api/tickets')).body.find(r => r.id === t.id);
  assert.equal(row.editing_by, 'tester');

  await alice.post(`/api/tickets/${t.id}/editing/stop`);
});

test('presence changes are broadcast so other screens update', async () => {
  const t = (await alice.post('/api/tickets').send(validTicket())).body;
  const stream = await openStream(bob);
  try {
    const waiting = stream.next('tickets');
    await alice.post(`/api/tickets/${t.id}/editing/start`).expect(200);
    await waiting;
  } finally {
    stream.close();
    await alice.post(`/api/tickets/${t.id}/editing/stop`);
  }
});
