let tickets = [];
let editingTicket = null;
let settings = null;
let liveEvents = null;
let currentUsername = null;

const statusStyles = {
  'за сервиз': ['var(--status-forservice)','var(--status-forservice-bg)'],
  'в сервиз': ['var(--status-inservice)','var(--status-inservice-bg)'],
  'чака клиент': ['var(--status-waiting)','var(--status-waiting-bg)'],
  'издаден': ['var(--status-issued)','var(--status-issued-bg)']
};
const FALLBACK_STATUS_STYLE = ['var(--status-neutral)','var(--status-neutral-bg)'];

const COLUMN_KEYS = ['customer','callBtn','model','issue','comment','repairPerformed','loanerPhone','pravim','status','kaparo','servicePrice','customerPrice','dateIn','dateReturned'];

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
    } else if(e.data === 'settings'){
      loadSettings().then(()=>{ loadDevices(); render(); });
    }
  };
  // EventSource retries on its own; no special error handling needed here.
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

// ---------- Settings ----------
async function loadSettings(){
  const res = await fetch('/api/settings');
  if(res.status === 401){ showLogin(); return; }
  settings = await res.json();

  // Status filter dropdown: All, then "in progress" (everything not completed), then each status individually.
  const filterSel = document.getElementById('statusFilter');
  filterSel.innerHTML = '<option value="">Всички статуси</option>' +
    '<option value="__active__">В процес (без завършени)</option>' +
    settings.statuses.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

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

function fmtPrice(v){
  if(v === null || v === undefined || v === '') return '—';
  return Number(v).toFixed(2);
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function render(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusF = document.getElementById('statusFilter').value;
  const visible = settings ? settings.columns : COLUMN_KEYS;

  let filtered = tickets.filter(t=>{
    const matchesQ = !q || [t.customer_name, t.phone_contact, t.phone_model, t.description, ('#'+t.ticket_no)]
      .join(' ').toLowerCase().includes(q);
    const matchesStatus = !statusF || (statusF === '__active__' ? t.status !== COMPLETED_STATUS : t.status === statusF);
    return matchesQ && matchesStatus;
  });

  if(statusF === '__active__'){
    const priority = { 'за сервиз': 0, 'в сервиз': 1, 'чака клиент': 2 };
    filtered = filtered.slice().sort((a, b) => {
      const pa = priority[a.status] ?? 99;
      const pb = priority[b.status] ?? 99;
      return pa - pb;
    });
  }

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
      const [fg,bg] = statusStyles[t.status] || FALLBACK_STATUS_STYLE;
      const editingBadge = (t.editing_by && t.editing_by !== currentUsername)
        ? `<div class="editing-badge">👁 ${escapeHtml(t.editing_by)}</div>` : '';
      return `<tr onclick="openEdit(${t.id})">
        <td class="ticket-no">#${t.ticket_no}${editingBadge}</td>
        <td${dv('customer')}>
          <div class="cust-name">${escapeHtml(t.customer_name)}</div>
          <div class="cust-phone">${escapeHtml(t.phone_contact)}</div>
        </td>
        <td${dv('callBtn')} class="call-cell" onclick="event.stopPropagation()">
          <a href="${telHref(t.phone_contact)}" class="call-icon-btn" title="Обади се на ${escapeHtml(t.phone_contact)}">📞</a>
        </td>
        <td${dv('model')}>${escapeHtml(t.phone_model)}</td>
        <td class="desc-cell"${dv('issue')} title="${escapeHtml(t.description)}">${escapeHtml(t.description) || '—'}</td>
        <td class="desc-cell"${dv('comment')} title="${escapeHtml(t.comment)}">${escapeHtml(t.comment) || '—'}</td>
        <td class="desc-cell"${dv('repairPerformed')} title="${escapeHtml(t.repair_performed)}">${escapeHtml(t.repair_performed) || '—'}</td>
        <td${dv('loanerPhone')}>${escapeHtml(t.loaner_phone)}</td>
        <td${dv('pravim')} class="pravim-cell" onclick="togglePravim(event, ${t.id})"><span class="pravim-toggle pravim-${t.pravim||'circle'}">${PRAVIM_SYMBOLS[t.pravim||'circle']}</span></td>
        <td${dv('status')}><span class="badge" style="color:${fg};background:${bg};">${escapeHtml(t.status)}</span></td>
        <td${dv('kaparo')}>${escapeHtml(t.kaparo)}</td>
        <td class="price"${dv('servicePrice')}>${fmtPrice(t.service_price)}</td>
        <td class="price"${dv('customerPrice')}>${fmtPrice(t.customer_price)}</td>
        <td${dv('dateIn')}>${fmtDate(t.date_received)}</td>
        <td${dv('dateReturned')}>${fmtDate(t.date_returned)}</td>
      </tr>`;
    }).join('');
  }

  renderStats();
}

function renderStats(){
  const total = tickets.length;
  const forService = tickets.filter(t=> t.status === 'за сервиз').length;
  const inService = tickets.filter(t=> t.status === 'в сервиз').length;
  const waiting = tickets.filter(t=> t.status === 'чака клиент').length;
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="num">${total}</div><div class="lbl">общо поръчки</div></div>
    <div class="stat"><div class="num" style="color:var(--status-forservice-text)">${forService}</div><div class="lbl">за сервиз</div></div>
    <div class="stat"><div class="num" style="color:var(--status-inservice-text)">${inService}</div><div class="lbl">в сервиза</div></div>
    <div class="stat"><div class="num" style="color:var(--status-waiting-text)">${waiting}</div><div class="lbl">чакат клиент</div></div>
  `;
}

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
  document.getElementById('f_loaner').value = 'Не';
  setPravimButton('circle');
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('printCustomerBtn').style.display = 'none';
  document.getElementById('printServiceBtn').style.display = 'none';
  document.getElementById('historySection').style.display = 'none';
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
  document.getElementById('f_service_price').value = t.service_price ?? '';
  document.getElementById('f_customer_price').value = t.customer_price ?? '';
  document.getElementById('f_kaparo').value = t.kaparo || 'Не';
  document.getElementById('f_desc').value = t.description || '';
  document.getElementById('f_comment').value = t.comment || '';
  document.getElementById('f_repair').value = t.repair_performed || '';
  document.getElementById('f_loaner').value = t.loaner_phone || 'Не';
  setPravimButton(t.pravim || 'circle');
  setEditOnlyFieldsVisible(true);
  document.getElementById('deleteBtn').style.display = 'inline-block';
  document.getElementById('printCustomerBtn').style.display = 'inline-block';
  document.getElementById('printServiceBtn').style.display = 'inline-block';
  document.getElementById('overlay').classList.add('open');

  document.getElementById('historySection').style.display = 'block';
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
    loanerPhone: document.getElementById('f_loaner').value.trim(),
    pravim: document.getElementById('f_pravim').dataset.value
  };
}

async function saveTicket(){
  const payload = collectForm();
  if(!payload.customerName || !payload.phoneContact || !payload.phoneModel || !payload.description){
    alert('Моля, попълнете име на клиента, телефон за контакт, модел на телефона и описание на проблема.');
    return;
  }

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

  closeModal();
  loadTickets();
  loadDevices();
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
  } else if(entry.action === 'deleted'){
    body = `Изтри поръчката (${escapeHtml(entry.changes.customer_name || '')}, ${escapeHtml(entry.changes.phone_model || '')}).`;
  } else {
    const lines = Object.entries(entry.changes).map(([field, {from, to}])=>{
      const label = FIELD_LABELS[field] || field;
      const fromV = field === 'pravim' ? (PRAVIM_SYMBOLS[from] || '—') : ((from === null || from === '') ? '—' : escapeHtml(String(from)));
      const toV = field === 'pravim' ? (PRAVIM_SYMBOLS[to] || '—') : ((to === null || to === '') ? '—' : escapeHtml(String(to)));
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
    ['Капаро', escapeHtml(t.kaparo)],
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
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn').addEventListener('click', saveTicket);
document.getElementById('deleteBtn').addEventListener('click', deleteTicket);
document.getElementById('printCustomerBtn').addEventListener('click', ()=>printCopy('customer'));
document.getElementById('printServiceBtn').addEventListener('click', ()=>printCopy('service'));
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay') closeModal(); });
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('statusFilter').addEventListener('change', render);
document.getElementById('f_phone').addEventListener('input', (e)=>{
  document.getElementById('f_phone_call').href = telHref(e.target.value);
});

checkSession();
