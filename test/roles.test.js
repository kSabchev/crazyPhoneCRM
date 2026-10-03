// Admin and staff accounts: what staff can't do, managing accounts, and
// changing your own password.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { ROOT, loadApp, login, validTicket } = require('./helpers');

const { app, db, dataRoot } = loadApp(); // seeds "tester" (admin)
let admin, staff;

test.before(async () => {
  admin = await login(request.agent(app));
  await admin.post('/api/users').send({ username: 'ivan', password: 'staffpass1', role: 'staff' }).expect(201);
  staff = await login(request.agent(app), 'ivan', 'staffpass1');
});

test('existing accounts are admins; login and /me report the role', async () => {
  assert.equal(db.prepare("SELECT role FROM users WHERE username = 'tester'").get().role, 'admin');
  const res = await request(app).post('/api/auth/login').send({ username: 'ivan', password: 'staffpass1' }).expect(200);
  assert.deepEqual(res.body, { username: 'ivan', role: 'staff' });
  assert.deepEqual((await staff.get('/api/auth/me').expect(200)).body, { username: 'ivan', role: 'staff' });
});

test('staff work with orders as before, including both prices', async () => {
  const t = (await staff.post('/api/tickets').send(validTicket({ servicePrice: '30', customerPrice: '80' })).expect(201)).body;
  assert.equal(t.service_price, 30);
  const edited = (await staff.put(`/api/tickets/${t.id}`).send({ servicePrice: '35', status: 'в сервиз' }).expect(200)).body;
  assert.equal(edited.service_price, 35);
  await staff.get('/api/tickets').expect(200);
  await staff.get('/api/settings').expect(200); // needed for statuses, columns, colours
  await staff.get(`/api/tickets/${t.id}/history`).expect(200);
});

test('staff can\'t delete orders, save settings, see reports or manage accounts', async () => {
  const t = (await staff.post('/api/tickets').send(validTicket()).expect(201)).body;
  const forbidden = [
    () => staff.delete(`/api/tickets/${t.id}`),
    () => staff.put('/api/settings').send({ shopTagline: 'x' }),
    () => staff.get('/api/reports'),
    () => staff.get('/api/users'),
    () => staff.post('/api/users').send({ username: 'hacker', password: 'password1', role: 'admin' }),
    () => staff.put('/api/users/1').send({ role: 'staff' }),
    () => staff.delete('/api/users/1')
  ];
  for (const send of forbidden) {
    const res = await send();
    assert.equal(res.status, 403, `${res.req.method} ${res.req.path}`);
    assert.match(res.body.error, /Само администратор/);
  }
  // The order is still there.
  assert.ok((await admin.get('/api/tickets')).body.some(x => x.id === t.id));
});

test('admins can delete orders, save settings and see reports', async () => {
  const t = (await admin.post('/api/tickets').send(validTicket()).expect(201)).body;
  await admin.delete(`/api/tickets/${t.id}`).expect(200);
  await admin.put('/api/settings').send({ shopTagline: 'нов слоган' }).expect(200);
  await admin.get('/api/reports').expect(200);
});

test('admins list, add and validate accounts', async () => {
  const list = (await admin.get('/api/users').expect(200)).body;
  assert.deepEqual(list.map(u => [u.username, u.role]), [['ivan', 'staff'], ['tester', 'admin']]);
  assert.equal('password_hash' in list[0], false);

  await admin.post('/api/users').send({ username: 'Мария.П', password: 'longenough', role: 'admin' }).expect(201);
  const cases = [
    [{ username: 'ivan', password: 'longenough', role: 'staff' }, 409, /вече съществува/],
    [{ username: 'ab', password: 'longenough', role: 'staff' }, 400, /3–40 знака/],
    [{ username: 'has space', password: 'longenough', role: 'staff' }, 400, /3–40 знака/],
    [{ username: 'petar', password: 'short', role: 'staff' }, 400, /поне 8 знака/],
    [{ username: 'petar', password: 'longenough', role: 'owner' }, 400, /Невалидна роля/]
  ];
  for (const [body, status, pattern] of cases) {
    const res = await admin.post('/api/users').send(body).expect(status);
    assert.match(res.body.error, pattern);
  }
});

test('a role change applies immediately, even to an open session', async () => {
  const id = db.prepare("SELECT id FROM users WHERE username = 'ivan'").get().id;
  await admin.put(`/api/users/${id}`).send({ role: 'admin' }).expect(200);
  await staff.get('/api/reports').expect(200);
  await admin.put(`/api/users/${id}`).send({ role: 'staff' }).expect(200);
  await staff.get('/api/reports').expect(403);
});

test('an admin can set a new password for someone', async () => {
  const id = db.prepare("SELECT id FROM users WHERE username = 'ivan'").get().id;
  await admin.put(`/api/users/${id}`).send({ password: 'short' }).expect(400);
  await admin.put(`/api/users/${id}`).send({ password: 'brandnewpass' }).expect(200);
  await request(app).post('/api/auth/login').send({ username: 'ivan', password: 'staffpass1' }).expect(401);
  staff = await login(request.agent(app), 'ivan', 'brandnewpass');
});

test('an admin can\'t demote or remove themselves, and one admin always remains', async () => {
  const me = db.prepare("SELECT id FROM users WHERE username = 'tester'").get().id;
  let res = await admin.put(`/api/users/${me}`).send({ role: 'staff' }).expect(400);
  assert.match(res.body.error, /собствените си администраторски права/);
  res = await admin.delete(`/api/users/${me}`).expect(400);
  assert.match(res.body.error, /собствения си профил/);

  // With "Мария.П" as the only other admin, she can be demoted once —
  // after that "tester" is the last admin and is protected anyway.
  const maria = db.prepare("SELECT id FROM users WHERE username = 'Мария.П'").get().id;
  await admin.put(`/api/users/${maria}`).send({ role: 'staff' }).expect(200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n, 1);
});

test('admins can demote each other, and the remaining one still can\'t demote themselves', async () => {
  // Make a second admin, demote the first through them... down to one.
  await admin.post('/api/users').send({ username: 'boss2', password: 'longenough', role: 'admin' }).expect(201);
  const boss2 = await login(request.agent(app), 'boss2', 'longenough');
  const tester = db.prepare("SELECT id FROM users WHERE username = 'tester'").get().id;
  await boss2.put(`/api/users/${tester}`).send({ role: 'staff' }).expect(200);
  // boss2 is now the only admin: can't demote/remove itself, nobody else can act.
  const me = db.prepare("SELECT id FROM users WHERE username = 'boss2'").get().id;
  await boss2.put(`/api/users/${me}`).send({ role: 'staff' }).expect(400);
  // Restore tester as admin for the remaining tests.
  await boss2.put(`/api/users/${tester}`).send({ role: 'admin' }).expect(200);
  await admin.get('/api/users').expect(200);
});

test('a removed account is logged out on its next request', async () => {
  await admin.post('/api/users').send({ username: 'temp', password: 'longenough', role: 'staff' }).expect(201);
  const temp = await login(request.agent(app), 'temp', 'longenough');
  await temp.get('/api/tickets').expect(200);
  const id = db.prepare("SELECT id FROM users WHERE username = 'temp'").get().id;
  await admin.delete(`/api/users/${id}`).expect(200);
  await temp.get('/api/tickets').expect(401);
  await request(app).post('/api/auth/login').send({ username: 'temp', password: 'longenough' }).expect(401);
});

test('anyone can change their own password, with the current one', async () => {
  let res = await staff.post('/api/auth/password').send({ currentPassword: 'wrong', newPassword: 'anothergood1' }).expect(400);
  assert.match(res.body.error, /Текущата парола е грешна/);
  res = await staff.post('/api/auth/password').send({ currentPassword: 'brandnewpass', newPassword: 'short' }).expect(400);
  assert.match(res.body.error, /поне 8 знака/);
  await staff.post('/api/auth/password').send({ currentPassword: 'brandnewpass', newPassword: 'anothergood1' }).expect(200);
  await request(app).post('/api/auth/login').send({ username: 'ivan', password: 'brandnewpass' }).expect(401);
  await request(app).post('/api/auth/login').send({ username: 'ivan', password: 'anothergood1' }).expect(200);
});

test('account routes need a login', async () => {
  await request(app).get('/api/users').expect(401);
  await request(app).post('/api/auth/password').send({}).expect(401);
});

test('create-admin.js makes admins by default, staff with --staff, and keeps roles on reset', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'create-admin.js'), ...args], {
    cwd: ROOT, env: { ...process.env, DATA_ROOT: dataRoot }, encoding: 'utf8'
  });
  assert.match(run('cli-admin', 'password1').stdout, /created \(admin\)/);
  assert.match(run('cli-staff', 'password1', '--staff').stdout, /created \(staff\)/);
  assert.match(run('cli-staff', 'password2').stdout, /updated .*\(staff\)/);
  assert.match(run('cli-staff', 'password2', '--admin').stdout, /updated .*\(admin\)/);
  assert.equal(run('x', 'password1', '--owner').status, 1);
  const roles = Object.fromEntries(db.prepare("SELECT username, role FROM users WHERE username LIKE 'cli-%'").all().map(r => [r.username, r.role]));
  assert.deepEqual(roles, { 'cli-admin': 'admin', 'cli-staff': 'admin' });
});
