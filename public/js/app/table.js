// Main page: settings, the order table (sorting, compact view, cards on
// phones), quick status changes and the header counters.

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

// ---------- Compact view ----------
// One line per order: tighter spacing, long texts cut short ("…", full
// text on hover). Remembered per browser. (Phones use cards instead.)
function setCompact(on){
  document.getElementById('ticketTable').classList.toggle('compact', on);
  const btn = document.getElementById('compactToggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
  try { localStorage.setItem('compactTable', on ? '1' : '0'); } catch(_) {}
}
document.getElementById('compactToggle').addEventListener('click', ()=>{
  setCompact(!document.getElementById('ticketTable').classList.contains('compact'));
});
setCompact((()=>{ try { return localStorage.getItem('compactTable') === '1'; } catch(_) { return false; } })());

// Labels for the phone card layout ("Модел: iPhone 13").
const CELL_LABELS = {
  customer: 'Клиент', callBtn: 'Обаждане', model: 'Модел', issue: 'Проблем', password: 'Парола',
  comment: 'Коментар', repairPerformed: 'Ремонт', loanerPhone: 'Об. тел', pravim: 'Правим', status: 'Статус',
  kaparo: 'Капаро', servicePrice: 'Изкупна', customerPrice: 'Цена', dateIn: 'Приета', dateReturned: 'Върната'
};

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
    // Each cell names its field and label: the phone card layout shows
    // "label: value" lines, and hidden columns stay hidden there too.
    const dv = (key) => ` data-field="${key}" data-label="${CELL_LABELS[key]}"${visible.includes(key) ? '' : ' style="display:none;"'}`;
    body.innerHTML = filtered.map(t=>{
      const [fg,bg] = statusBadgeColors(t.status);
      const editingBadge = (t.editing_by && t.editing_by !== currentUsername)
        ? `<div class="editing-badge">👁 ${escapeHtml(t.editing_by)}</div>` : '';
      return `<tr data-id="${t.id}">
        <td class="ticket-no" data-field="number">#${t.ticket_no}${editingBadge}</td>
        <td${dv('customer')}>
          <div class="cust-name">${escapeHtml(t.customer_name)}</div>
          <div class="cust-phone${isStandardPhone(t.phone_contact) ? '' : ' phone-nonstandard'}"${isStandardPhone(t.phone_contact) ? '' : ` title="${PHONE_HINT}"`}>${escapeHtml(t.phone_contact)}</div>
        </td>
        <td${dv('callBtn')} class="call-cell">
          <a href="${telHref(t.phone_contact)}" class="call-icon-btn" title="Обади се на ${escapeHtml(t.phone_contact)}">📞</a>
        </td>
        <td${dv('model')}>${escapeHtml(t.phone_model)}</td>
        <td class="desc-cell"${dv('issue')} title="${escapeHtml(t.description)}">${escapeHtml(t.description) || '—'}</td>
        <td class="password-cell quick-edit-cell"${dv('password')} data-quick="phonePassword" title="Щракнете, за да промените паролата">${t.phone_password ? `<span class="password-value">${escapeHtml(t.phone_password)}</span>` : '—'}</td>
        <td class="desc-cell quick-edit-cell comment-cell"${dv('comment')} data-quick="comment" title="${escapeHtml(t.comment) || 'Щракнете, за да добавите коментар'}">${escapeHtml(t.comment) || '—'}</td>
        <td class="desc-cell quick-edit-cell repair-cell"${dv('repairPerformed')} data-quick="repairPerformed" title="${escapeHtml(t.repair_performed) || 'Щракнете, за да добавите извършен ремонт'}">${escapeHtml(t.repair_performed) || '—'}</td>
        <td${dv('loanerPhone')}>${escapeHtml(t.loaner_phone)}</td>
        <td${dv('pravim')} class="pravim-cell"><span class="pravim-toggle pravim-${t.pravim||'circle'}">${PRAVIM_SYMBOLS[t.pravim||'circle']}</span></td>
        <td${dv('status')} class="status-cell">${
          quickStatusId === t.id
            ? statusSelectHtml(t)
            : `<span class="badge" style="color:${fg};background:${bg};" title="Щракнете за смяна на статуса">${escapeHtml(t.status)}</span>`
        }</td>
        <td class="price${kaparoCoversPrice(t) ? ' kaparo-paid' : ''}"${dv('kaparo')}>${escapeHtml(fmtKaparo(t.kaparo))}</td>
        <td class="price quick-edit-cell service-price-cell"${dv('servicePrice')} data-quick="servicePrice" title="Щракнете, за да промените изкупната цена">${fmtPrice(t.service_price)}</td>
        <td class="price quick-edit-cell customer-price-cell"${dv('customerPrice')} data-quick="customerPrice" title="Щракнете, за да промените продажната цена">${fmtPrice(t.customer_price)}</td>
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
  return `<select class="status-select" aria-label="Статус на поръчка #${t.ticket_no}">
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

// ---------- Clicks in the table ----------
// One listener for the whole table instead of onclick="…" on every row
// and cell (which a strict Content-Security-Policy would block). Each row
// carries its order's id (data-id); what a click does depends on the cell:
// the editable ones carry data-quick with the field they edit.
const tableBody = document.getElementById('tableBody');
tableBody.addEventListener('click', (e)=>{
  const row = e.target.closest('tr[data-id]');
  if(!row) return;
  const id = Number(row.dataset.id);
  const cell = e.target.closest('td');
  if(cell && cell.classList.contains('call-cell')){ e.stopPropagation(); return; } // the 📞 link works by itself
  if(cell && cell.dataset.quick) return openQuickEdit(e, id, cell.dataset.quick);
  if(cell && cell.classList.contains('pravim-cell')) return togglePravim(e, id);
  if(cell && cell.classList.contains('status-cell')) return startStatusEdit(e, id);
  openEdit(id);
});
tableBody.addEventListener('change', (e)=>{
  if(!e.target.matches('.status-select')) return;
  saveQuickStatus(Number(e.target.closest('tr[data-id]').dataset.id), e.target.value);
});
tableBody.addEventListener('keydown', (e)=>{
  if(e.target.matches('.status-select') && e.key === 'Escape') cancelStatusEdit();
});

// Header counters, each a shortcut: clicking one filters the table to that
// status ("общо поръчки" shows all); clicking the active one again clears it.
const STAT_COUNTERS = [
  { filter: '',             label: 'общо поръчки', color: null },
  { filter: STATUSES.FOR_SERVICE, label: 'за сервиз',    color: 'var(--status-forservice-text)' },
  { filter: STATUSES.IN_SERVICE,  label: 'в сервиза',    color: 'var(--status-inservice-text)' },
  { filter: STATUSES.WAITING,     label: 'чакат клиент', color: 'var(--status-waiting-text)' },
  { filter: COMPLETED_STATUS, label: 'издадени',     color: 'var(--status-issued-text)' },
  { filter: STATUSES.REFUSED,     label: 'отказани',     color: 'var(--status-refused-bg)' },
  { filter: STATUSES.FORGOTTEN,   label: 'забравени',    color: 'var(--status-forgotten-bg)' }
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
