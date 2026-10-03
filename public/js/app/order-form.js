// Main page: the order window (new / edit / delete) and the change history.

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
  document.getElementById('f_status').value = (settings && settings.statuses[0]) || STATUSES.FOR_SERVICE;
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
  document.querySelector('#topActions [data-action="delete"]').style.display = isAdmin() ? '' : 'none';
  markPhoneField();
  document.getElementById('deleteBtn').style.display = isAdmin() ? 'inline-block' : 'none';
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
  if(method === 'POST'){
    // A new order: offer the prints first, then (if it was created as
    // "чака клиент") the SMS.
    openPrintOffer(saved, () => offerSmsIfNowWaiting(saved, null));
  } else {
    offerSmsIfNowWaiting(saved, previousStatus);
  }
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

function describeEntry(entry, includeTicketRef){
  const who = escapeHtml(entry.performed_by);
  const when = fmtUtcTime(entry.performed_at);
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
