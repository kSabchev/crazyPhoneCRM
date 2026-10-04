let settings = null;
let originalSettings = null;

const COLUMN_LABELS = {
  customer: 'Клиент',
  callBtn: 'Обаждане',
  model: 'Модел',
  issue: 'Проблем',
  password: 'Парола',
  comment: 'Коментар',
  repairPerformed: 'Извършен ремонт',
  loanerPhone: 'Об. тел (оборотен телефон)',
  pravim: 'Правим',
  status: 'Статус',
  kaparo: 'Капаро',
  servicePrice: 'Изкупна цена',
  customerPrice: 'Продажна цена',
  dateIn: 'Дата на приемане',
  dateReturned: 'Дата на връщане'
};

// ---------- Auth / bootstrap ----------
async function init(){
  const meRes = await fetch('/api/auth/me');
  if(!meRes.ok){ window.location.href = '/'; return; }
  const me = await meRes.json();
  // Настройки is for admins only.
  if(me.role !== 'admin'){ window.location.href = '/'; return; }
  currentUserId = null;
  currentUsername = me.username;
  document.getElementById('whoAmI').textContent = me.username;

  const res = await fetch('/api/settings');
  settings = await res.json();
  originalSettings = JSON.parse(JSON.stringify(settings));

  document.getElementById('settingsScreen').style.display = 'block';
  renderAll();
  loadUsers();
}

// ---------- Accounts ----------
// Managed separately from the other settings: each change is saved
// straight away and isn't part of "Запази промените".
let currentUsername = null;
let currentUserId = null;
const ROLE_LABELS = { admin: 'администратор', staff: 'служител' };

function userError(text){ document.getElementById('userError').textContent = text || ''; }

async function usersRequest(url, options){
  const res = await fetch(url, options);
  if(res.status === 401 || res.status === 403){ window.location.href = '/'; return null; }
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ userError(data.error || 'Промяната не можа да бъде запазена.'); return null; }
  userError('');
  return data;
}

async function loadUsers(){
  const users = await usersRequest('/api/users');
  if(!users) return;
  const me = users.find(u => u.username === currentUsername);
  currentUserId = me ? me.id : null;
  const el = document.getElementById('userList');
  el.innerHTML = users.map(u => {
    const self = u.id === currentUserId;
    return `
    <div class="editable-row user-row" data-id="${u.id}">
      <span class="item-text">${escapeHtml(u.username)}${self ? ' <span class="muted">(вие)</span>' : ''}</span>
      <select class="user-role" ${self ? 'disabled title="Не можете да смените собствената си роля"' : ''}>
        ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}"${u.role === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="row-btn" data-action="password">Нова парола</button>
      ${self ? '<span class="row-lock" title="Не можете да премахнете собствения си профил">—</span>'
             : '<button class="row-btn remove" data-action="remove">Премахни</button>'}
    </div>`;
  }).join('');

  el.querySelectorAll('.user-row').forEach(row => {
    const id = Number(row.dataset.id);
    const name = row.querySelector('.item-text').textContent.replace(' (вие)', '');
    row.querySelector('.user-role').addEventListener('change', async (e) => {
      const ok = await usersRequest(`/api/users/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: e.target.value })
      });
      loadUsers(); // re-render either way (reverts the dropdown on error)
      return ok;
    });
    row.querySelector('[data-action="password"]').addEventListener('click', async () => {
      const pw = prompt(`Нова парола за „${name}“ (поне 8 знака):`);
      if(pw === null) return;
      const ok = await usersRequest(`/api/users/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: pw })
      });
      if(ok) alert(`Паролата на „${name}“ е сменена.`);
    });
    const remove = row.querySelector('[data-action="remove"]');
    if(remove) remove.addEventListener('click', async () => {
      if(!confirm(`Да се премахне ли профилът „${name}“? Той ще бъде изведен от системата.`)) return;
      if(await usersRequest(`/api/users/${id}`, { method: 'DELETE' })) loadUsers();
    });
  });
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const created = await usersRequest('/api/users', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password, role })
  });
  if(!created) return;
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserRole').value = 'staff';
  loadUsers();
});

// ---------- SMS text ----------
// Counter for the SMS template, with sample values in place of the
// placeholders (Cyrillic: 70 characters per SMS, 67 per part when longer).
function updateSmsTemplateCounter(){
  const sample = document.getElementById('smsTemplateInput').value.trim()
    .replace(/\{номер\}/g, '1234')
    .replace(/\{клиент\}/g, 'Иван Петров')
    .replace(/\{модел\}/g, 'Samsung Galaxy S24')
    .replace(/\{магазин\}/g, document.getElementById('shopNameInput').value.trim() || settings.shopName);
  const len = [...sample].length;
  const parts = smsParts(sample);
  const counter = document.getElementById('smsTemplateCounter');
  counter.textContent = `≈ ${len} знака · ${parts} SMS (с примерни данни)`;
  counter.classList.toggle('multi', parts > 1);
}
document.getElementById('smsTemplateInput').addEventListener('input', updateSmsTemplateCounter);

// ---------- Unsaved changes ----------
// The settings as they'd be saved right now: the edited lists plus the text
// fields, which are only copied into `settings` when saving.
function currentDraft(){
  return {
    ...settings,
    shopName: document.getElementById('shopNameInput').value.trim() || settings.shopName,
    shopTagline: document.getElementById('shopTaglineInput').value.trim(),
    printCustomer: {
      footer: document.getElementById('custFooter').value
    },
    smsTemplate: document.getElementById('smsTemplateInput').value.trim() || settings.smsTemplate
  };
}

// JSON with object keys sorted, so the same settings always compare equal
// regardless of the order things were added in.
function stableJson(value){
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if(value && typeof value === 'object'){
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hasUnsavedChanges(){
  if(!settings || !originalSettings) return false;
  return stableJson(currentDraft()) !== stableJson({ ...originalSettings, shopTagline: originalSettings.shopTagline || '' });
}

const UNSAVED_MESSAGE = 'Имате незапазени промени в настройките. Да се напусне ли страницата без запазване?';
let leaveConfirmed = false;

// In-app links: our own confirmation. Closing the tab / reloading: the
// browser's built-in "leave site?" dialog (its text can't be customised).
function confirmLeave(){
  if(!hasUnsavedChanges()) return true;
  leaveConfirmed = confirm(UNSAVED_MESSAGE);
  return leaveConfirmed;
}
window.addEventListener('beforeunload', (e)=>{
  if(leaveConfirmed || !hasUnsavedChanges()) return;
  e.preventDefault();
  e.returnValue = '';
});

document.getElementById('backBtn').addEventListener('click', ()=>{
  if(!confirmLeave()) return;
  window.location.href = '/';
});
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  if(!confirmLeave()) return;
  await fetch('/api/auth/logout', { method:'POST' });
  window.location.href = '/';
});

// ---------- Render ----------
function renderAll(){
  document.getElementById('shopNameInput').value = settings.shopName;
  document.getElementById('shopTaglineInput').value = settings.shopTagline || '';
  renderStatusList();
  renderColumnGrid();
  document.getElementById('custFooter').value = settings.printCustomer.footer;
  document.getElementById('smsTemplateInput').value = settings.smsTemplate || '';
  updateSmsTemplateCounter();
  renderDeviceList();
  document.getElementById('saveStatus').textContent = '';
}

const NEW_STATUS_DEFAULT_COLOR = '#6B7280';

function statusColor(s){
  return (settings.statusColors && settings.statusColors[s]) || NEW_STATUS_DEFAULT_COLOR;
}

function renderStatusList(){
  const el = document.getElementById('statusList');
  settings.statusColors = settings.statusColors || {};
  el.innerHTML = settings.statuses.map((s, i)=>`
    <div class="editable-row">
      <span class="item-text"><span class="badge status-preview" style="background:${statusColor(s)};color:${readableTextOn(statusColor(s))}">${escapeHtml(s)}</span></span>
      <input type="color" class="status-color" data-index="${i}" value="${statusColor(s)}" title="Цвят на „${escapeHtml(s)}“" aria-label="Цвят на ${escapeHtml(s)}">
      <button class="row-btn" data-action="up" data-index="${i}" ${i===0?'disabled':''}>↑</button>
      <button class="row-btn" data-action="down" data-index="${i}" ${i===settings.statuses.length-1?'disabled':''}>↓</button>
      ${STATUSES.SYSTEM.includes(s)
        ? `<span class="row-lock" title="Системен статус — ${escapeHtml(STATUSES.PURPOSE[s])}. Може да се пренарежда и да му се сменя цветът, но не и да се премахва.">🔒 системен</span>`
        : `<button class="row-btn remove" data-action="remove" data-index="${i}">Премахни</button>`}
    </div>
  `).join('');

  el.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const i = Number(btn.getAttribute('data-index'));
      const action = btn.getAttribute('data-action');
      if(action === 'remove'){
        if(settings.statuses.length <= 1){ alert('Трябва да има поне един статус.'); return; }
        const [removed] = settings.statuses.splice(i, 1);
        delete settings.statusColors[removed];
      } else if(action === 'up' && i > 0){
        [settings.statuses[i-1], settings.statuses[i]] = [settings.statuses[i], settings.statuses[i-1]];
      } else if(action === 'down' && i < settings.statuses.length - 1){
        [settings.statuses[i+1], settings.statuses[i]] = [settings.statuses[i], settings.statuses[i+1]];
      }
      renderStatusList();
    });
  });

  // Recolour live: update the stored colour and the preview badge.
  el.querySelectorAll('input.status-color').forEach(picker=>{
    picker.addEventListener('input', ()=>{
      const status = settings.statuses[Number(picker.dataset.index)];
      settings.statusColors[status] = picker.value;
      const preview = picker.parentElement.querySelector('.status-preview');
      preview.style.background = picker.value;
      preview.style.color = readableTextOn(picker.value);
      renderRules();
    });
  });
  renderRules();
}

// ---------- Automatic rules (read-only) ----------
// What the app does by itself on a status change (status-rules.js — the
// same list the server and the order form use), with each status's badge.
function renderRules(){
  document.getElementById('ruleList').innerHTML = STATUS_RULES.RULES.map(r=>{
    const bg = statusColor(r.status);
    return `<li class="rule-item">
      <span class="badge" style="background:${bg};color:${readableTextOn(bg)}">${escapeHtml(r.status)}</span>
      <span class="rule-text"><span class="rule-when">${escapeHtml(r.when)}:</span> ${escapeHtml(r.text)}</span>
    </li>`;
  }).join('');
}

document.getElementById('addStatusBtn').addEventListener('click', ()=>{
  const input = document.getElementById('newStatusInput');
  const colorInput = document.getElementById('newStatusColor');
  const val = input.value.trim();
  if(!val) return;
  if(settings.statuses.some(s=>s.toLowerCase() === val.toLowerCase())){
    alert('Този статус вече съществува.');
    return;
  }
  settings.statuses.push(val);
  settings.statusColors[val] = colorInput.value;
  input.value = '';
  colorInput.value = NEW_STATUS_DEFAULT_COLOR;
  renderStatusList();
});

function renderColumnGrid(){
  const el = document.getElementById('columnGrid');
  el.innerHTML = Object.entries(COLUMN_LABELS).map(([key, label])=>`
    <label class="checkbox-item">
      <input type="checkbox" data-col="${key}" ${settings.columns.includes(key) ? 'checked' : ''}>
      ${escapeHtml(label)}
    </label>
  `).join('');

  el.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const key = cb.getAttribute('data-col');
      if(cb.checked){
        if(!settings.columns.includes(key)) settings.columns.push(key);
      } else {
        settings.columns = settings.columns.filter(c=>c!==key);
      }
    });
  });
}

function renderDeviceList(){
  const el = document.getElementById('deviceList');
  el.innerHTML = settings.devices.map((d, i)=>`
    <div class="editable-row">
      <span class="item-text">${escapeHtml(d)}</span>
      <button class="row-btn remove" data-index="${i}">Премахни</button>
    </div>
  `).join('');

  el.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const i = Number(btn.getAttribute('data-index'));
      settings.devices.splice(i, 1);
      renderDeviceList();
    });
  });
}

document.getElementById('addDeviceBtn').addEventListener('click', ()=>{
  const input = document.getElementById('newDeviceInput');
  const val = input.value.trim();
  if(!val) return;
  if(settings.devices.some(d=>d.toLowerCase() === val.toLowerCase())){
    alert('Този модел вече е в списъка.');
    return;
  }
  settings.devices.push(val);
  settings.devices.sort((a,b)=>a.localeCompare(b));
  input.value = '';
  renderDeviceList();
});

// ---------- Save / discard ----------
document.getElementById('resetBtn').addEventListener('click', ()=>{
  settings = JSON.parse(JSON.stringify(originalSettings));
  renderAll();
});

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  settings.shopName = document.getElementById('shopNameInput').value.trim() || settings.shopName;
  settings.shopTagline = document.getElementById('shopTaglineInput').value.trim();
  settings.printCustomer.footer = document.getElementById('custFooter').value;
  settings.smsTemplate = document.getElementById('smsTemplateInput').value.trim() || settings.smsTemplate;

  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = 'Запазване…';
  statusEl.style.color = 'var(--ink-soft)';

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(settings)
  });

  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    statusEl.textContent = data.error || 'Настройките не можаха да бъдат запазени.';
    statusEl.style.color = 'var(--status-parts)';
    return;
  }

  settings = await res.json();
  originalSettings = JSON.parse(JSON.stringify(settings));
  statusEl.textContent = 'Запазено.';
  statusEl.style.color = 'var(--status-ready)';
  renderAll();
  document.getElementById('saveStatus').textContent = 'Запазено.';
  document.getElementById('saveStatus').style.color = 'var(--status-ready)';
});

init();
