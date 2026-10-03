// Demo mode (DEMO_MODE=true), for a public demo such as the Render
// deployment: every start wipes the database and fills it with fake but
// realistic orders, so visitors can try everything and nothing they do
// lasts past the next restart. Never contains real customer data.
//
// Safety: it refuses to touch a database that holds orders it didn't
// create itself, so setting DEMO_MODE by mistake on the shop PC can't
// wipe real data.
const bcrypt = require('bcrypt');
const DEFAULT_SETTINGS = require('./default-settings');
const { FOR_SERVICE, IN_SERVICE, WAITING, COMPLETED, REFUSED, FORGOTTEN, CLOSED } = require('./public/statuses');

// Shown on the login screen in demo mode. Two accounts — an admin and a
// staff member, to show both views — so the live
// updates and "who's viewing" indicator can be tried in two browsers.
const DEMO_USERS = [
  { username: 'demo', password: 'demo1234', role: 'admin' },
  { username: 'demo2', password: 'demo1234', role: 'staff' }
];

const FIRST = ['Иван', 'Мария', 'Георги', 'Елена', 'Николай', 'Петя', 'Димитър', 'Десислава', 'Стоян', 'Виктория', 'Христо', 'Надежда'];
const LAST_M = ['Петров', 'Иванов', 'Георгиев', 'Димитров', 'Стоянов', 'Николов', 'Колев', 'Тодоров'];
const LAST_F = ['Петрова', 'Иванова', 'Георгиева', 'Димитрова', 'Стоянова', 'Николова', 'Колева', 'Тодорова'];
const MODELS = ['iPhone 13', 'iPhone 14 Pro', 'iPhone 15', 'iPhone 12', 'Samsung Galaxy S23', 'Samsung Galaxy A54', 'Samsung Galaxy S24 Ultra', 'Xiaomi Redmi Note 12', 'Xiaomi 13T', 'Google Pixel 8', 'Huawei P60', 'OnePlus 12'];
const REPAIRS = [
  ['Счупен дисплей', 'Сменен дисплей', 120, 55],
  ['Не зарежда', 'Почистена букса, сменен порт за зареждане', 60, 15],
  ['Батерията се изтощава бързо', 'Сменена батерия', 70, 25],
  ['Счупен заден капак', 'Сменен заден капак', 50, 18],
  ['Не се чува при разговор', 'Сменен слушалка', 55, 14],
  ['Паднал във вода', 'Почистване след вода, сменен дисплей', 150, 70],
  ['Камерата не фокусира', 'Сменена основна камера', 90, 40],
  ['Не се включва', 'Ремонт на платка', 110, 30]
];
const COMMENTS = ['', '', '', 'Клиентът ще дойде в петък', 'Да се обади преди ремонта', 'Бърза поръчка', 'Пази кутията'];
const PASSWORDS = [null, null, '1234', '0000', 'L-шаблон', '2580', 'Z-шаблон'];

// Small fixed-seed generator: the same demo data on every start.
function makeRandom(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const isoDate = d => d.toISOString().slice(0, 10);
const atTime = (d, hour) => `${isoDate(d)} ${String(hour).padStart(2, '0')}:15:00`;
const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

function prepareDemo(db, { now = new Date(), count = 180 } = {}) {
  const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  const isDemoDb = settingsRow && JSON.parse(settingsRow.data).demoData === true;
  const hasTickets = db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n > 0;
  if (hasTickets && !isDemoDb) {
    throw new Error(
      'DEMO_MODE is set, but this database contains real orders (not created by demo mode). ' +
      'Refusing to wipe it. Unset DEMO_MODE, or point DATA_ROOT at an empty folder for the demo.'
    );
  }

  const rnd = makeRandom(20260930);
  const pick = list => list[Math.floor(rnd() * list.length)];

  db.transaction(() => {
    db.exec('DELETE FROM audit_log; DELETE FROM tickets; DELETE FROM users;');
    try { db.exec('DELETE FROM sessions'); } catch (_) { /* store not created yet */ }

    db.prepare('UPDATE settings SET data = ?, updated_at = datetime(\'now\') WHERE id = 1')
      .run(JSON.stringify({ ...DEFAULT_SETTINGS, demoData: true }));

    const addUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
    for (const u of DEMO_USERS) addUser.run(u.username, bcrypt.hashSync(u.password, 10), u.role);

    const insert = db.prepare(`
      INSERT INTO tickets (ticket_no, customer_name, phone_contact, date_received, date_returned, phone_model,
        status, description, comment, repair_performed, loaner_phone, phone_password, pravim, kaparo,
        service_price, customer_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const audit = db.prepare(`
      INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by, performed_at)
      VALUES (?, ?, ?, ?, ?, ?)`);

    const start = addDays(now, -365);
    for (let no = 1; no <= count; no++) {
      const female = rnd() < 0.5;
      const name = `${pick(FIRST.filter((_, i) => (i % 2 === 1) === female))} ${pick(female ? LAST_F : LAST_M)}`;
      // A few numbers in a nonstandard format, to show the warning.
      const phone = rnd() < 0.06
        ? `0888 ${Math.floor(rnd() * 900 + 100)} ${Math.floor(rnd() * 90 + 10)}`
        : `08${pick(['7', '8', '9'])}${Math.floor(rnd() * 10)} ${Math.floor(rnd() * 900 + 100)} ${Math.floor(rnd() * 900 + 100)}`;
      const [issue, repair, price, cost] = pick(REPAIRS);
      const received = addDays(start, Math.floor((no / count) * 360));
      const daysIn = 1 + Math.floor(rnd() * 3);
      const daysRepair = 1 + Math.floor(rnd() * 5);
      const daysWaiting = Math.floor(rnd() * 7);
      const returned = addDays(received, daysIn + daysRepair + daysWaiting);

      // The newest orders are still in progress, at different stages.
      let status = COMPLETED;
      if (returned > now) status = addDays(received, daysIn + daysRepair) > now
        ? (addDays(received, daysIn) > now ? FOR_SERVICE : IN_SERVICE)
        : WAITING;
      // A few finished orders were refused (handed back unrepaired) or never
      // collected.
      if (status === COMPLETED) {
        const r = rnd();
        if (r < 0.05) status = REFUSED;
        else if (r < 0.09) status = FORGOTTEN;
      }
      const done = status === COMPLETED;
      const closed = CLOSED.includes(status);
      const deposit = !closed && rnd() < 0.4 ? 20 : 'Не';

      const by = rnd() < 0.5 ? 'demo' : 'demo2';
      const id = insert.run(
        no, name, phone, isoDate(received), done || status === REFUSED ? isoDate(returned) : null, pick(MODELS),
        status, issue, pick(COMMENTS),
        status === FOR_SERVICE || status === REFUSED ? '' : repair,
        rnd() < 0.15 ? 'да' : 'не',
        pick(PASSWORDS),
        closed ? 'tick' : pick(['circle', 'circle', 'tick']),
        deposit,
        status === FOR_SERVICE || status === REFUSED ? null : cost + Math.round(rnd() * 10),
        done && rnd() > 0.05 ? price + Math.round(rnd() * 20) : null
      ).lastInsertRowid;

      // Status history, so reports can show time spent in each status.
      audit.run(id, no, 'created', JSON.stringify({ customer_name: name, status: FOR_SERVICE, phone_password_set: false }), by, atTime(received, 10));
      const steps = [
        [FOR_SERVICE, IN_SERVICE, addDays(received, daysIn)],
        [IN_SERVICE, WAITING, addDays(received, daysIn + daysRepair)],
        [WAITING, closed ? status : COMPLETED, returned]
      ];
      for (const [from, to, at] of steps) {
        if (at > now) break;
        audit.run(id, no, 'updated', JSON.stringify({ status: { from, to } }), by, atTime(at, 12 + Math.floor(rnd() * 6)));
      }
    }
  })();

  console.log(`Demo mode: database reset with ${count} demo orders. Logins: ${DEMO_USERS.map(u => `${u.username} / ${u.password}`).join(', ')}`);
}

module.exports = { prepareDemo, DEMO_USERS };
