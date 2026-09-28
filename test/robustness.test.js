// /health, the JSON error handler, database indexes, and the process-level
// crash handlers in server.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { ROOT, loadApp, login, makeDataRoot } = require('./helpers');

const { app, db } = loadApp();

test('/health reports ok without needing a login', async () => {
  const res = await request(app).get('/health').expect(200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('malformed JSON gets a 400 JSON error, not an HTML stack trace', async () => {
  const agent = await login(request.agent(app));
  const res = await agent.post('/api/tickets')
    .set('Content-Type', 'application/json')
    .send('{"customerName": ');
  assert.equal(res.status, 400);
  assert.match(res.headers['content-type'], /json/);
  assert.deepEqual(res.body, { error: 'Невалидна заявка' });
  assert.doesNotMatch(res.text, /at .*\.js/);
});

test('an oversized request body is rejected cleanly', async () => {
  const agent = await login(request.agent(app));
  const res = await agent.post('/api/tickets').send({ description: 'x'.repeat(200 * 1024) });
  assert.equal(res.status, 413);
  assert.match(res.headers['content-type'], /json/);
});

test('the ticket list and audit lookups use indexes', () => {
  const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail).join(' | ');

  const list = plan('SELECT * FROM tickets ORDER BY date_received DESC, ticket_no DESC');
  assert.match(list, /idx_tickets_date_received/);
  assert.doesNotMatch(list, /TEMP B-TREE/, 'no separate sort step');

  assert.match(plan('SELECT * FROM audit_log WHERE ticket_id = 1 ORDER BY performed_at DESC'), /idx_audit_ticket_id/);
  assert.match(plan('SELECT * FROM audit_log ORDER BY performed_at DESC LIMIT 200'), /idx_audit_performed_at/);
});

// Starts the real server.js with a preload script that throws/rejects
// once the app is running, and checks it logs and exits non-zero so the
// service manager restarts it.
function crashServer(kind) {
  return spawnSync(process.execPath, ['-r', path.join(__dirname, 'fixtures', 'crash-after-start.js'), path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, DATA_ROOT: makeDataRoot(), PORT: '0', CRASH_KIND: kind, SESSION_SECRET: 'x' },
    encoding: 'utf8',
    timeout: 15000
  });
}

test('an uncaught exception is logged with a timestamp and exits with code 1', () => {
  const res = crashServer('exception');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] Uncaught exception — exiting:/m);
  assert.match(res.stderr, /test crash/);
});

test('an unhandled promise rejection is logged and exits with code 1', () => {
  const res = crashServer('rejection');
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /Unhandled promise rejection — exiting:/);
});
