// A stand-in for "SMS Gateway for Android" in tests: speaks the same API
// (POST /message, GET /message/:id, Basic auth), records what it was asked
// to send, and never sends anything. Used by the API tests and by the
// browser-test server (e2e/server.js).
const http = require('http');

function startFakeGateway({ user = 'sms', password = 'secret', port = 0 } = {}) {
  const gw = {
    sent: [],              // { id, text, phoneNumbers, withDeliveryReport }
    mode: 'ok',            // 'ok' | 'error' (HTTP 500)
    states: new Map(),     // id -> { state, error }
    url: null,
    close: null
  };
  const expectedAuth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Test-only helpers (no auth): inspect and reset what was "sent".
    if (req.url === '/__sent') return send(200, gw.sent);
    if (req.url === '/__reset' && req.method === 'POST') { gw.sent = []; gw.states.clear(); return send(200, {}); }

    if (req.headers.authorization !== expectedAuth) return send(401, { message: 'Unauthorized' });

    const match = req.url.match(/^\/messages?\/([\w-]+)$/);
    if (req.method === 'GET' && match) {
      const s = gw.states.get(match[1]);
      if (!s) return send(404, { message: 'not found' });
      return send(200, { id: match[1], state: s.state, recipients: [{ phoneNumber: '', state: s.state, error: s.error || null }] });
    }

    if (req.method === 'POST' && /^\/messages?$/.test(req.url)) {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        if (gw.mode === 'error') return send(500, { message: 'boom' });
        const body = JSON.parse(raw);
        const id = `msg-${gw.sent.length + 1}`;
        gw.sent.push({ id, text: body.textMessage && body.textMessage.text, phoneNumbers: body.phoneNumbers, withDeliveryReport: body.withDeliveryReport });
        gw.states.set(id, { state: 'Pending' });
        send(202, { id, state: 'Pending', recipients: body.phoneNumbers.map(p => ({ phoneNumber: p, state: 'Pending' })) });
      });
      return;
    }
    send(404, { message: 'not found' });
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      gw.url = `http://127.0.0.1:${server.address().port}`;
      gw.close = () => new Promise(r => server.close(r));
      resolve(gw);
    });
  });
}

module.exports = { startFakeGateway };
