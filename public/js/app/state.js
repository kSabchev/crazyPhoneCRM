// Main page: shared state, status colours and constants.

let tickets = [];
let editingTicket = null;
let settings = null;
let liveEvents = null;
let currentUsername = null;
let currentRole = null; // 'admin' | 'shop_manager' | 'staff'
let currentStore = null; // the shop this page works on: { id, name, prefix }
let allStores = [];      // admins: every shop, to pick from
let allShops = false;    // admins: the all-shops view (every shop's orders)

// Order ids: numbers, or "<shop id>:<order id>" in the all-shops view (ids
// repeat between shops). Compared as text, since the page also reads them
// back from data-id attributes.
const sameId = (a, b) => String(a) === String(b);
const findTicket = id => tickets.find(t => sameId(t.id, id));

// The order number as people see it: with the shop's prefix ("Л-123").
const orderNo = t => (t.store_prefix ? `${t.store_prefix}-${t.ticket_no}` : String(t.ticket_no));

// A shop's own settings (name, phone, footer…) for printing an order: in
// the all-shops view the order's shop's; otherwise the page's shop's.
function shopSettingsFor(t){
  const own = settings && settings.shops && t && settings.shops[t.store_id];
  return own ? { ...settings, ...own } : settings;
}

const statusStyles = {
  [STATUSES.FOR_SERVICE]: ['var(--status-forservice)','var(--status-forservice-bg)'],
  [STATUSES.IN_SERVICE]: ['var(--status-inservice)','var(--status-inservice-bg)'],
  [STATUSES.WAITING]: ['var(--status-waiting)','var(--status-waiting-bg)'],
  [STATUSES.COMPLETED]: ['var(--status-issued)','var(--status-issued-bg)'],
  [STATUSES.REFUSED]: ['var(--status-refused)','var(--status-refused-bg)'],
  [STATUSES.FORGOTTEN]: ['var(--status-forgotten)','var(--status-forgotten-bg)']
};
const FALLBACK_STATUS_STYLE = ['var(--status-neutral)','var(--status-neutral-bg)'];

// Badge colours: the status's colour from Settings, with white or dark text,
// whichever reads better on it. Before settings load, the built-in styles.
function statusBadgeColors(status){
  const bg = settings && settings.statusColors && settings.statusColors[status];
  if(bg) return [readableTextOn(bg), bg];
  return statusStyles[status] || FALLBACK_STATUS_STYLE;
}

const COLUMN_KEYS = ['customer','callBtn','model','issue','password','comment','repairPerformed','loanerPhone','pravim','status','kaparo','servicePrice','customerPrice','dateIn','dateReturned'];

const PRAVIM_SYMBOLS = { circle: '○', tick: '✓', cross: '✗' };
const PRAVIM_CYCLE = ['circle', 'tick', 'cross'];
function nextPravim(v){
  const i = PRAVIM_CYCLE.indexOf(v);
  return PRAVIM_CYCLE[(i + 1) % PRAVIM_CYCLE.length];
}

// The status considered "completed" for the purposes of the "in progress"
// filter and the top stats. Matches the default Bulgarian status set.
const COMPLETED_STATUS = STATUSES.COMPLETED;
// Finished orders: handed back, refused, or never collected. Everything else
// counts as "В процес".
const CLOSED_STATUSES = STATUSES.CLOSED;
