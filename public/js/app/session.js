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
  if(data) showApp(data.username, data.role);
  else showLogin();
}

// ---------- Roles ----------
// Admins can delete orders, open Settings and Справки; staff can't. The
// server enforces this — the page just hides what staff can't use.
const isAdmin = () => currentRole === 'admin';

function applyRole(){
  for(const id of ['reportsBtn', 'settingsBtn']){
    document.getElementById(id).style.display = isAdmin() ? '' : 'none';
  }
  const who = document.getElementById('whoAmI');
  who.textContent = currentUsername;
  who.title = `${isAdmin() ? 'Администратор' : 'Служител'} — щракнете за смяна на паролата`;
  document.getElementById('roleTag').textContent = isAdmin() ? '' : 'служител';
}

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

async function showApp(username, role){
  currentUsername = username;
  currentRole = role || 'staff';
  applyRole();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  await loadSettings();
  await loadDevices();
  loadSmsConfig();
  loadTickets();
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
    }
  };
  // EventSource retries on its own. Changes made while the stream wasn't
  // connected (the moment between page load and connecting, a server
  // restart, Wi-Fi drop, laptop sleep) are never re-sent, so reload
  // everything each time it (re)connects to catch up.
  liveEvents.onopen = ()=>{
    loadSettings().then(()=>{ loadDevices(); loadTickets(); });
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
    showApp(data.username, data.role);
    if(data.role === 'admin') checkBackupsAfterLogin(); // only right after logging in
  } else {
    const data = await res.json().catch(()=>({}));
    errEl.textContent = data.error || 'Неуспешен вход.';
  }
});

// ---------- Failed backups notice ----------
// Right after an admin logs in: if any of the latest backups failed, say so.
// The full list (green / red) is at the bottom of Справки.
async function checkBackupsAfterLogin(){
  try {
    const res = await fetch('/api/backups');
    if(!res.ok) return;
    const { runs } = await res.json();
    const failed = runs.filter(r => !r.ok);
    if(!failed.length) return;
    document.getElementById('backupAlertSub').textContent = failed.length === 1
      ? `1 от последните ${runs.length} резервни копия е неуспешно:`
      : `${failed.length} от последните ${runs.length} резервни копия са неуспешни:`;
    document.getElementById('backupAlertList').innerHTML = failed.map(r =>
      `<li><strong>${escapeHtml(fmtIsoTime(r.startedAt))}</strong> — ${escapeHtml(r.error || 'неизвестна грешка')}</li>`).join('');
    document.getElementById('backupAlertOverlay').classList.add('open');
    document.getElementById('backupAlertDoneBtn').focus();
  } catch(_) { /* the notice is a convenience: never block logging in */ }
}
function closeBackupAlert(){
  document.getElementById('backupAlertOverlay').classList.remove('open');
}
document.getElementById('backupAlertDoneBtn').addEventListener('click', closeBackupAlert);
document.getElementById('backupAlertOverlay').addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeBackupAlert(); });

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  disconnectLiveUpdates();
  await fetch('/api/auth/logout', { method:'POST' });
  showLogin();
});

document.getElementById('reportsBtn').addEventListener('click', ()=>{
  window.location.href = '/reports.html';
});
document.getElementById('settingsBtn').addEventListener('click', ()=>{
  window.location.href = '/settings.html';
});
