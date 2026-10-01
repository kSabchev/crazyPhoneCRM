let tickets = [];
let editingTicket = null;
let settings = null;
let liveEvents = null;
let currentUsername = null;

const statusStyles = {
  'за сервиз': ['var(--status-forservice)','var(--status-forservice-bg)'],
  'в сервиз': ['var(--status-inservice)','var(--status-inservice-bg)'],
  'чака клиент': ['var(--status-waiting)','var(--status-waiting-bg)'],
  'издаден': ['var(--status-issued)','var(--status-issued-bg)'],
  'отказан': ['var(--status-refused)','var(--status-refused-bg)'],
  'забравен': ['var(--status-forgotten)','var(--status-forgotten-bg)']
};
const FALLBACK_STATUS_STYLE = ['var(--status-neutral)','var(--status-neutral-bg)'];

// Badge colours: the status's colour from Settings, with white or dark text,
// whichever reads better on it. Before settings load, the built-in styles.
function readableTextOn(hex){
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#211E1A' : '#FFFFFF';
}
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

// ---------- Auth ----------
async function checkSession(){
  const res = await fetch('/api/auth/me');
  if(res.ok){
    const data = await res.json();
    showApp(data.username);
  } else {
    showLogin();
  }
}

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
}

async function showApp(username){
  currentUsername = username;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('whoAmI').textContent = username;
  await loadSettings();
  await loadDevices();
  loadSmsConfig();
  loadTickets();
  connectLiveUpdates();
}

// Server-Sent Events: the server pushes a message the instant any user
// creates, edits, or deletes a ticket, or changes settings — so every open
// tab refreshes automatically instead of needing a manual page reload. The
// browser reconnects on its own if the connection ever drops.
function connectLiveUpdates(){
  if(liveEvents) return; // already connected
  liveEvents = new EventSource('/api/events');
  liveEvents.onmessage = (e)=>{
    if(e.data === 'tickets'){
      loadTickets();
      if(editingTicket && smsEnabled) loadTicketSms(editingTicket.id);
    } else if(e.data === 'settings'){
      loadSettings().then(()=>{ loadDevices(); render(); });
    }
  };
  // EventSource retries on its own. Changes made while the stream wasn't
  // connected (the moment between page load and connecting, a server
  // restart, Wi-Fi drop, laptop sleep) are never re-sent, so reload
  // everything each time it (re)connects to catch up.
  liveEvents.onopen = ()=>{
    loadSettings().then(()=>{ loadDevices(); loadTickets(); });
  };
}

function disconnectLiveUpdates(){
  if(liveEvents){
    liveEvents.close();
    liveEvents = null;
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  const res = await fetch('/api/auth/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username, password })
  });

  if(res.ok){
    const data = await res.json();
    document.getElementById('loginPass').value = '';
    showApp(data.username);
  } else {
    const data = await res.json().catch(()=>({}));
    errEl.textContent = data.error || 'Неуспешен вход.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  disconnectLiveUpdates();
  await fetch('/api/auth/logout', { method:'POST' });
  showLogin();
});

document.getElementById('reportsBtn').addEventListener('click', ()=>{
  window.location.href = '/reports.html';
});
document.getElementById('settingsBtn').addEventListener('click', ()=>{
  window.location.href = '/settings.html';
});

// The status considered "completed" for the purposes of the "in progress"
// filter and the top stats. Matches the default Bulgarian status set.
const COMPLETED_STATUS = 'издаден';
// Finished orders: handed back, refused, or never collected. Everything else
// counts as "В процес".
const CLOSED_STATUSES = [COMPLETED_STATUS, 'отказан', 'забравен'];

// ---------- Settings ----------
async function loadSettings(){
  const res = await fetch('/api/settings');
  if(res.status === 401){ showLogin(); return; }
  settings = await res.json();

  // Status filter dropdown: All, then "in progress" (everything not completed), then each status individually.
  const filterSel = document.getElementById('statusFilter');
  // Rebuilding the options resets the selection, and this runs again on every
  // live-update (re)connect and settings change: keep what the user chose.
  const chosen = filterSel.value;
  filterSel.innerHTML = '<option value="">Всички статуси</option>' +
    '<option value="__active__">В процес (без завършени)</option>' +
    settings.statuses.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if([...filterSel.options].some(o => o.value === chosen)) filterSel.value = chosen;

  // Ticket modal status dropdown
  const modalSel = document.getElementById('f_status');
  modalSel.innerHTML = settings.statuses.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  // Column visibility
  document.querySelectorAll('[data-col]').forEach(el=>{
    const key = el.getAttribute('data-col');
    el.style.display = settings.columns.includes(key) ? '' : 'none';
  });
}

async function loadDevices(){
  const res = await fetch('/api/devices');
  if(!res.ok) return;
  const devices = await res.json();
  document.getElementById('deviceOptions').innerHTML = devices.map(d=>`<option value="${escapeHtml(d)}">`).join('');
}

// ---------- Tickets ----------
async function loadTickets(){
  const res = await fetch('/api/tickets');
  if(res.status === 401){ showLogin(); return; }
  tickets = await res.json();
  render();
}

// Dates are stored as yyyy-mm-dd (native <input type="date"> value format).
// Displayed as dd.mm.yyyy throughout the app, regardless of browser locale.
// Today as yyyy-mm-dd in the browser's own time zone. (toISOString() is UTC,
// which gave yesterday's date for tickets opened between midnight and ~3am.)
function localDateString(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d){
  if(!d) return '—';
  const parts = d.split('-');
  if(parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}.${m}.${y}`;
}

// Money is shown the same way everywhere (table, history, print, reports):
// "25,00 €" — Bulgarian format, comma decimals, euro sign after.
const EUR = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });

function fmtPrice(v){
  if(v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? EUR.format(n) : String(v);
}

// A price for an input field, with a decimal comma as staff type it
// ("25,5"); empty when there's no price. The server accepts comma or point.
function priceForInput(v){
  return v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',');
}
const PRICE_INPUT = /^\s*(\d+(?:[.,]\d{1,2})?)?\s*$/;

// Капаро holds an amount, "Не" (no deposit) or free text from older
// orders: amounts are formatted as money, anything else shown as entered.
function fmtKaparo(v){
  if(v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(€|eur|евро)?$/i);
  return m ? EUR.format(Number(m[1].replace(',', '.'))) : s;
}

// A value in the change history, formatted the way the table shows it.
function fmtHistoryValue(field, v){
  if(field === 'pravim') return PRAVIM_SYMBOLS[v] || '—';
  if(v === null || v === undefined || v === '') return '—';
  if(field === 'service_price' || field === 'customer_price') return escapeHtml(fmtPrice(v));
  if(field === 'kaparo') return escapeHtml(fmtKaparo(v));
  return escapeHtml(String(v));
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Sorting ----------
// Click a sortable header (№, Статус, dates) to sort by it; click again to
// reverse. Default: by number, newest first. Remembered per browser.
const SORT_DEFAULT = { key: 'number', dir: 'desc' };
// Direction used the first time a column is picked.
const SORT_FIRST_DIR = { number: 'desc', status: 'asc', dateIn: 'desc', dateReturned: 'desc' };
let sortState = loadSortState();

function loadSortState(){
  try {
    const saved = JSON.parse(localStorage.getItem('ticketSort'));
    if(saved && SORT_FIRST_DIR[saved.key] && (saved.dir === 'asc' || saved.dir === 'desc')) return saved;
  } catch(_) { /* storage unavailable or corrupt: use the default */ }
  return { ...SORT_DEFAULT };
}

function setSort(key){
  sortState = sortState.key === key
    ? { key, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: SORT_FIRST_DIR[key] };
  try { localStorage.setItem('ticketSort', JSON.stringify(sortState)); } catch(_) {}
  render();
}

function sortTickets(list){
  const { key, dir } = sortState;
  const sign = dir === 'asc' ? 1 : -1;
  // Statuses sort in the order they're listed in Settings, not alphabetically.
  const statusOrder = settings ? settings.statuses : [];
  const statusRank = s => { const i = statusOrder.indexOf(s); return i === -1 ? statusOrder.length : i; };
  const value = {
    number: t => t.ticket_no,
    status: t => statusRank(t.status),
    dateIn: t => t.date_received || '',
    dateReturned: t => t.date_returned || ''
  }[key];

  return list.slice().sort((a, b) => {
    const va = value(a), vb = value(b);
    // Orders without a date always go last, whichever direction.
    if(key === 'dateReturned' && (va === '') !== (vb === '')) return va === '' ? 1 : -1;
    if(va < vb) return -sign;
    if(va > vb) return sign;
    return b.ticket_no - a.ticket_no; // ties: newest order first
  });
}

function updateSortHeaders(){
  document.querySelectorAll('th.sortable').forEach(th=>{
    const active = th.dataset.sort === sortState.key;
    th.classList.toggle('sorted', active);
    th.setAttribute('aria-sort', active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.sort-arrow').textContent = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
  });
}

document.querySelectorAll('th.sortable').forEach(th=>{
  th.addEventListener('click', ()=>setSort(th.dataset.sort));
  th.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setSort(th.dataset.sort); }
  });
});

function render(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusF = document.getElementById('statusFilter').value;
  const visible = settings ? settings.columns : COLUMN_KEYS;

  let filtered = tickets.filter(t=>{
    const matchesQ = !q || [t.customer_name, t.phone_contact, t.phone_model, t.description, ('#'+t.ticket_no)]
      .join(' ').toLowerCase().includes(q);
    const matchesStatus = !statusF || (statusF === '__active__' ? !CLOSED_STATUSES.includes(t.status) : t.status === statusF);
    return matchesQ && matchesStatus;
  });

  filtered = sortTickets(filtered);
  updateSortHeaders();

  const body = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');

  if(filtered.length === 0){
    body.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('.big').textContent = tickets.length === 0 ? 'Все още няма поръчки' : 'Няма намерени поръчки';
    empty.querySelector('div:last-child').textContent = tickets.length === 0
      ? 'Добавете първата сервизна поръчка, за да започнете дневника.'
      : 'Опитайте с друг термин за търсене или филтър по статус.';
  } else {
    empty.style.display = 'none';
    const dv = (key) => visible.includes(key) ? '' : ' style="display:none;"';
    body.innerHTML = filtered.map(t=>{
      const [fg,bg] = statusBadgeColors(t.status);
      const editingBadge = (t.editing_by && t.editing_by !== currentUsername)
        ? `<div class="editing-badge">👁 ${escapeHtml(t.editing_by)}</div>` : '';
      return `<tr onclick="openEdit(${t.id})">
        <td class="ticket-no">#${t.ticket_no}${editingBadge}</td>
        <td${dv('customer')}>
          <div class="cust-name">${escapeHtml(t.customer_name)}</div>
          <div class="cust-phone${isStandardPhone(t.phone_contact) ? '' : ' phone-nonstandard'}"${isStandardPhone(t.phone_contact) ? '' : ` title="${PHONE_HINT}"`}>${escapeHtml(t.phone_contact)}</div>
        </td>
        <td${dv('callBtn')} class="call-cell" onclick="event.stopPropagation()">
          <a href="${telHref(t.phone_contact)}" class="call-icon-btn" title="Обади се на ${escapeHtml(t.phone_contact)}">📞</a>
        </td>
        <td${dv('model')}>${escapeHtml(t.phone_model)}</td>
        <td class="desc-cell"${dv('issue')} title="${escapeHtml(t.description)}">${escapeHtml(t.description) || '—'}</td>
        <td class="password-cell quick-edit-cell"${dv('password')} onclick="openQuickEdit(event, ${t.id}, 'phonePassword')" title="Щракнете, за да промените паролата">${t.phone_password ? `<span class="password-value">${escapeHtml(t.phone_password)}</span>` : '—'}</td>
        <td class="desc-cell quick-edit-cell comment-cell"${dv('comment')} onclick="openQuickEdit(event, ${t.id}, 'comment')" title="${escapeHtml(t.comment) || 'Щракнете, за да добавите коментар'}">${escapeHtml(t.comment) || '—'}</td>
        <td class="desc-cell quick-edit-cell repair-cell"${dv('repairPerformed')} onclick="openQuickEdit(event, ${t.id}, 'repairPerformed')" title="${escapeHtml(t.repair_performed) || 'Щракнете, за да добавите извършен ремонт'}">${escapeHtml(t.repair_performed) || '—'}</td>
        <td${dv('loanerPhone')}>${escapeHtml(t.loaner_phone)}</td>
        <td${dv('pravim')} class="pravim-cell" onclick="togglePravim(event, ${t.id})"><span class="pravim-toggle pravim-${t.pravim||'circle'}">${PRAVIM_SYMBOLS[t.pravim||'circle']}</span></td>
        <td${dv('status')} class="status-cell" onclick="startStatusEdit(event, ${t.id})">${
          quickStatusId === t.id
            ? statusSelectHtml(t)
            : `<span class="badge" style="color:${fg};background:${bg};" title="Щракнете за смяна на статуса">${escapeHtml(t.status)}</span>`
        }</td>
        <td class="price"${dv('kaparo')}>${escapeHtml(fmtKaparo(t.kaparo))}</td>
        <td class="price quick-edit-cell service-price-cell"${dv('servicePrice')} onclick="openQuickEdit(event, ${t.id}, 'servicePrice')" title="Щракнете, за да промените изкупната цена">${fmtPrice(t.service_price)}</td>
        <td class="price quick-edit-cell customer-price-cell"${dv('customerPrice')} onclick="openQuickEdit(event, ${t.id}, 'customerPrice')" title="Щракнете, за да промените продажната цена">${fmtPrice(t.customer_price)}</td>
        <td${dv('dateIn')}>${fmtDate(t.date_received)}</td>
        <td${dv('dateReturned')}>${fmtDate(t.date_returned)}</td>
      </tr>`;
    }).join('');
  }

  // A live refresh redraws the table; keep an open quick-status dropdown
  // focused so a colleague's change doesn't interrupt picking a status.
  const openSelect = body.querySelector('.status-select');
  if(openSelect && !openSelect.contains(document.activeElement)) openSelect.focus();

  renderStats();
}

// ---------- Quick status change from the table ----------
// Clicking a status badge swaps it for a dropdown; picking a status saves
// immediately without opening the ticket. The server fills in today's
// return date when the new status is "издаден" (same rule as the form).
let quickStatusId = null;

function statusSelectHtml(t){
  const options = settings ? settings.statuses.slice() : [];
  // Keep a status that was since removed from settings selectable as-is.
  if(!options.includes(t.status)) options.unshift(t.status);
  return `<select class="status-select" aria-label="Статус на поръчка #${t.ticket_no}"
      onchange="saveQuickStatus(${t.id}, this.value)" onkeydown="if(event.key==='Escape') cancelStatusEdit()">
    ${options.map(s=>`<option value="${escapeHtml(s)}"${s===t.status?' selected':''}>${escapeHtml(s)}</option>`).join('')}
  </select>`;
}

function startStatusEdit(e, id){
  e.stopPropagation();
  if(quickStatusId === id) return; // clicks inside the open dropdown
  quickStatusId = id;
  render();
  const sel = document.querySelector('#tableBody .status-select');
  if(!sel) return;
  sel.focus();
  try { sel.showPicker(); } catch(_) { /* older browsers: focused, opens on next click/keypress */ }
}

function cancelStatusEdit(){
  if(quickStatusId === null) return;
  quickStatusId = null;
  render();
}

async function saveQuickStatus(id, status){
  quickStatusId = null;
  const t = tickets.find(x=>x.id===id);
  const previousStatus = t ? t.status : null;
  if(t) t.status = status; // show the new badge straight away
  render();

  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ status })
  });
  if(res.status === 401){ showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    alert(data.error || 'Статусът не можа да бъде запазен.');
  } else {
    offerSmsIfNowWaiting(await res.json(), previousStatus);
  }
  loadTickets(); // picks up the auto-set return date, or reverts on error
}

// Clicking anywhere outside the open dropdown closes it without saving.
document.addEventListener('click', (e)=>{
  if(quickStatusId !== null && !e.target.closest('.status-select')) cancelStatusEdit();
});

// Header counters, each a shortcut: clicking one filters the table to that
// status ("общо поръчки" shows all); clicking the active one again clears it.
const STAT_COUNTERS = [
  { filter: '',             label: 'общо поръчки', color: null },
  { filter: 'за сервиз',    label: 'за сервиз',    color: 'var(--status-forservice-text)' },
  { filter: 'в сервиз',     label: 'в сервиза',    color: 'var(--status-inservice-text)' },
  { filter: 'чака клиент',  label: 'чакат клиент', color: 'var(--status-waiting-text)' },
  { filter: COMPLETED_STATUS, label: 'издадени',     color: 'var(--status-issued-text)' },
  { filter: 'отказан',      label: 'отказани',     color: 'var(--status-refused-bg)' },
  { filter: 'забравен',     label: 'забравени',    color: 'var(--status-forgotten-bg)' }
];

function renderStats(){
  const current = document.getElementById('statusFilter').value;
  document.getElementById('stats').innerHTML = STAT_COUNTERS.map(c=>{
    const count = c.filter === '' ? tickets.length : tickets.filter(t=> t.status === c.filter).length;
    const active = c.filter !== '' && current === c.filter;
    const title = c.filter === '' ? 'Покажи всички поръчки' : `Покажи само „${c.filter}“`;
    return `<button type="button" class="stat${active ? ' active' : ''}" data-filter="${escapeHtml(c.filter)}" aria-pressed="${active}" title="${escapeHtml(title)}">
      <span class="num"${c.color ? ` style="color:${c.color}"` : ''}>${count}</span><span class="lbl">${c.label}</span>
    </button>`;
  }).join('');
}

function filterByCounter(status){
  const select = document.getElementById('statusFilter');
  // Toggle: the active counter clears the filter. A status removed from
  // Settings has no option in the dropdown, so it can't be filtered on.
  const next = select.value === status ? '' : status;
  if(next && ![...select.options].some(o => o.value === next)) return;
  select.value = next;
  render();
}

document.getElementById('stats').addEventListener('click', (e)=>{
  const btn = e.target.closest('.stat');
  if(btn) filterByCounter(btn.dataset.filter);
});

// Click a "Правим" marker in the table to cycle it and save immediately,
// without opening the ticket for editing.
async function togglePravim(e, id){
  e.stopPropagation();
  const t = tickets.find(x=>x.id===id);
  if(!t) return;
  const next = nextPravim(t.pravim || 'circle');
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ pravim: next })
  });
  if(res.status === 401){ showLogin(); return; }
  if(res.ok){ loadTickets(); }
}

// ---------- Modal ----------
function openNew(){
  editingTicket = null;
  document.getElementById('modalTitle').textContent = 'Нова сервизна поръчка';
  document.getElementById('modalSub').textContent = 'Регистрирайте телефон, приет за ремонт.';
  document.getElementById('f_customer').value = '';
  document.getElementById('f_phone').value = '';
  document.getElementById('f_phone_call').href = '#';
  document.getElementById('f_date').value = localDateString(new Date());
  document.getElementById('f_date_returned').value = '';
  document.getElementById('f_model').value = '';
  document.getElementById('f_status').value = (settings && settings.statuses[0]) || 'за сервиз';
  document.getElementById('f_service_price').value = '';
  document.getElementById('f_customer_price').value = '';
  document.getElementById('f_kaparo').value = 'Не';
  document.getElementById('f_desc').value = '';
  document.getElementById('f_comment').value = '';
  document.getElementById('f_repair').value = '';
  document.getElementById('f_loaner').value = 'не';
  document.getElementById('f_password').value = '';
  setPravimButton('circle');
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('printCustomerBtn').style.display = 'none';
  document.getElementById('printServiceBtn').style.display = 'none';
  document.getElementById('historySection').style.display = 'none';
  document.getElementById('smsSection').style.display = 'none';
  document.getElementById('topActions').style.display = 'none';
  markPhoneField();
  document.getElementById('editingBanner').style.display = 'none';
  setEditOnlyFieldsVisible(false);
  document.getElementById('overlay').classList.add('open');
  document.getElementById('f_customer').focus();
}

// "Извършен ремонт", "Правим", and the call button only make sense once a
// ticket already exists — nothing to call yet and no repair work has
// happened yet at the moment a new ticket is being created.
function setEditOnlyFieldsVisible(visible){
  document.querySelectorAll('.edit-only-field').forEach(el => {
    el.style.display = visible ? '' : 'none';
  });
}

function openEdit(id){
  const t = tickets.find(x=>x.id === id);
  if(!t) return;
  editingTicket = t;
  document.getElementById('modalTitle').textContent = `Поръчка #${t.ticket_no}`;
  document.getElementById('modalSub').textContent = 'Редактирайте детайлите, обновете статуса или разпечатайте копие.';
  document.getElementById('f_customer').value = t.customer_name;
  document.getElementById('f_phone').value = t.phone_contact;
  document.getElementById('f_phone_call').href = telHref(t.phone_contact);
  document.getElementById('f_date').value = t.date_received;
  document.getElementById('f_date_returned').value = t.date_returned || '';
  document.getElementById('f_model').value = t.phone_model;
  document.getElementById('f_status').value = t.status;
  document.getElementById('f_service_price').value = priceForInput(t.service_price);
  document.getElementById('f_customer_price').value = priceForInput(t.customer_price);
  document.getElementById('f_kaparo').value = t.kaparo || 'Не';
  document.getElementById('f_desc').value = t.description || '';
  document.getElementById('f_comment').value = t.comment || '';
  document.getElementById('f_repair').value = t.repair_performed || '';
  document.getElementById('f_loaner').value = t.loaner_phone === 'да' ? 'да' : 'не';
  document.getElementById('f_password').value = t.phone_password || '';
  setPravimButton(t.pravim || 'circle');
  setEditOnlyFieldsVisible(true);
  document.getElementById('topActions').style.display = 'flex';
  markPhoneField();
  document.getElementById('deleteBtn').style.display = 'inline-block';
  document.getElementById('printCustomerBtn').style.display = 'inline-block';
  document.getElementById('printServiceBtn').style.display = 'inline-block';
  document.getElementById('overlay').classList.add('open');

  document.getElementById('historySection').style.display = 'block';
  document.getElementById('smsSection').style.display = smsEnabled ? 'block' : 'none';
  document.getElementById('smsList').innerHTML = '';
  if(smsEnabled) loadTicketSms(t.id);
  document.getElementById('historyList').classList.remove('open');
  document.getElementById('historyToggle').classList.remove('open');
  document.getElementById('historyCount').textContent = '';
  loadTicketHistory(t.id);

  const banner = document.getElementById('editingBanner');
  if(t.editing_by && t.editing_by !== currentUsername){
    banner.textContent = `Внимание: в момента се преглежда от ${t.editing_by}`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
  markEditingStart(t.id);
}

function closeModal(){
  document.getElementById('overlay').classList.remove('open');
  if(editingTicket) markEditingStop(editingTicket.id);
  editingTicket = null;
}

// "Currently being worked on" presence — informational only, never blocks
// anyone from opening or saving a ticket. Lets other open tabs see who's
// looking at a ticket right now.
function markEditingStart(id){
  fetch(`/api/tickets/${id}/editing/start`, { method:'POST' }).catch(()=>{});
}
function markEditingStop(id){
  fetch(`/api/tickets/${id}/editing/stop`, { method:'POST' }).catch(()=>{});
}

// A Bulgarian number is 0 or +359 followed by 9 digits; spaces, dashes,
// dots, slashes and brackets are ignored. Anything else is still saved
// (foreign numbers, landlines with notes) but shown in red to catch typos.
const PHONE_HINT = 'Номерът не е във формат 0XXXXXXXXX или +359XXXXXXXXX';
function isStandardPhone(phone){
  return /^(0|\+359)\d{9}$/.test(String(phone || '').replace(/[\s\-./()]/g, ''));
}

function markPhoneField(){
  const input = document.getElementById('f_phone');
  const bad = input.value.trim() !== '' && !isStandardPhone(input.value);
  input.classList.toggle('phone-nonstandard', bad);
  input.title = bad ? PHONE_HINT : '';
}

function telHref(phone){
  const digits = (phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '#';
}

function setPravimButton(value){
  const btn = document.getElementById('f_pravim');
  btn.dataset.value = value;
  btn.textContent = PRAVIM_SYMBOLS[value];
  btn.className = 'pravim-toggle pravim-' + value;
}
document.getElementById('f_pravim').addEventListener('click', ()=>{
  setPravimButton(nextPravim(document.getElementById('f_pravim').dataset.value));
});

function collectForm(){
  return {
    customerName: document.getElementById('f_customer').value.trim(),
    phoneContact: document.getElementById('f_phone').value.trim(),
    dateReceived: document.getElementById('f_date').value,
    dateReturned: document.getElementById('f_date_returned').value,
    phoneModel: document.getElementById('f_model').value.trim(),
    status: document.getElementById('f_status').value,
    servicePrice: document.getElementById('f_service_price').value,
    customerPrice: document.getElementById('f_customer_price').value,
    kaparo: document.getElementById('f_kaparo').value.trim(),
    description: document.getElementById('f_desc').value.trim(),
    comment: document.getElementById('f_comment').value.trim(),
    repairPerformed: document.getElementById('f_repair').value.trim(),
    loanerPhone: document.getElementById('f_loaner').value,
    phonePassword: document.getElementById('f_password').value.trim(),
    pravim: document.getElementById('f_pravim').dataset.value
  };
}

async function saveTicket(){
  const payload = collectForm();
  if(!payload.customerName || !payload.phoneContact || !payload.phoneModel || !payload.description){
    alert('Моля, попълнете име на клиента, телефон за контакт, модел на телефона и описание на проблема.');
    return;
  }

  const previousStatus = editingTicket ? editingTicket.status : null;
  const url = editingTicket ? `/api/tickets/${editingTicket.id}` : '/api/tickets';
  const method = editingTicket ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(res.status === 401){ showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    alert(data.error || 'Поръчката не можа да бъде запазена.');
    return;
  }
  const saved = await res.json();

  closeModal();
  loadTickets();
  loadDevices();
  offerSmsIfNowWaiting(saved, previousStatus);
}

async function deleteTicket(){
  if(!editingTicket) return;
  if(!confirm('Да се изтрие ли тази поръчка? Това действие не може да бъде отменено.')) return;

  const res = await fetch(`/api/tickets/${editingTicket.id}`, { method:'DELETE' });
  if(res.status === 401){ showLogin(); return; }

  closeModal();
  loadTickets();
}

// ---------- History / audit ----------
const FIELD_LABELS = {
  customer_name: 'Име на клиента',
  phone_contact: 'Телефон за контакт',
  date_received: 'Дата на приемане',
  date_returned: 'Дата на връщане',
  phone_model: 'Модел на телефона',
  status: 'Статус',
  description: 'Описание на проблема',
  comment: 'Коментар',
  repair_performed: 'Извършен ремонт',
  loaner_phone: 'Оборотен телефон',
  phone_password: 'Парола',
  pravim: 'Правим',
  kaparo: 'Капаро',
  service_price: 'Изкупна цена',
  customer_price: 'Продажна цена'
};

function fmtWhen(isoLike){
  // performed_at is stored as SQLite datetime('now'), e.g. "2026-09-10 15:42:19" (UTC)
  const dt = new Date(isoLike.replace(' ', 'T') + 'Z');
  if(isNaN(dt)) return isoLike;
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2,'0');
  const min = String(dt.getMinutes()).padStart(2,'0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function describeEntry(entry, includeTicketRef){
  const who = escapeHtml(entry.performed_by);
  const when = fmtWhen(entry.performed_at);
  const ref = includeTicketRef ? `<span class="ticket-ref">#${entry.ticket_no}</span> ` : '';

  let body = '';
  if(entry.action === 'created'){
    body = 'Създаде поръчката.';
  } else if(entry.action === 'sms'){
    body = `Изпрати SMS до ${escapeHtml(entry.changes.phone || '')}${entry.changes.ok ? '' : ' — неуспешно'}.`;
  } else if(entry.action === 'deleted'){
    body = `Изтри поръчката (${escapeHtml(entry.changes.customer_name || '')}, ${escapeHtml(entry.changes.phone_model || '')}).`;
  } else {
    const lines = Object.entries(entry.changes).map(([field, {from, to}])=>{
      // The unlock code itself is never stored in the history.
      if(field === 'phone_password') return '<div class="change-line">Паролата е променена.</div>';
      const label = FIELD_LABELS[field] || field;
      const fromV = fmtHistoryValue(field, from);
      const toV = fmtHistoryValue(field, to);
      return `<div class="change-line">${label}: ${fromV} → ${toV}</div>`;
    });
    body = lines.join('');
  }

  return `<div class="history-entry">
    <div class="who-when">${ref}${who} — ${when}</div>
    ${body}
  </div>`;
}

async function loadTicketHistory(ticketId){
  const res = await fetch(`/api/tickets/${ticketId}/history`);
  if(!res.ok) return;
  const entries = await res.json();
  document.getElementById('historyCount').textContent = entries.length ? `(${entries.length})` : '';
  document.getElementById('historyList').innerHTML = entries.length
    ? entries.map(e=>describeEntry(e, false)).join('')
    : '<div class="history-entry">Все още няма регистрирани промени.</div>';
}

document.getElementById('historyToggle').addEventListener('click', ()=>{
  document.getElementById('historyList').classList.toggle('open');
  document.getElementById('historyToggle').classList.toggle('open');
});

document.getElementById('activityLogBtn').addEventListener('click', async ()=>{
  const res = await fetch('/api/audit');
  if(res.status === 401){ showLogin(); return; }
  const entries = await res.json();
  document.getElementById('activityList').innerHTML = entries.length
    ? entries.map(e=>describeEntry(e, true)).join('')
    : '<div class="history-entry">Все още няма регистрирана дейност.</div>';
  document.getElementById('activityOverlay').classList.add('open');
});

document.getElementById('closeActivityBtn').addEventListener('click', ()=>{
  document.getElementById('activityOverlay').classList.remove('open');
});
// ---------- SMS to the customer ----------
// Sent from the shop phone, only after confirming in the window below.
// Offered automatically when an order moves to "чака клиент", and any time
// from the order's "Изпрати SMS" button. Off unless the server has an SMS
// gateway configured.
const WAITING_STATUS = 'чака клиент';
let smsEnabled = false;
let smsTicketId = null;

async function loadSmsConfig(){
  try {
    const res = await fetch('/api/sms/config');
    smsEnabled = res.ok && (await res.json()).enabled === true;
  } catch(_) { smsEnabled = false; }
  document.getElementById('smsPill').style.display = smsEnabled ? '' : 'none';
  if(smsEnabled){
    refreshPhoneStatus();
    if(!phoneStatusTimer) phoneStatusTimer = setInterval(refreshPhoneStatus, 60 * 1000);
  }
}

// ---------- Is the SMS phone connected? ----------
// A pill in the header shows whether the shop phone answers and is ready,
// re-checked every minute (click it to check now). Details on hover.
let phoneStatusTimer = null;
const PHONE_STATES = {
  ready:   { cls: 'ok',      label: 'SMS: готов',           text: 'Телефонът е свързан и готов за изпращане на SMS.' },
  warning: { cls: 'warn',    label: 'SMS: внимание',        text: 'Телефонът е свързан, но съобщава за проблем' },
  offline: { cls: 'bad',     label: 'SMS: няма връзка',     text: 'Телефонът за SMS не отговаря — проверете дали е включен, в същата Wi-Fi мрежа и приложението е „Online“. SMS няма да бъде изпратен.' },
  auth:    { cls: 'bad',     label: 'SMS: грешни данни',    text: 'Телефонът отказва достъп — проверете потребителското име и паролата в .env.' },
  cloud:   { cls: 'neutral', label: 'SMS: облак',           text: 'SMS през облачната услуга — състоянието на телефона не може да се провери оттук.' }
};

function describePhoneStatus(s){
  const info = PHONE_STATES[s.state];
  if(!info) return null;
  const lines = [info.text + (s.state === 'warning' && s.details.problems && s.details.problems.length ? `: ${s.details.problems.join(', ')}.` : '')];
  const d = s.details || {};
  if(d.battery !== null && d.battery !== undefined) lines.push(`Батерия: ${d.battery}%${d.charging ? ' (зарежда се)' : ''}`);
  if(d.network) lines.push(`Мрежа: ${d.network}`);
  if(d.failedLastHour !== null && d.failedLastHour !== undefined) lines.push(`Неуспешни SMS за последния час: ${d.failedLastHour}`);
  lines.push(`Проверено: ${new Date(s.checkedAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}`);
  return { ...info, lines };
}

async function fetchPhoneStatus(fresh){
  try {
    const res = await fetch(`/api/sms/status${fresh ? '?fresh=1' : ''}`);
    return res.ok ? await res.json() : null;
  } catch(_) { return null; }
}

async function refreshPhoneStatus(fresh){
  const s = await fetchPhoneStatus(fresh);
  const pill = document.getElementById('smsPill');
  const info = s && describePhoneStatus(s);
  if(!info){ pill.style.display = 'none'; return; }
  pill.style.display = '';
  pill.className = `sms-pill sms-pill-${info.cls}`;
  pill.dataset.state = s.state;
  pill.textContent = `📱 ${info.label}`;
  pill.title = info.lines.join('\n') + '\n\nЩракнете за нова проверка.';
  return s;
}

document.getElementById('smsPill').addEventListener('click', ()=>refreshPhoneStatus(true));

function offerSmsIfNowWaiting(saved, previousStatus){
  if(smsEnabled && saved && saved.status === WAITING_STATUS && previousStatus !== WAITING_STATUS){
    openSmsPrompt(saved.id);
  }
}

// Cyrillic SMS: 70 characters in one message, 67 per part when longer.
function smsParts(text){
  const len = [...text].length;
  if(len === 0) return 0;
  const latin = /^[\x20-\x7E\r\n]*$/.test(text);
  const [single, multi] = latin ? [160, 153] : [70, 67];
  return len <= single ? 1 : Math.ceil(len / multi);
}

function updateSmsCounter(){
  const text = document.getElementById('smsText').value.trim();
  const parts = smsParts(text);
  const counter = document.getElementById('smsCounter');
  counter.textContent = `${[...text].length} знака · ${parts} SMS`;
  counter.classList.toggle('multi', parts > 1);
}

async function openSmsPrompt(ticketId){
  const res = await fetch(`/api/tickets/${ticketId}/sms/preview`);
  if(!res.ok) return;
  const p = await res.json();
  if(!p.enabled) return;
  const t = tickets.find(x=>x.id===ticketId);
  smsTicketId = ticketId;
  document.getElementById('smsSub').textContent = t ? `Поръчка #${t.ticket_no} — ${t.customer_name}, ${t.phone_model}` : '';
  document.getElementById('smsText').value = p.text;
  const error = document.getElementById('smsError');
  const confirmBtn = document.getElementById('smsConfirmBtn');
  document.getElementById('smsTo').innerHTML = `До: <strong>${escapeHtml(p.phone || p.phoneAsEntered)}</strong>`;
  if(p.phone){
    error.textContent = '';
    confirmBtn.disabled = false;
  } else {
    error.textContent = 'Номерът не е валиден български мобилен номер (0XXXXXXXXX или +359XXXXXXXXX), затова SMS не може да бъде изпратен. Поправете номера в поръчката.';
    confirmBtn.disabled = true;
  }
  confirmBtn.textContent = 'Изпрати SMS';
  updateSmsCounter();
  const phoneLine = document.getElementById('smsPhoneStatus');
  phoneLine.textContent = 'Проверка на телефона…';
  phoneLine.className = 'sms-phone-status';
  document.getElementById('smsOverlay').classList.add('open');
  (p.phone ? confirmBtn : document.getElementById('smsSkipBtn')).focus();

  // Fresh check of the phone, so it's clear before sending whether it can work.
  const s = await refreshPhoneStatus(true);
  const info = s && describePhoneStatus(s);
  if(smsTicketId !== ticketId) return; // window closed meanwhile
  phoneLine.textContent = info ? `📱 ${info.lines[0]}` : '';
  phoneLine.className = `sms-phone-status${info ? ' sms-phone-' + info.cls : ''}`;
}

function closeSmsPrompt(){
  document.getElementById('smsOverlay').classList.remove('open');
  smsTicketId = null;
}

async function confirmSms(){
  if(smsTicketId === null) return;
  const id = smsTicketId;
  const btn = document.getElementById('smsConfirmBtn');
  const error = document.getElementById('smsError');
  btn.disabled = true;
  btn.textContent = 'Изпращане…';
  error.textContent = '';
  const res = await fetch(`/api/tickets/${id}/sms`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ text: document.getElementById('smsText').value })
  }).catch(()=>null);
  if(res && res.status === 401){ closeSmsPrompt(); showLogin(); return; }
  if(res && res.ok){
    closeSmsPrompt();
    if(editingTicket && editingTicket.id === id){
      loadTicketSms(id);
      loadTicketHistory(id);
    }
    return;
  }
  const data = res ? await res.json().catch(()=>({})) : {};
  error.textContent = `${data.error || 'SMS не можа да бъде изпратен.'} Можете да опитате отново.`;
  btn.disabled = false;
  btn.textContent = 'Опитай отново';
}

const SMS_STATE_LABELS = {
  Sending: 'изпраща се…',
  Pending: 'чака телефона',
  Processed: 'изпраща се от телефона',
  Sent: 'изпратено',
  Delivered: 'доставено ✓',
  Failed: 'неуспешно'
};

async function loadTicketSms(ticketId){
  const res = await fetch(`/api/tickets/${ticketId}/sms`);
  if(!res.ok) return;
  const list = await res.json();
  if(!editingTicket || editingTicket.id !== ticketId) return;
  document.getElementById('smsList').innerHTML = list.length
    ? list.map(m=>`
      <div class="sms-entry sms-${escapeHtml(m.state.toLowerCase())}">
        <div class="who-when">${fmtWhen(m.created_at)} · ${escapeHtml(m.phone)} · ${escapeHtml(m.sent_by)}</div>
        <div class="sms-state">${escapeHtml(SMS_STATE_LABELS[m.state] || m.state)}${m.error ? ': ' + escapeHtml(m.error) : ''}</div>
        <div class="sms-text">${escapeHtml(m.text)}</div>
      </div>`).join('')
    : '<div class="sms-entry sms-none">Все още не е изпращан SMS по тази поръчка.</div>';
}

document.getElementById('smsSendBtn').addEventListener('click', ()=>{ if(editingTicket) openSmsPrompt(editingTicket.id); });
document.getElementById('smsConfirmBtn').addEventListener('click', confirmSms);
document.getElementById('smsSkipBtn').addEventListener('click', closeSmsPrompt);
document.getElementById('smsText').addEventListener('input', updateSmsCounter);
document.getElementById('smsOverlay').addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeSmsPrompt(); });

// ---------- Quick editor (Парола, Коментар, Извършен ремонт, prices) ----------
// Clicking one of these cells edits just that field in a small window,
// without opening the whole order. Saves only that field, so it can't
// overwrite anything else a colleague changed meanwhile.
//   kind 'text'  — multi-line (Ctrl+Enter saves)
//   kind 'line'  — single line (Enter saves)
//   kind 'price' — amount in €, empty = no price (Enter saves)
const QUICK_EDIT_FIELDS = {
  comment: { kind: 'text', title: 'Коментар', column: 'comment', placeholder: 'Допълнителни бележки...', error: 'Коментарът не можа да бъде запазен.' },
  repairPerformed: { kind: 'text', title: 'Извършен ремонт', column: 'repair_performed', placeholder: 'Какво беше извършено при ремонта...', error: 'Извършеният ремонт не можа да бъде запазен.' },
  phonePassword: { kind: 'line', title: 'Парола', column: 'phone_password', placeholder: 'напр. 1234 или Г-образен шаблон', error: 'Паролата не можа да бъде запазена.' },
  servicePrice: { kind: 'price', title: 'Изкупна цена (€)', column: 'service_price', placeholder: '0,00 — празно = без цена', error: 'Изкупната цена не можа да бъде запазена.' },
  customerPrice: { kind: 'price', title: 'Продажна цена (€)', column: 'customer_price', placeholder: '0,00 — празно = без цена', error: 'Продажната цена не можа да бъде запазена.' }
};
let quickEdit = null; // { id, field }

const quickEditInputFor = cfg => document.getElementById(cfg.kind === 'text' ? 'quickEditInput' : 'quickEditLine');

function openQuickEdit(e, id, field){
  e.stopPropagation();
  const t = tickets.find(x=>x.id===id);
  const cfg = QUICK_EDIT_FIELDS[field];
  if(!t || !cfg) return;
  quickEdit = { id, field };
  document.getElementById('quickEditTitle').textContent = cfg.title;
  document.getElementById('quickEditSub').textContent = `Поръчка #${t.ticket_no} — ${t.customer_name}, ${t.phone_model}`;
  document.getElementById('quickEditHint').textContent = cfg.kind === 'text'
    ? 'Ctrl+Enter запазва, Esc затваря' : 'Enter запазва, Esc затваря';

  const area = document.getElementById('quickEditInput');
  const line = document.getElementById('quickEditLine');
  area.style.display = cfg.kind === 'text' ? '' : 'none';
  line.style.display = cfg.kind === 'text' ? 'none' : '';
  const input = quickEditInputFor(cfg);
  // Prices: a plain text field with a numeric keyboard on phones — no
  // up/down arrows, no mouse-wheel changes, and "25,50" works as typed.
  line.inputMode = cfg.kind === 'price' ? 'decimal' : 'text';
  line.classList.toggle('price-input', cfg.kind === 'price');
  input.placeholder = cfg.placeholder;
  const current = t[cfg.column];
  input.value = cfg.kind === 'price' ? priceForInput(current) : (current === null || current === undefined ? '' : current);
  document.getElementById('quickEditOverlay').classList.add('open');
  input.focus();
  if(cfg.kind === 'price') input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
}

function closeQuickEdit(){
  document.getElementById('quickEditOverlay').classList.remove('open');
  quickEdit = null;
}

async function saveQuickEdit(){
  if(!quickEdit) return;
  const { id, field } = quickEdit;
  const cfg = QUICK_EDIT_FIELDS[field];
  const input = quickEditInputFor(cfg);
  if(cfg.kind === 'price' && !PRICE_INPUT.test(input.value)){
    alert(`${cfg.title.replace(' (€)', '')}: невалидна сума — въведете число, напр. 25,50, или оставете празно.`);
    return;
  }
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ [field]: input.value.trim() })
  });
  if(res.status === 401){ closeQuickEdit(); showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    alert(data.error || QUICK_EDIT_FIELDS[field].error);
    return;
  }
  closeQuickEdit();
  loadTickets();
}

document.getElementById('quickEditSaveBtn').addEventListener('click', saveQuickEdit);
document.getElementById('quickEditCancelBtn').addEventListener('click', closeQuickEdit);
document.getElementById('quickEditOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'quickEditOverlay') closeQuickEdit();
});
document.getElementById('quickEditInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeQuickEdit();
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); saveQuickEdit(); }
});
document.getElementById('quickEditLine').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeQuickEdit();
  if(e.key === 'Enter'){ e.preventDefault(); saveQuickEdit(); }
});

document.getElementById('activityOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'activityOverlay') document.getElementById('activityOverlay').classList.remove('open');
});

// ---------- Print ----------
const LOGO_SRC = '/assets/logo.png';

// The customer copy has a fixed layout matching the shop's paper service
// card, rather than the configurable field-list the service copy uses.
function buildCustomerPrintDoc(t){
  const tagline = settings.shopTagline
    ? `<div class="card-tagline">${escapeHtml(settings.shopTagline)}</div>` : '';

  const topRows = [
    ['Клиент', escapeHtml(t.customer_name)],
    ['Модел и Марка', escapeHtml(t.phone_model)]
  ].map(([label, value]) => `
    <div class="card-row">
      <span class="card-label">${label}:</span>
      <span class="card-value">${value}</span>
    </div>
  `).join('');

  // The damage description tends to run long, so it gets its own stacked
  // row (label above, full-width value below) with room for two lines,
  // rather than being squeezed into the right-hand column of an inline row.
  const descriptionRow = `
    <div class="card-row-stacked">
      <span class="card-label">Описание на повредата:</span>
      <div class="card-value-block">${escapeHtml(t.description) || '—'}</div>
    </div>
  `;

  const bottomRows = [
    ['Оборотен телефон', escapeHtml(t.loaner_phone)],
    ['Капаро', escapeHtml(fmtKaparo(t.kaparo))],
    ['Дата на приемане', fmtDate(t.date_received)]
  ].map(([label, value]) => `
    <div class="card-row">
      <span class="card-label">${label}:</span>
      <span class="card-value">${value}</span>
    </div>
  `).join('');

  const warningLines = (settings.printCustomer.footer || '')
    .split('\n').filter(Boolean).map(escapeHtml);
  const warning = warningLines.length ? `
    <div class="card-warning">
      ${warningLines.map((line, i) => i === 0 ? `<strong>${line}</strong>` : `<div>${line}</div>`).join('')}
    </div>
  ` : '';

  return `
    <div class="card-header">
      <img src="${LOGO_SRC}" alt="" class="card-logo">
      <div class="card-brand">
        <div class="card-shop-name">${escapeHtml(settings.shopName)}</div>
        ${tagline}
      </div>
      <div class="card-order-no">
        <div class="card-doc-title">${escapeHtml(settings.printCustomer.header)}</div>
        <div>№ ${t.ticket_no}</div>
      </div>
    </div>
    <div class="card-body">${topRows}${descriptionRow}${bottomRows}</div>
    ${warning}
    <div class="card-sign">Подпис на клиента: ____________________</div>
  `;
}

// The service copy is a tiny fixed label meant to be printed on a small
// barcode/label printer and stuck directly onto the phone: just enough to
// identify which order it belongs to and what needs to be fixed.
function buildServiceLabelDoc(t){
  return `
    <div class="label-header">
      <div class="label-shop">${escapeHtml(settings.shopName)}</div>
      <div class="label-order">№ ${t.ticket_no}</div>
      ${t.phone_password ? `<div class="label-password">Парола: ${escapeHtml(t.phone_password)}</div>` : ''}
    </div>
    <div class="label-issue-area">
      <div class="label-issue">${escapeHtml(t.description)}</div>
    </div>
  `;
}

// Both prints are generated as real, exactly-sized PDFs rather than relying
// on the browser's print dialog and CSS @page (which different printers and
// drivers honor inconsistently, especially at small physical sizes).
// html2canvas rasterizes our existing HTML/CSS exactly as the browser
// renders it — including Cyrillic text, no special font embedding needed —
// and jsPDF places that image on a PDF page sized to the precise mm
// dimensions, so the physical output size is guaranteed regardless of the
// printer or OS print settings.
const CUSTOMER_CARD_MM = { width: 100, height: 95 };
const SERVICE_LABEL_MM = { width: 50, height: 30 };
const CAPTURE_SCALE = 4; // renders at 4x resolution for crisp small-format print output

async function renderElementToPdf(el, sizeMm){
  const canvas = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    useCORS: true
  });
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    unit: 'mm',
    format: [sizeMm.width, sizeMm.height],
    // jsPDF silently swaps a [width, height] format to force portrait
    // unless orientation is stated explicitly — without this, a landscape
    // card (wider than tall) ends up on a portrait page and gets clipped.
    orientation: sizeMm.width >= sizeMm.height ? 'landscape' : 'portrait'
  });
  doc.addImage(imgData, 'PNG', 0, 0, sizeMm.width, sizeMm.height);
  window.open(doc.output('bloburl'), '_blank');
}

async function printCopy(kind){
  if(!editingTicket || !settings) return;
  const custEl = document.getElementById('printCustomerTemplate');
  const svcEl = document.getElementById('printServiceTemplate');

  if(kind === 'customer'){
    custEl.innerHTML = buildCustomerPrintDoc(editingTicket);
    const img = custEl.querySelector('img');
    if(img && !img.complete){
      await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }
    await renderElementToPdf(custEl, CUSTOMER_CARD_MM);
  } else {
    svcEl.innerHTML = buildServiceLabelDoc(editingTicket);
    await renderElementToPdf(svcEl, SERVICE_LABEL_MM);
  }
}

// ---------- Wire up ----------
document.getElementById('newTicketBtn').addEventListener('click', openNew);
// The ticket modal has the same buttons at the top and bottom; both sets
// are wired by their data-action.
const MODAL_ACTIONS = {
  'cancel': closeModal,
  'save': saveTicket,
  'delete': deleteTicket,
  'print-customer': ()=>printCopy('customer'),
  'print-service': ()=>printCopy('service')
};
document.querySelectorAll('#overlay [data-action]').forEach(btn=>{
  btn.addEventListener('click', MODAL_ACTIONS[btn.dataset.action]);
});
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') closeModal(); });
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('statusFilter').addEventListener('change', render);
// Marking a ticket "издаден" fills in today's return date (if none is set
// yet), so it's visible and can still be changed before saving.
document.getElementById('f_status').addEventListener('change', (e)=>{
  const returned = document.getElementById('f_date_returned');
  if(e.target.value === COMPLETED_STATUS && !returned.value){
    returned.value = localDateString(new Date());
  }
});
document.getElementById('f_phone').addEventListener('input', (e)=>{
  document.getElementById('f_phone_call').href = telHref(e.target.value);
  markPhoneField();
});

checkSession();
