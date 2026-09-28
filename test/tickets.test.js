const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

test('creating a ticket assigns sequential numbers and applies defaults', async () => {
  const first = await agent.post('/api/tickets').send(validTicket()).expect(201);
  const second = await agent.post('/api/tickets').send(validTicket({ customerName: 'Мария' })).expect(201);

  assert.equal(second.body.ticket_no, first.body.ticket_no + 1);
  assert.equal(first.body.status, 'за сервиз');
  assert.equal(first.body.pravim, 'circle');
  assert.equal(first.body.kaparo, 'Не');
  assert.equal(first.body.loaner_phone, 'Не');
  assert.equal(first.body.service_price, null);
  assert.equal(first.body.customer_price, null);
  assert.equal(first.body.date_returned, null);
});

test('creating a ticket requires all mandatory fields', async () => {
  for (const field of ['customerName', 'phoneContact', 'phoneModel', 'dateReceived', 'description']) {
    const res = await agent.post('/api/tickets').send(validTicket({ [field]: '' }));
    assert.equal(res.status, 400, `missing ${field}`);
  }
});

test('an invalid pravim value falls back to circle; prices are stored as numbers', async () => {
  const res = await agent.post('/api/tickets')
    .send(validTicket({ pravim: 'bogus', servicePrice: '40', customerPrice: '85.5', kaparo: ' 20 ' }))
    .expect(201);
  assert.equal(res.body.pravim, 'circle');
  assert.equal(res.body.service_price, 40);
  assert.equal(res.body.customer_price, 85.5);
  // kaparo is a REAL column, so SQLite stores a numeric deposit as a number
  // while the "Не" (no deposit) default stays text.
  assert.equal(res.body.kaparo, 20);
});

test('the ticket list is sorted newest-received first', async () => {
  await agent.post('/api/tickets').send(validTicket({ dateReceived: '2020-01-01', customerName: 'Стар' }));
  await agent.post('/api/tickets').send(validTicket({ dateReceived: '2030-01-01', customerName: 'Нов' }));
  const list = (await agent.get('/api/tickets').expect(200)).body;
  assert.equal(list[0].customer_name, 'Нов');
  assert.equal(list[list.length - 1].customer_name, 'Стар');
});

test('updating a ticket changes only the fields sent', async () => {
  const created = (await agent.post('/api/tickets')
    .send(validTicket({ servicePrice: 30, comment: 'пази кутията' }))).body;

  const updated = (await agent.put(`/api/tickets/${created.id}`)
    .send({ status: 'в сервиз', pravim: 'tick' })
    .expect(200)).body;

  assert.equal(updated.status, 'в сервиз');
  assert.equal(updated.pravim, 'tick');
  assert.equal(updated.customer_name, created.customer_name);
  assert.equal(updated.comment, 'пази кутията');
  assert.equal(updated.service_price, 30);
});

test('update can clear prices and the return date', async () => {
  const created = (await agent.post('/api/tickets')
    .send(validTicket({ servicePrice: 30, dateReturned: '2026-09-05' }))).body;
  const updated = (await agent.put(`/api/tickets/${created.id}`)
    .send({ servicePrice: '', dateReturned: '' })
    .expect(200)).body;
  assert.equal(updated.service_price, null);
  assert.equal(updated.date_returned, null);
});

test('update rejects an empty description and unknown ids', async () => {
  const created = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.put(`/api/tickets/${created.id}`).send({ description: '' }).expect(400);
  await agent.put('/api/tickets/999999').send({ status: 'в сервиз' }).expect(404);
});

test('deleting a ticket removes it; unknown ids return 404', async () => {
  const created = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.delete(`/api/tickets/${created.id}`).expect(200);
  const list = (await agent.get('/api/tickets')).body;
  assert.ok(!list.some(t => t.id === created.id));
  await agent.delete(`/api/tickets/${created.id}`).expect(404);
});

test('devices list merges settings with models used on tickets, case-insensitively', async () => {
  await agent.post('/api/tickets').send(validTicket({ phoneModel: 'Nokia 3310' }));
  await agent.post('/api/tickets').send(validTicket({ phoneModel: 'iphone 15' }));
  const devices = (await agent.get('/api/devices').expect(200)).body;
  assert.ok(devices.includes('Nokia 3310'));
  assert.equal(devices.filter(d => d.toLowerCase() === 'iphone 15').length, 1);
});
