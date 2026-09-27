require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.warn(
    'Warning: SESSION_SECRET is not set in .env — using a temporary secret. ' +
    'Set SESSION_SECRET in .env before running this in production.'
  );
}

app.use(express.json());
app.use(
  session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
    secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000, // 8 hour login session
      sameSite: 'lax'
      // secure: true  <- enable this once the app is served over HTTPS
    }
  })
);

// ---- Auth helpers ----
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Не сте влезли в системата' });
}

// ---- Live update stream (Server-Sent Events) ----
// Lets every open browser tab know the moment ticket/settings data changes
// elsewhere, so they can refresh automatically instead of needing a manual
// page reload. One-way (server -> browser) push over a plain HTTP
// connection the browser keeps open and auto-reconnects if it drops.
const sseClients = new Set();

function broadcastChange(type) {
  const payload = `data: ${type}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // in case this ever sits behind nginx — disables response buffering for SSE
  });
  res.write(':ok\n\n'); // opening comment, confirms the stream is live

  sseClients.add(res);

  // Heartbeat comment every 30s so the connection isn't dropped as idle by
  // any proxy in between, and so a dead client gets cleaned up promptly.
  const heartbeat = setInterval(() => res.write(':heartbeat\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---- "Currently being worked on" presence ----
// Purely a live, in-the-moment indicator — not a hard lock, and not stored
// in the database. If someone has a ticket open, other staff see who; it
// never prevents anyone from also opening or saving it. Entries expire on
// their own after a while in case a tab was closed without a clean
// "stopped editing" signal (e.g. the browser crashed).
const editingNow = new Map(); // ticketId (string) -> { username, startedAt }
const EDITING_STALE_MS = 10 * 60 * 1000; // 10 minutes

function getEditingBy(ticketId) {
  const entry = editingNow.get(String(ticketId));
  if (!entry) return null;
  if (Date.now() - entry.startedAt > EDITING_STALE_MS) {
    editingNow.delete(String(ticketId));
    return null;
  }
  return entry.username;
}

app.post('/api/tickets/:id/editing/start', requireAuth, (req, res) => {
  editingNow.set(String(req.params.id), { username: req.session.username, startedAt: Date.now() });
  broadcastChange('tickets');
  res.json({ ok: true });
});

app.post('/api/tickets/:id/editing/stop', requireAuth, (req, res) => {
  const entry = editingNow.get(String(req.params.id));
  // Only clear if it's actually this user's own marker, so one person
  // closing their modal can't wipe someone else's active indicator.
  if (entry && entry.username === req.session.username) {
    editingNow.delete(String(req.params.id));
    broadcastChange('tickets');
  }
  res.json({ ok: true });
});

// ---- Auth routes ----
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Потребителското име и паролата са задължителни' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Невалидно потребителско име или парола' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ username: req.session.username });
  }
  res.status(401).json({ error: 'Не сте влезли в системата' });
});

// ---- Settings routes ----
const COLUMN_KEYS = ['customer', 'callBtn', 'model', 'issue', 'comment', 'repairPerformed', 'loanerPhone', 'pravim', 'status', 'kaparo', 'dateIn', 'dateReturned', 'servicePrice', 'customerPrice'];

function getSettings() {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  return JSON.parse(row.data);
}

app.get('/api/settings', requireAuth, (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireAuth, (req, res) => {
  const current = getSettings();
  const body = req.body || {};
  const next = { ...current };

  if (body.shopName !== undefined) {
    if (typeof body.shopName !== 'string' || !body.shopName.trim()) {
      return res.status(400).json({ error: 'Името на сервиза не може да бъде празно' });
    }
    next.shopName = body.shopName.trim();
  }

  if (body.shopTagline !== undefined) {
    next.shopTagline = typeof body.shopTagline === 'string' ? body.shopTagline.trim() : current.shopTagline;
  }

  if (body.statuses !== undefined) {
    const statuses = (body.statuses || []).map(s => String(s).trim()).filter(Boolean);
    if (statuses.length === 0) {
      return res.status(400).json({ error: 'Трябва да има поне един статус' });
    }
    next.statuses = [...new Set(statuses)];
  }

  if (body.columns !== undefined) {
    const columns = (body.columns || []).filter(c => COLUMN_KEYS.includes(c));
    next.columns = columns;
  }

  if (body.devices !== undefined) {
    const devices = (body.devices || []).map(d => String(d).trim()).filter(Boolean);
    next.devices = [...new Set(devices)].sort((a, b) => a.localeCompare(b));
  }

  // The customer copy's layout is fixed (matches the shop's paper service
  // card) — only its header title and footer warning text are editable.
  if (body.printCustomer !== undefined) {
    const incoming = body.printCustomer || {};
    next.printCustomer = {
      header: typeof incoming.header === 'string' ? incoming.header : current.printCustomer.header,
      footer: typeof incoming.footer === 'string' ? incoming.footer : current.printCustomer.footer
    };
  }

  // The service copy is a fixed small label (shop name, order number,
  // problem description) — nothing about it is configurable.

  db.prepare('UPDATE settings SET data = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(JSON.stringify(next));

  broadcastChange('settings');
  res.json(next);
});

// Merges the admin-curated device list with phone models actually used on
// tickets, so the dropdown "learns" new models as they're typed in.
app.get('/api/devices', requireAuth, (req, res) => {
  const settings = getSettings();
  const usedRows = db.prepare('SELECT DISTINCT phone_model FROM tickets WHERE phone_model IS NOT NULL AND phone_model != \'\'').all();
  const used = usedRows.map(r => r.phone_model);

  const seen = new Map(); // lowercase -> original casing
  for (const d of [...settings.devices, ...used]) {
    const key = d.toLowerCase();
    if (!seen.has(key)) seen.set(key, d);
  }
  const merged = [...seen.values()].sort((a, b) => a.localeCompare(b));
  res.json(merged);
});

// ---- Audit log helper ----
function logAudit(ticketId, ticketNo, action, changes, username) {
  db.prepare(
    `INSERT INTO audit_log (ticket_id, ticket_no, action, changes, performed_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ticketId, ticketNo, action, JSON.stringify(changes), username);
}

const TRACKED_FIELDS = [
  ['customer_name', 'Име на клиента'],
  ['phone_contact', 'Телефон за контакт'],
  ['date_received', 'Дата на приемане'],
  ['date_returned', 'Дата на връщане'],
  ['phone_model', 'Модел на телефона'],
  ['status', 'Статус'],
  ['description', 'Описание на проблема'],
  ['comment', 'Коментар'],
  ['repair_performed', 'Извършен ремонт'],
  ['loaner_phone', 'Оборотен телефон'],
  ['pravim', 'Правим'],
  ['kaparo', 'Капаро'],
  ['service_price', 'Изкупна цена'],
  ['customer_price', 'Продажна цена']
];

// ---- Ticket routes (all require login) ----
app.get('/api/tickets', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tickets ORDER BY date_received DESC, ticket_no DESC').all();
  for (const row of rows) {
    row.editing_by = getEditingBy(row.id);
  }
  res.json(rows);
});

const PRAVIM_VALUES = ['circle', 'tick', 'cross'];
function normalizePravim(v, fallback) {
  return PRAVIM_VALUES.includes(v) ? v : fallback;
}

app.post('/api/tickets', requireAuth, (req, res) => {
  const t = req.body || {};
  if (!t.customerName || !t.phoneContact || !t.phoneModel || !t.dateReceived || !t.description) {
    return res.status(400).json({ error: 'Име на клиента, телефон за контакт, модел на телефона, дата на приемане и описание на проблема са задължителни' });
  }

  const nextNoRow = db.prepare('SELECT MAX(ticket_no) AS maxNo FROM tickets').get();
  const nextNo = (nextNoRow.maxNo || 0) + 1;

  const result = db
    .prepare(
      `INSERT INTO tickets
        (ticket_no, customer_name, phone_contact, date_received, date_returned, phone_model, status, description, comment, repair_performed, loaner_phone, pravim, kaparo, service_price, customer_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextNo,
      t.customerName,
      t.phoneContact,
      t.dateReceived,
      t.dateReturned || null,
      t.phoneModel,
      t.status || 'за сервиз',
      t.description,
      t.comment || '',
      t.repairPerformed || '',
      t.loanerPhone && t.loanerPhone.trim() ? t.loanerPhone.trim() : 'Не',
      normalizePravim(t.pravim, 'circle'),
      t.kaparo && String(t.kaparo).trim() ? String(t.kaparo).trim() : 'Не',
      t.servicePrice === '' || t.servicePrice == null ? null : Number(t.servicePrice),
      t.customerPrice === '' || t.customerPrice == null ? null : Number(t.customerPrice)
    );

  const created = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);

  logAudit(created.id, created.ticket_no, 'created', {
    customer_name: created.customer_name,
    phone_contact: created.phone_contact,
    date_received: created.date_received,
    date_returned: created.date_returned,
    phone_model: created.phone_model,
    status: created.status,
    description: created.description,
    comment: created.comment,
    repair_performed: created.repair_performed,
    loaner_phone: created.loaner_phone,
    pravim: created.pravim,
    kaparo: created.kaparo,
    service_price: created.service_price,
    customer_price: created.customer_price
  }, req.session.username);

  broadcastChange('tickets');
  res.status(201).json(created);
});

app.put('/api/tickets/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });

  const t = req.body || {};
  if (t.description !== undefined && !t.description) {
    return res.status(400).json({ error: 'Описанието на проблема е задължително' });
  }

  const next = {
    customer_name: t.customerName ?? existing.customer_name,
    phone_contact: t.phoneContact ?? existing.phone_contact,
    date_received: t.dateReceived ?? existing.date_received,
    date_returned: t.dateReturned !== undefined ? (t.dateReturned || null) : existing.date_returned,
    phone_model: t.phoneModel ?? existing.phone_model,
    status: t.status ?? existing.status,
    description: t.description ?? existing.description,
    comment: t.comment !== undefined ? t.comment : existing.comment,
    repair_performed: t.repairPerformed !== undefined ? t.repairPerformed : existing.repair_performed,
    loaner_phone: t.loanerPhone !== undefined
      ? (t.loanerPhone.trim() ? t.loanerPhone.trim() : 'Не')
      : existing.loaner_phone,
    pravim: t.pravim !== undefined ? normalizePravim(t.pravim, existing.pravim) : existing.pravim,
    kaparo: t.kaparo !== undefined
      ? (String(t.kaparo).trim() ? String(t.kaparo).trim() : 'Не')
      : existing.kaparo,
    service_price: t.servicePrice === '' || t.servicePrice == null ? null : Number(t.servicePrice),
    customer_price: t.customerPrice === '' || t.customerPrice == null ? null : Number(t.customerPrice)
  };
  if (t.servicePrice === undefined) next.service_price = existing.service_price;
  if (t.customerPrice === undefined) next.customer_price = existing.customer_price;

  db.prepare(
    `UPDATE tickets SET
      customer_name = ?, phone_contact = ?, date_received = ?, date_returned = ?, phone_model = ?,
      status = ?, description = ?, comment = ?, repair_performed = ?, loaner_phone = ?, pravim = ?,
      kaparo = ?, service_price = ?, customer_price = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    next.customer_name, next.phone_contact, next.date_received, next.date_returned,
    next.phone_model, next.status, next.description, next.comment, next.repair_performed, next.loaner_phone,
    next.pravim, next.kaparo, next.service_price, next.customer_price,
    req.params.id
  );

  // Record only what actually changed, for a readable audit trail.
  const diff = {};
  for (const [col] of TRACKED_FIELDS) {
    if (String(existing[col] ?? '') !== String(next[col] ?? '')) {
      diff[col] = { from: existing[col], to: next[col] };
    }
  }
  if (Object.keys(diff).length > 0) {
    logAudit(existing.id, existing.ticket_no, 'updated', diff, req.session.username);
  }

  const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  broadcastChange('tickets');
  res.json(updated);
});

app.delete('/api/tickets/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });

  logAudit(existing.id, existing.ticket_no, 'deleted', {
    customer_name: existing.customer_name,
    phone_contact: existing.phone_contact,
    phone_model: existing.phone_model,
    status: existing.status
  }, req.session.username);

  db.prepare('DELETE FROM tickets WHERE id = ?').run(req.params.id);
  broadcastChange('tickets');
  res.json({ ok: true });
});

// ---- Audit / history routes ----
app.get('/api/tickets/:id/history', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE ticket_id = ? ORDER BY performed_at DESC')
    .all(req.params.id);
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes) })));
});

app.get('/api/audit', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM audit_log ORDER BY performed_at DESC LIMIT 200')
    .all();
  res.json(rows.map(r => ({ ...r, changes: JSON.parse(r.changes) })));
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Repair log running at http://localhost:${PORT}`);
});
