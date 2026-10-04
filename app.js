// Builds the Express app: session, the routes (routes/), scheduled jobs
// called by server.js, the static frontend and the error handler.
//
//   lib/      shared helpers (login checks, live updates, settings, history,
//             order validation, small utilities)
//   routes/   the API, one file per area
require('./env');
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./db');
const { forgetStaleWaiting } = require('./auto-status');
const live = require('./lib/live');
require('./lib/ticket-listeners'); // history + live updates after every order change
const smsRoutes = require('./routes/sms');

const app = express();

// Behind a reverse proxy every request arrives from the proxy's address —
// set TRUST_PROXY in .env so the login rate limit sees each user's real IP
// instead of locking everyone out together, and so HTTPS is detected:
//   loopback  nginx/Caddy on the same machine
//   1         one proxy hop in front (hosting platforms such as Render)
// Leave unset when browsers connect directly (e.g. over Tailscale).
function parseTrustProxy(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // address/subnet list or a named range like "loopback"
}
if (process.env.TRUST_PROXY) app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// ---- Demo mode ----
// Public: tells the pages whether to show the DEMO banner and pre-fill the
// demo login. Reveals nothing outside demo mode.
app.get('/api/demo', (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.json({ demo: false });
  const { DEMO_USERS } = require('./demo');
  res.json({ demo: true, users: DEMO_USERS });
});

// ---- Health check ----
// For uptime monitoring / NSSM checks: confirms the process is serving
// requests AND the database is readable, not just that node.exe exists.
// No login required and reveals nothing beyond "ok".
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Health check failed:`, err);
    res.status(503).json({ status: 'error' });
  }
});

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
      sameSite: 'lax',
      // COOKIE_SECURE=true once the app is only reached over HTTPS: the
      // login cookie is then never sent over plain HTTP. Behind a proxy
      // that terminates HTTPS this also needs TRUST_PROXY.
      secure: process.env.COOKIE_SECURE === 'true'
    }
  })
);

// ---- API ----
app.use(live.router);                    // live updates, "who's viewing"
app.use(require('./routes/auth'));       // login, password, accounts
app.use(require('./routes/settings'));   // Настройки, phone models
app.use(require('./routes/tickets'));    // orders, service label, history
app.use(require('./routes/reports'));    // Справки
app.use(smsRoutes.router);               // SMS to customers

// ---- Scheduled jobs (started by server.js) ----
// Every minute: SMS delivery states.
app.pollSmsStates = smsRoutes.pollSmsStates;

// On start and hourly: orders waiting for the customer for over 30 days
// become "забравен" (history and live updates via the order events).
app.runMaintenance = () => {
  const forgotten = forgetStaleWaiting(db);
  if (forgotten.length) {
    console.log(`[${new Date().toISOString()}] Marked ${forgotten.length} order(s) as "забравен" after 30+ days waiting: ` +
      forgotten.map(t => `#${t.ticketNo}`).join(', '));
  }
  return forgotten;
};

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Error handler ----
// Replaces Express's default HTML error page, which includes a full stack
// trace unless NODE_ENV=production. Covers malformed JSON bodies (400),
// oversized bodies (413) and any unexpected error thrown in a route (500).
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} failed:`, err);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: status >= 500 ? 'Възникна грешка на сървъра. Опитайте отново.' : 'Невалидна заявка'
  });
});

module.exports = app;
