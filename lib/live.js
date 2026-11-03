// @ts-check
// Live updates and the "currently being worked on" presence indicator.
const express = require('express');
const { requireAuth } = require('./auth');
const { ticketTarget } = require('./ticket-target');

const router = express.Router();

// ---- Live update stream (Server-Sent Events) ----
// Lets every open browser tab know the moment ticket/settings data changes
// elsewhere, so they can refresh automatically instead of needing a manual
// page reload. One-way (server -> browser) push over a plain HTTP
// connection the browser keeps open and auto-reconnects if it drops.
//
// Each screen hears about its own shop (the one it worked on when it
// connected; an admin's page reconnects after picking another shop). An
// admin's all-shops view hears about every shop.
/** @type {Map<import('express').Response, number | null>} stream -> shop id; null: all shops */
const sseClients = new Map();

// To the screens of shop `storeId`, or of every shop when it's null.
/** @param {string} type @param {number | null} [storeId] */
function broadcastChange(type, storeId = null) {
  const payload = `data: ${type}\n\n`;
  for (const [res, clientStore] of sseClients) {
    if (storeId === null || clientStore === null || clientStore === storeId) res.write(payload);
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

  sseClients.set(res, req.allShops ? null : req.store.id);

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
// "stopped editing" signal (e.g. the browser crashed). Order ids repeat
// between shops, so the shop is part of the key.
const editingNow = new Map(); // "shopId:ticketId" -> { username, startedAt }
const EDITING_STALE_MS = 10 * 60 * 1000; // 10 minutes
const editingKey = (storeId, ticketId) => `${storeId}:${ticketId}`;

/** @param {number} storeId @param {number | string} ticketId */
function getEditingBy(storeId, ticketId) {
  const key = editingKey(storeId, ticketId);
  const entry = editingNow.get(key);
  if (!entry) return null;
  if (Date.now() - entry.startedAt > EDITING_STALE_MS) {
    editingNow.delete(key);
    return null;
  }
  return entry.username;
}

// The order's shop comes from its id (lib/ticket-target.js).
router.post('/api/tickets/:id/editing/start', requireAuth, (req, res) => {
  const target = ticketTarget(req);
  if (!target) return res.status(404).json({ error: 'Поръчката не е намерена' });
  editingNow.set(editingKey(target.store.id, target.id), { username: req.session.username, startedAt: Date.now() });
  broadcastChange('tickets', target.store.id);
  res.json({ ok: true });
});

router.post('/api/tickets/:id/editing/stop', requireAuth, (req, res) => {
  const target = ticketTarget(req);
  if (!target) return res.status(404).json({ error: 'Поръчката не е намерена' });
  const key = editingKey(target.store.id, target.id);
  const entry = editingNow.get(key);
  // Only clear if it's actually this user's own marker, so one person
  // closing their modal can't wipe someone else's active indicator.
  if (entry && entry.username === req.session.username) {
    editingNow.delete(key);
    broadcastChange('tickets', target.store.id);
  }
  res.json({ ok: true });
});

module.exports = { router, broadcastChange, getEditingBy };
