// A stand-in for the SMSAPI.bg API in tests: POST /sms.do, GET
// /sms.do?status=<id>, GET /profile, Bearer token auth, SMSAPI-style JSON
// errors. Records what it was asked to send and never sends anything.
const http = require('http');

function startFakeSmsapi({ token = 'test-token' } = {}) {
  const api = {
    sent: [],                // { id, to, message, from, test, encoding }
    statuses: new Map(),     // id -> SMSAPI status name, e.g. 'DELIVERED'
    points: 42.5,
    nextError: null,         // { error, message } returned by the next send
    url: null,
    close: null
  };

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) {
      return send(401, { error: 101, message: 'Authorization failed' });
    }
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET' && url.pathname === '/profile') {
      return send(200, { points: api.points, name: 'CrazyPhone', username: 'shop' });
    }
    if (req.method === 'GET' && url.pathname === '/sms.do' && url.searchParams.get('status')) {
      const id = url.searchParams.get('status');
      const status = api.statuses.get(id);
      if (!status) return send(200, { error: 13, message: 'Not found' });
      return send(200, { count: 1, list: [{ id, status, points: 0.16 }] });
    }
    if (req.method === 'POST' && url.pathname === '/sms.do') {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        if (api.nextError) {
          const e = api.nextError;
          api.nextError = null;
          return send(200, e);
        }
        const form = Object.fromEntries(new URLSearchParams(raw));
        const id = String(1460969715572091219n + BigInt(api.sent.length));
        api.sent.push({ id, to: form.to, message: form.message, from: form.from, test: form.test, encoding: form.encoding, format: form.format });
        api.statuses.set(id, 'QUEUE');
        send(200, { count: 1, list: [{ id, points: 0.16, number: form.to, status: 'QUEUE' }] });
      });
      return;
    }
    send(404, { error: 404, message: 'not found' });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      api.url = `http://127.0.0.1:${server.address().port}`;
      api.close = () => new Promise(r => server.close(r));
      resolve(api);
    });
  });
}

module.exports = { startFakeSmsapi };
