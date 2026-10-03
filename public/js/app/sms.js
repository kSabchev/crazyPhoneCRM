// Main page: SMS to the customer and the phone/service status indicator.

// ---------- SMS to the customer ----------
// Sent from the shop phone, only after confirming in the window below.
// Offered automatically when an order moves to "чака клиент", and any time
// from the order's "Изпрати SMS" button. Off unless the server has an SMS
// gateway configured.
const WAITING_STATUS = STATUSES.WAITING;
let smsEnabled = false;
let smsTicketId = null;

async function loadSmsConfig(){
  try {
    const res = await fetch('/api/sms/config');
    const cfg = res.ok ? await res.json() : {};
    smsEnabled = cfg.enabled === true;
    document.getElementById('smsViaHint').textContent = cfg.provider === 'smsapi'
      ? 'Изпраща се чрез SMSAPI.bg' : 'Изпраща се от телефона на сервиза';
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

// The same states when SMS goes through SMSAPI.bg instead of the phone.
const SERVICE_STATES = {
  ready:   { cls: 'ok',   label: 'SMS: готов',        text: 'SMSAPI.bg е свързан и готов за изпращане на SMS.' },
  warning: { cls: 'warn', label: 'SMS: внимание',     text: 'SMSAPI.bg е свързан, но' },
  offline: { cls: 'bad',  label: 'SMS: няма връзка',  text: 'SMSAPI.bg не отговаря — проверете интернет връзката на компютъра. SMS няма да бъде изпратен.' },
  auth:    { cls: 'bad',  label: 'SMS: грешни данни', text: 'SMSAPI.bg отказва достъп — проверете API ключа (SMSAPI_TOKEN) в .env.' }
};

function describePhoneStatus(s){
  const states = s.provider === 'smsapi' ? SERVICE_STATES : PHONE_STATES;
  const info = states[s.state];
  if(!info) return null;
  const problems = s.details && s.details.problems && s.details.problems.length ? s.details.problems : [];
  const lines = [s.state === 'warning' && problems.length
    ? `${info.text}${s.provider === 'smsapi' ? ' ' : ': '}${problems.join(', ')}.`
    : info.text];
  const d = s.details || {};
  if(s.provider === 'smsapi'){
    if(d.credit !== null && d.credit !== undefined) lines.push(`Кредит: ${d.credit}`);
    lines.push(`Подател: ${d.sender || 'по подразбиране на SMSAPI'}`);
  }
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
  Pending: 'изчаква изпращане',
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
        <div class="who-when">${fmtUtcTime(m.created_at)} · ${escapeHtml(m.phone)} · ${escapeHtml(m.sent_by)}</div>
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
