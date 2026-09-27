let settings = null;
let originalSettings = null;

const COLUMN_LABELS = {
  customer: 'Клиент',
  callBtn: 'Обаждане',
  model: 'Модел',
  issue: 'Проблем',
  comment: 'Коментар',
  repairPerformed: 'Извършен ремонт',
  loanerPhone: 'Оборотен телефон',
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

document.getElementById('backBtn').addEventListener('click', ()=>{ window.location.href = '/'; });
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
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
  renderDeviceList();
  document.getElementById('saveStatus').textContent = '';
}

function renderStatusList(){
  const el = document.getElementById('statusList');
  el.innerHTML = settings.statuses.map((s, i)=>`
    <div class="editable-row">
      <span class="item-text">${escapeHtml(s)}</span>
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
        settings.statuses.splice(i, 1);
      } else if(action === 'up' && i > 0){
        [settings.statuses[i-1], settings.statuses[i]] = [settings.statuses[i], settings.statuses[i-1]];
      } else if(action === 'down' && i < settings.statuses.length - 1){
        [settings.statuses[i+1], settings.statuses[i]] = [settings.statuses[i], settings.statuses[i+1]];
      }
      renderStatusList();
    });
  });
}

document.getElementById('addStatusBtn').addEventListener('click', ()=>{
  const input = document.getElementById('newStatusInput');
  const val = input.value.trim();
  if(!val) return;
  if(settings.statuses.some(s=>s.toLowerCase() === val.toLowerCase())){
    alert('Този статус вече съществува.');
    return;
  }
  settings.statuses.push(val);
  input.value = '';
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
