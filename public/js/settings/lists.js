// Настройки: statuses and their colours, the automatic rules, table columns
// and phone models — edited here, saved with "Запази промените" (form.js).

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
