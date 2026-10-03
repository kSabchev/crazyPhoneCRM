// Main page: shared state, status colours and constants.

let tickets = [];
let editingTicket = null;
let settings = null;
let liveEvents = null;
let currentUsername = null;
let currentRole = null; // 'admin' | 'staff'

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
