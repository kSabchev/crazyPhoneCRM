const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const Database = require('better-sqlite3');
const { ROOT, loadApp, login, makeDataRoot } = require('./helpers');
const { prepareDemo, DEMO_USERS } = require('../demo');

const { app, db } = loadApp();
const count = sql => db.prepare(sql).get().n;

test('demo mode refuses to wipe a database with real orders', () => {
  db.prepare(`INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description)
    VALUES (1, 'Истински клиент', '0888', '2026-01-01', 'iPhone', 'x')`).run();
  assert.throws(() => prepareDemo(db), /contains real orders/);
  assert.equal(count('SELECT COUNT(*) n FROM tickets'), 1);
  db.exec('DELETE FROM tickets');
});

test('demo mode fills the database with realistic fake orders and demo logins', async () => {
  prepareDemo(db, { now: new Date('2026-09-30T12:00:00Z') });

  assert.equal(count('SELECT COUNT(*) n FROM tickets'), 180);
  assert.ok(count("SELECT COUNT(*) n FROM tickets WHERE status != 'издаден'") > 0, 'some orders still open');
  assert.ok(count("SELECT COUNT(*) n FROM tickets WHERE status = 'издаден' AND customer_price IS NOT NULL") > 100);
  assert.ok(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'updated'") > 300, 'status history for reports');
  assert.ok(count("SELECT COUNT(*) n FROM tickets WHERE phone_password IS NOT NULL") > 0);
  assert.deepEqual(db.prepare('SELECT username FROM users ORDER BY username').all().map(u => u.username), ['demo', 'demo2']);

  for (const u of DEMO_USERS) {
    await login(request.agent(app), u.username, u.password);
  }
  const agent = await login(request.agent(app), 'demo', 'demo1234');
  const report = (await agent.get('/api/reports?from=2025-10-01&to=2026-09-30').expect(200)).body;
  assert.ok(report.revenue.totals.revenue > 0);
  assert.ok(report.statusTime.length >= 3);
});

test('restarting demo mode throws away visitors\' changes', async () => {
  const agent = await login(request.agent(app), 'demo', 'demo1234');
  await agent.post('/api/tickets').send({
    customerName: 'Посетител', phoneContact: '0888123456', phoneModel: 'X', dateReceived: '2026-09-30', description: 'd'
  }).expect(201);
  await agent.put('/api/settings').send({ shopName: 'Променено' }).expect(200);

  prepareDemo(db);
  assert.equal(count('SELECT COUNT(*) n FROM tickets'), 180);
  assert.equal(count("SELECT COUNT(*) n FROM tickets WHERE customer_name = 'Посетител'"), 0);
  const settings = JSON.parse(db.prepare('SELECT data FROM settings').get().data);
  assert.equal(settings.shopName, 'CrazyPhone');
  assert.equal(settings.demoData, true);
  // Visitors are logged out along with everything else.
  await agent.get('/api/tickets').expect(401);
});

test('/api/demo reveals the demo logins only in demo mode', async () => {
  delete process.env.DEMO_MODE;
  assert.deepEqual((await request(app).get('/api/demo').expect(200)).body, { demo: false });

  process.env.DEMO_MODE = 'true';
  try {
    const res = await request(app).get('/api/demo').expect(200);
    assert.deepEqual(res.body, { demo: true, users: DEMO_USERS });
  } finally {
    delete process.env.DEMO_MODE;
  }
});

function startServer(dataRoot) {
  return spawnSync(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, DATA_ROOT: dataRoot, DEMO_MODE: 'true', PORT: '0', SESSION_SECRET: 'x' },
    encoding: 'utf8',
    timeout: 8000
  });
}

test('server.js in demo mode resets the data and starts', () => {
  const res = startServer(makeDataRoot()); // killed by the timeout once running
  assert.match(res.stdout, /Demo mode: database reset with 180 demo orders/);
  assert.match(res.stdout, /Repair log running/);
});

test('server.js in demo mode exits instead of wiping a real database', () => {
  const dataRoot = makeDataRoot();
  fs.mkdirSync(path.join(dataRoot, 'data'));
  const real = new Database(path.join(dataRoot, 'data', 'repair-log.db'));
  real.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no INTEGER UNIQUE NOT NULL,
    customer_name TEXT NOT NULL, phone_contact TEXT NOT NULL, date_received TEXT NOT NULL, phone_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'за сервиз', description TEXT NOT NULL);
    INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, phone_model, description)
    VALUES (1, 'Истински', '0888', '2026-01-01', 'iPhone', 'x');`);
  real.close();

  const res = startServer(dataRoot);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Refusing to wipe it/);
  const after = new Database(path.join(dataRoot, 'data', 'repair-log.db'), { readonly: true });
  assert.equal(after.prepare('SELECT COUNT(*) n FROM tickets').get().n, 1);
  after.close();
});
