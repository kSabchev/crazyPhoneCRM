const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadApp, login, validTicket } = require('./helpers');
const { readZip } = require('../lbx');

const { app } = loadApp();
let agent;

test.before(async () => {
  agent = await login(request.agent(app));
});

// The downloaded file must still be a valid .lbx: the same files as the
// template, with label.xml filled in.
async function fetchLabel(id) {
  const res = await agent.get(`/api/tickets/${id}/service-label.lbx`)
    .buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const entries = readZip(res.body);
  assert.deepEqual(entries.map(e => e.name), ['label.xml', 'prop.xml']);
  return { res, xml: entries[0].data.toString('utf8') };
}

// Each text box's run lengths must add up to its text, or P-touch Editor
// mis-renders it.
function assertRunLengthsMatch(xml) {
  for (const block of xml.match(/<text:text>[\s\S]*?<\/text:text>/g)) {
    const text = block.match(/<pt:data>([\s\S]*?)<\/pt:data>/)[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const total = [...block.matchAll(/charLen="(\d+)"/g)].reduce((n, m) => n + Number(m[1]), 0);
    assert.equal(total, text.length, `run lengths for "${text}"`);
  }
}

test('the service label is the template filled with the ticket', async () => {
  const t = (await agent.post('/api/tickets')
    .send(validTicket({ description: 'Смяна на батерия & <дисплей>', phonePassword: '1234' }))
    .expect(201)).body;
  const { res, xml } = await fetchLabel(t.id);

  assert.match(res.headers['content-disposition'], new RegExp(`attachment; filename="poruchka-${t.ticket_no}\\.lbx"`));
  assert.ok(xml.includes(`<pt:data>№ ${t.ticket_no}</pt:data>`));
  assert.ok(xml.includes('<pt:data>Смяна на батерия &amp; &lt;дисплей&gt;</pt:data>'));
  assert.ok(xml.includes('<pt:data>Парола: 1234</pt:data>'));
  assert.doesNotMatch(xml, /<pt:data>\{/);
  // The layout itself (roll, printer) is untouched.
  assert.ok(xml.includes('printerName="Brother QL-600"'));
  assertRunLengthsMatch(xml);
});

test('without an unlock code the password text box is left out', async () => {
  const t = (await agent.post('/api/tickets').send(validTicket()).expect(201)).body;
  const withCode = (await agent.post('/api/tickets').send(validTicket({ phonePassword: '1234' })).expect(201)).body;
  const { xml } = await fetchLabel(t.id);
  const textBoxes = (await fetchLabel(withCode.id)).xml.match(/<text:text>/g).length;
  assert.equal(xml.match(/<text:text>/g).length, textBoxes - 1);
  assert.doesNotMatch(xml, /Парола|pasword/i);
  assertRunLengthsMatch(xml);
});

test('a multi-line description is printed on one line', async () => {
  const t = (await agent.post('/api/tickets')
    .send(validTicket({ description: 'Не зарежда\r\nСчупен дисплей' }))
    .expect(201)).body;
  const { xml } = await fetchLabel(t.id);
  assert.ok(xml.includes('<pt:data>Не зарежда Счупен дисплей</pt:data>'));
});

test('{model} and {customer} text boxes get the phone model and the customer\'s name', () => {
  const { fillLabelXml } = require('../lbx');
  // Text boxes as P-touch Editor saves them: the text split into runs.
  const box = text => `<text:text><pt:data>${text}</pt:data>` +
    `<text:stringItem charLen="3"><ts:stringItem/></text:stringItem>` +
    `<text:stringItem charLen="${text.length - 3}"><ts:stringItem/></text:stringItem></text:text>`;
  const xml = fillLabelXml(box('{model}') + box('{Customer}') + box('{model}'), {
    model: 'Samsung Galaxy S24', customer: 'Иван Петров'
  });
  assert.equal((xml.match(/<pt:data>Samsung Galaxy S24<\/pt:data>/g) || []).length, 2, 'every box with it');
  assert.ok(xml.includes('<pt:data>Иван Петров</pt:data>'));
  assertRunLengthsMatch(xml);
});

test('the label\'s values come from the order: model and customer each on one line', () => {
  const { placeholderValues } = require('../lbx');
  const v = placeholderValues({ ticket_no: 7, phone_model: 'iPhone 15\r\nPro', customer_name: ' Мария Иванова ', description: 'x' }, 'CrazyPhone');
  assert.equal(v.model, 'iPhone 15 Pro');
  assert.equal(v.customer, 'Мария Иванова');
  assert.equal(v.order, '№ 7');
});

test('an unknown ticket gives 404 and the label needs a login', async () => {
  await agent.get('/api/tickets/999999/service-label.lbx').expect(404);
  await request(app).get('/api/tickets/1/service-label.lbx').expect(401);
});
