// Moving an order to "отказан" (repair refused) sets Капаро, Изкупна цена
// and Продажна цена to 0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

async function create(fields = {}) {
  return (await agent.post('/api/tickets').send(validTicket(fields)).expect(201)).body;
}

const amounts = t => ({ kaparo: t.kaparo, service_price: t.service_price, customer_price: t.customer_price });

test('changing the status to отказан sets the deposit and both prices to 0', async () => {
  const t = await create({ kaparo: '20', servicePrice: '35', customerPrice: '90' });
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'отказан' }).expect(200);
  assert.deepEqual(amounts(res.body), { kaparo: 0, service_price: 0, customer_price: 0 });
});

test('it also applies when there was no deposit or price yet', async () => {
  const t = await create();
  assert.equal(t.kaparo, 'Не');
  const res = await agent.put(`/api/tickets/${t.id}`).send({ status: 'отказан' }).expect(200);
  assert.deepEqual(amounts(res.body), { kaparo: 0, service_price: 0, customer_price: 0 });
});

test('the full order form sending amounts together with отказан still gets 0', async () => {
  const t = await create({ kaparo: '20', customerPrice: '90' });
  const res = await agent.put(`/api/tickets/${t.id}`)
    .send({ ...validTicket(), status: 'отказан', kaparo: '20', servicePrice: '35', customerPrice: '90', loanerPhone: 'не' })
    .expect(200);
  assert.deepEqual(amounts(res.body), { kaparo: 0, service_price: 0, customer_price: 0 });
});

test('the change is recorded in the history', async () => {
  const t = await create({ kaparo: '20', customerPrice: '90' });
  await agent.put(`/api/tickets/${t.id}`).send({ status: 'отказан' }).expect(200);
  const update = (await agent.get(`/api/tickets/${t.id}/history`)).body.find(e => e.action === 'updated');
  assert.deepEqual(update.changes.status, { from: 'за сервиз', to: 'отказан' });
  // The history records the order as saved: Капаро is stored as a number.
  assert.deepEqual(update.changes.kaparo, { from: 20, to: 0 });
  assert.deepEqual(update.changes.customer_price, { from: 90, to: 0 });
  assert.deepEqual(update.changes.service_price, { from: null, to: 0 });
});

test('once refused, amounts can still be changed (e.g. a diagnostic fee)', async () => {
  const t = await create({ customerPrice: '90' });
  await agent.put(`/api/tickets/${t.id}`).send({ status: 'отказан' }).expect(200);
  const res = await agent.put(`/api/tickets/${t.id}`).send({ customerPrice: '15', comment: 'диагностика' }).expect(200);
  assert.equal(res.body.customer_price, 15);
  assert.equal(res.body.status, 'отказан');
});

test('other status changes leave the amounts alone', async () => {
  const t = await create({ kaparo: '20', servicePrice: '35', customerPrice: '90' });
  for (const status of ['в сервиз', 'чака клиент', 'издаден', 'забравен']) {
    const res = await agent.put(`/api/tickets/${t.id}`).send({ status }).expect(200);
    assert.deepEqual(amounts(res.body), { kaparo: 20, service_price: 35, customer_price: 90 }, status);
  }
});

test('an order created as отказан gets 0 amounts', async () => {
  const t = await create({ status: 'отказан', kaparo: '20', customerPrice: '90' });
  assert.deepEqual(amounts(t), { kaparo: 0, service_price: 0, customer_price: 0 });
});
