// Настройки: the form as a whole — filling it in, the SMS text counter,
// unsaved changes, save and discard.

// ---------- Filling in the form ----------
function renderAll(){
  document.getElementById('shopNameInput').value = settings.shopName;
  document.getElementById('shopTaglineInput').value = settings.shopTagline || '';
  // Without its own number the shop uses SHOP_PHONE from .env (shopPhone).
  const phone = document.getElementById('shopPhoneInput');
  phone.value = settings.phone || '';
  phone.placeholder = !settings.phone && settings.shopPhone ? `${settings.shopPhone} (от .env)` : 'напр. 0888 123 456';
  renderStatusList();
  renderColumnGrid();
  document.getElementById('custFooter').value = settings.printCustomer.footer;
  document.getElementById('smsTemplateInput').value = settings.smsTemplate || '';
  updateSmsTemplateCounter();
  renderDeviceList();
  document.getElementById('saveStatus').textContent = '';
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
    phone: document.getElementById('shopPhoneInput').value.trim(),
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
  return stableJson(currentDraft()) !== stableJson({ ...originalSettings, shopTagline: originalSettings.shopTagline || '', phone: originalSettings.phone || '' });
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

// ---------- Save / discard ----------
document.getElementById('resetBtn').addEventListener('click', ()=>{
  settings = JSON.parse(JSON.stringify(originalSettings));
  renderAll();
});

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  settings.shopName = document.getElementById('shopNameInput').value.trim() || settings.shopName;
  settings.shopTagline = document.getElementById('shopTaglineInput').value.trim();
  settings.phone = document.getElementById('shopPhoneInput').value.trim();
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
  loadAdminLog();
  renderAll(); // clears the status line, so it's set after
  statusEl.textContent = 'Запазено.';
  statusEl.style.color = 'var(--status-ready)';
});
