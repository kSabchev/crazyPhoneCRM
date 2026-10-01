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

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Auth / bootstrap ----------
async function init(){
  const meRes = await fetch('/api/auth/me');
  if(!meRes.ok){ window.location.href = '/'; return; }
  const me = await meRes.json();
  document.getElementById('whoAmI').textContent = me.username;

  const res = await fetch('/api/settings');
  settings = await res.json();
  originalSettings = JSON.parse(JSON.stringify(settings));

  document.getElementById('settingsScreen').style.display = 'block';
  renderAll();
}

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
  const latin = /^[\x20-\x7E\r\n]*$/.test(sample);
  const [single, multi] = latin ? [160, 153] : [70, 67];
  const parts = len === 0 ? 0 : (len <= single ? 1 : Math.ceil(len / multi));
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
      header: document.getElementById('custHeader').value,
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
  document.getElementById('custHeader').value = settings.printCustomer.header;
  document.getElementById('custFooter').value = settings.printCustomer.footer;
  document.getElementById('smsTemplateInput').value = settings.smsTemplate || '';
  updateSmsTemplateCounter();
  renderDeviceList();
  document.getElementById('saveStatus').textContent = '';
}

const NEW_STATUS_DEFAULT_COLOR = '#6B7280';

// White or dark text, whichever reads better on the badge colour (same rule
// as the order table).
function readableTextOn(hex){
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#211E1A' : '#FFFFFF';
}

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
      <button class="row-btn remove" data-action="remove" data-index="${i}">Премахни</button>
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
    });
  });
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
  settings.printCustomer.header = document.getElementById('custHeader').value;
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
