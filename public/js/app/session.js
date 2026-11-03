// Main page: login, roles, changing your password, live updates.

// ---------- Auth ----------
// Runs when the page opens. Until it answers neither screen is shown, so a
// logged-in user doesn't see the login form flash up first (e.g. coming
// back from Справки or Настройки).
async function checkSession(){
  let data = null;
  try {
    const res = await fetch('/api/auth/me');
    if(res.ok) data = await res.json();
  } catch(_) { /* server unreachable (e.g. restarting): offer the login form */ }
  if(data) showApp(data);
  else showLogin();
}

// ---------- Roles ----------
// Admins: every shop, Settings, Справки, deleting orders. Shop managers: one
// shop, Справки and deleting orders. Staff: one shop, orders only. The
// server enforces this — the page just hides what the account can't use.
const isAdmin = () => currentRole === 'admin';
const canManage = () => currentRole === 'admin' || currentRole === 'shop_manager';
const ROLE_NAMES = { admin: 'Администратор', shop_manager: 'Управител', staff: 'Служител' };

function applyRole(){
  document.getElementById('reportsBtn').style.display = canManage() ? '' : 'none';
  document.getElementById('settingsBtn').style.display = isAdmin() ? '' : 'none';
  const who = document.getElementById('whoAmI');
  who.textContent = currentUsername;
  who.title = `${ROLE_NAMES[currentRole] || ROLE_NAMES.staff} — щракнете за смяна на паролата`;
  document.getElementById('roleTag').textContent = isAdmin() ? '' : (ROLE_NAMES[currentRole] || ROLE_NAMES.staff).toLowerCase();
  renderStoreSwitch();
}

// ---------- Shops ----------
// Admins with more than one shop pick the one the page works on. Picking
// another reloads the page, so everything on it (orders, settings, live
// updates) is that shop's.
function renderStoreSwitch(){
  const select = document.getElementById('storeSwitch');
  const show = isAdmin() && allStores.length > 1;
  select.style.display = show ? '' : 'none';
  if(!show) return;
  select.innerHTML = allStores.map(s =>
    `<option value="${s.id}"${currentStore && s.id === currentStore.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
}
document.getElementById('storeSwitch').addEventListener('change', async (e)=>{
  const res = await fetch('/api/auth/store', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ storeId: Number(e.target.value) })
  });
  if(res.status === 401){ showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    alert(data.error || 'Магазинът не можа да бъде сменен.');
    renderStoreSwitch(); // back to the current shop
    return;
  }
  window.location.reload();
});

// ---------- Change your own password ----------
function openPasswordDialog(){
  for(const id of ['pwCurrent', 'pwNew', 'pwConfirm']) document.getElementById(id).value = '';
  document.getElementById('pwError').textContent = '';
  document.getElementById('passwordOverlay').classList.add('open');
  document.getElementById('pwCurrent').focus();
}
function closePasswordDialog(){
  document.getElementById('passwordOverlay').classList.remove('open');
}
async function savePassword(){
  const current = document.getElementById('pwCurrent').value;
  const next = document.getElementById('pwNew').value;
  const error = document.getElementById('pwError');
  if(next.length < 8){ error.textContent = 'Новата парола трябва да е поне 8 знака.'; return; }
  if(next !== document.getElementById('pwConfirm').value){ error.textContent = 'Новата парола и потвърждението не съвпадат.'; return; }
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ currentPassword: current, newPassword: next })
  });
  if(res.status === 401){ closePasswordDialog(); showLogin(); return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    error.textContent = data.error || 'Паролата не можа да бъде сменена.';
    return;
  }
  closePasswordDialog();
  alert('Паролата е сменена.');
}
document.getElementById('whoAmI').addEventListener('click', openPasswordDialog);
document.getElementById('pwSaveBtn').addEventListener('click', savePassword);
document.getElementById('pwCancelBtn').addEventListener('click', closePasswordDialog);
document.getElementById('passwordOverlay').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closePasswordDialog();
  if(e.key === 'Enter'){ e.preventDefault(); savePassword(); }
});

function showLogin(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
}

// `me`: who's logged in and their shop (/api/auth/me, or the login).
// `justLoggedIn`: from the login form (rather than reopening the page),
// when admins are told about any failed backup straight away.
async function showApp(me, { justLoggedIn = false } = {}){
  currentUsername = me.username;
  currentRole = me.role || 'staff';
  currentStore = me.store || null;
  allStores = me.stores || [];
  applyRole();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  await loadSettings();
  await loadDevices();
  loadSmsConfig();
  loadTickets();
  refreshBackups(justLoggedIn ? 'all' : 'quiet');
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
      if(editingTicket && smsEnabled) loadTicketSms(editingTicket.id);
    } else if(e.data === 'settings'){
      loadSettings().then(()=>{ loadDevices(); render(); });
      loadSmsConfig(); // the shop's SMS settings may have changed
    } else if(e.data === 'backups'){
      refreshBackups('new'); // a backup has run (backups.js)
    }
  };
  // EventSource retries on its own. Changes made while the stream wasn't
  // connected (the moment between page load and connecting, a server
  // restart, Wi-Fi drop, laptop sleep) are never re-sent, so reload
  // everything each time it (re)connects to catch up.
  liveEvents.onopen = ()=>{
    loadSettings().then(()=>{ loadDevices(); loadTickets(); });
    refreshBackups('new'); // a backup may have failed while disconnected
  };
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
    showApp(data, { justLoggedIn: true });
  } else {
    const data = await res.json().catch(()=>({}));
    errEl.textContent = data.error || 'Неуспешен вход.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  disconnectLiveUpdates();
  resetBackups();
  await fetch('/api/auth/logout', { method:'POST' });
  showLogin();
});

document.getElementById('reportsBtn').addEventListener('click', ()=>{
  window.location.href = '/reports.html';
});
document.getElementById('settingsBtn').addEventListener('click', ()=>{
  window.location.href = '/settings.html';
});
