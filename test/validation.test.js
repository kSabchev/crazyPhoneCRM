const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

async function expectRejected(body, pattern) {
  const res = await agent.post('/api/tickets').send(validTicket(body));
  assert.equal(res.status, 400, JSON.stringify(body));
  if (pattern) assert.match(res.body.error, pattern);
}

test('a missing required field is named in the error', async () => {
  await expectRejected({ phoneModel: undefined }, /Модел на телефона/);
  await expectRejected({ customerName: '   ' }, /Име на клиента/);
});

test('text over the length limit is rejected', async () => {
  await expectRejected({ description: 'x'.repeat(5001) }, /Описание на проблема е твърде дълго/);
  await expectRejected({ customerName: 'x'.repeat(201) }, /Име на клиента/);
  await expectRejected({ phoneContact: '0'.repeat(51) }, /Телефон/);
});

test('text at the length limit is accepted', async () => {
  await agent.post('/api/tickets').send(validTicket({ description: 'x'.repeat(5000) })).expect(201);
});

test('non-string text is rejected instead of crashing', async () => {
  await expectRejected({ customerName: { a: 1 } }, /невалидна стойност/);
  await expectRejected({ loanerPhone: 42 }, /Оборотен телефон/);
});

test('dates must be real YYYY-MM-DD dates', async () => {
  await expectRejected({ dateReceived: 'вчера' }, /Дата на приемане: невалидна дата/);
  await expectRejected({ dateReceived: '2026-02-30' }, /невалидна дата/);
  await expectRejected({ dateReceived: '01.09.2026' }, /невалидна дата/);
  await expectRejected({ dateReturned: '2026-13-01' }, /Дата на връщане/);
  await agent.post('/api/tickets').send(validTicket({ dateReceived: '2028-02-29' })).expect(201);
});

test('prices must be non-negative numbers; empty means no price', async () => {
  await expectRejected({ servicePrice: '-5' }, /Изкупна цена: невалидна сума/);
  await expectRejected({ customerPrice: 'abc' }, /Продажна цена/);
  await expectRejected({ customerPrice: 'Infinity' }, /Продажна цена/);
  const ok = await agent.post('/api/tickets')
    .send(validTicket({ servicePrice: '', customerPrice: 0 }))
    .expect(201);
  assert.equal(ok.body.service_price, null);
  assert.equal(ok.body.customer_price, 0);
});

test('kaparo accepts a number or text', async () => {
  const res = await agent.post('/api/tickets').send(validTicket({ kaparo: 50 })).expect(201);
  assert.equal(res.body.kaparo, 50);
});

test('an edit cannot blank out a required field', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket())).body;
  for (const field of ['customerName', 'phoneContact', 'phoneModel', 'dateReceived', 'description']) {
    const res = await agent.put(`/api/tickets/${t.id}`).send({ [field]: '' });
    assert.equal(res.status, 400, field);
  }
  const after = (await agent.get('/api/tickets')).body.find(r => r.id === t.id);
  assert.equal(after.date_received, t.date_received);
});

test('an edit validates only the fields it sends', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.put(`/api/tickets/${t.id}`).send({ pravim: 'tick' }).expect(200);
  await agent.put(`/api/tickets/${t.id}`).send({ dateReturned: 'скоро' }).expect(400);
  await agent.put(`/api/tickets/${t.id}`).send({ dateReturned: '2026-09-10' }).expect(200);
});

test('an edit with null loaner phone / kaparo resets them to "Не"', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket({ loanerPhone: 'Nokia', kaparo: '20' }))).body;
  const res = await agent.put(`/api/tickets/${t.id}`).send({ loanerPhone: null, kaparo: null }).expect(200);
  assert.equal(res.body.loaner_phone, 'Не');
  assert.equal(res.body.kaparo, 'Не');
});

test('a full edit exactly as the ticket form sends it is accepted', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket())).body;
  await agent.put(`/api/tickets/${t.id}`).send({
    customerName: 'Иван Петров',
    phoneContact: '0888123456',
    dateReceived: '2026-09-01',
    dateReturned: '',
    phoneModel: 'iPhone 15',
    status: 'в сервиз',
    servicePrice: '',
    customerPrice: '120',
    kaparo: '',
    description: 'Счупен дисплей',
    comment: '',
    repairPerformed: 'Сменен дисплей',
    loanerPhone: '',
    pravim: 'tick'
  }).expect(200);
});
