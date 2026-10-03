// Live updates and the "currently being worked on" presence indicator.
const express = require('express');
const { requireAuth } = require('./auth');

const router = express.Router();

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

router.get('/api/events', requireAuth, (req, res) => {
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

router.post('/api/tickets/:id/editing/start', requireAuth, (req, res) => {
  editingNow.set(String(req.params.id), { username: req.session.username, startedAt: Date.now() });
  broadcastChange('tickets');
  res.json({ ok: true });
});

router.post('/api/tickets/:id/editing/stop', requireAuth, (req, res) => {
  const entry = editingNow.get(String(req.params.id));
  // Only clear if it's actually this user's own marker, so one person
  // closing their modal can't wipe someone else's active indicator.
  if (entry && entry.username === req.session.username) {
    editingNow.delete(String(req.params.id));
    broadcastChange('tickets');
  }
  res.json({ ok: true });
});

module.exports = { router, broadcastChange, getEditingBy };
