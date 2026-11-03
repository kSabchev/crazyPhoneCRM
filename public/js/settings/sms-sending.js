// Настройки: where this shop's SMS go from (Изпращане на SMS).

// ---------- Where this shop's SMS go from ----------
// Saved on its own (like accounts). The token and the phone's password are
// never sent back: an empty field keeps what's saved.
const SMS_PROVIDER_NAMES = { phone: 'телефон', smsapi: 'SMSAPI.bg', demo: 'демо' };
let smsSettings = null;

function smsProviderName(p){ return p ? SMS_PROVIDER_NAMES[p] || p : 'изключени'; }

function renderSmsSettings(){
  const s = smsSettings;
  document.getElementById('smsMode').value = s.mode;
  document.getElementById('smsApiSender').value = s.SMSAPI_SENDER;
  document.getElementById('smsApiTest').checked = s.SMSAPI_TEST;
  document.getElementById('smsGatewayUrl').value = s.SMS_GATEWAY_URL;
  document.getElementById('smsGatewayUser').value = s.SMS_GATEWAY_USER;
  for(const [id, key] of [['smsApiToken', 'SMSAPI_TOKEN'], ['smsGatewayPassword', 'SMS_GATEWAY_PASSWORD']]){
    const input = document.getElementById(id);
    input.value = '';
    input.placeholder = s.secrets[key] ? 'запазен — оставете празно, за да остане' : '';
  }
  updateSmsMode();
}

function updateSmsMode(){
  const mode = document.getElementById('smsMode').value;
  document.getElementById('smsOwnFields').style.display = mode === 'own' ? '' : 'none';
  const hint = document.getElementById('smsModeHint');
  if(mode === 'env') hint.textContent = `В .env: ${smsProviderName(smsSettings.envProvider)}.`;
  else if(mode === 'off') hint.textContent = 'Приложението няма да предлага изпращане на SMS в този магазин.';
  else hint.textContent = smsSettings.mode === 'own' ? `Сега: ${smsProviderName(smsSettings.provider)}.` : '';
}
document.getElementById('smsMode').addEventListener('change', updateSmsMode);

async function loadSmsSettings(){
  const res = await fetch('/api/sms/shop-settings');
  if(!res.ok) return;
  smsSettings = await res.json();
  renderSmsSettings();
}

document.getElementById('smsSaveBtn').addEventListener('click', async ()=>{
  const status = document.getElementById('smsSaveStatus');
  const body = {
    mode: document.getElementById('smsMode').value,
    SMSAPI_TOKEN: document.getElementById('smsApiToken').value,
    SMSAPI_SENDER: document.getElementById('smsApiSender').value,
    SMSAPI_TEST: document.getElementById('smsApiTest').checked,
    SMS_GATEWAY_URL: document.getElementById('smsGatewayUrl').value,
    SMS_GATEWAY_USER: document.getElementById('smsGatewayUser').value,
    SMS_GATEWAY_PASSWORD: document.getElementById('smsGatewayPassword').value
  };
  const res = await fetch('/api/sms/shop-settings', {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    status.textContent = data.error || 'SMS настройките не можаха да бъдат запазени.';
    status.style.color = 'var(--status-parts)';
    return;
  }
  smsSettings = data;
  renderSmsSettings();
  loadAdminLog();
  status.textContent = `Запазено. SMS: ${smsProviderName(data.provider)}.`;
  status.style.color = 'var(--status-ready)';
});
