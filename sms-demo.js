// Pretend SMS for the public demo (DEMO_MODE=true): visitors can try the
// whole SMS flow, but nothing ever leaves the server — no SMS service or
// phone is contacted, so the demo can't be used to send real messages.
//
// A "sent" message is reported as delivered once DELIVER_AFTER_MS have
// passed (the server checks every minute). Numbers ending in 000 are
// reported as not delivered, to show what a failure looks like.
const DELIVER_AFTER_MS = 5000;
let counter = 0;

const config = () => process.env.DEMO_MODE === 'true';

// The id carries the send time and the number's ending, so the state can
// be worked out later without keeping anything in memory.
async function send(phone) {
  const fails = /000$/.test(phone) ? 'f' : 'd';
  return { gatewayId: `demo-${Date.now()}-${++counter}-${fails}`, state: 'Pending' };
}

async function state(gatewayId, now = Date.now()) {
  const m = /^demo-(\d+)-\d+-([fd])$/.exec(String(gatewayId || ''));
  if (!m) return null;
  if (now - Number(m[1]) < DELIVER_AFTER_MS) return { state: 'Pending', error: null };
  return m[2] === 'f'
    ? { state: 'Failed', error: 'Демо: номерът не съществува' }
    : { state: 'Delivered', error: null };
}

async function serviceStatus() {
  return { state: 'ready', details: { provider: 'demo', problems: [] } };
}

module.exports = { config, send, state, serviceStatus, DELIVER_AFTER_MS };
