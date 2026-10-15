// Main page: warnings about failed backups (admins only). The full list,
// green / red, is at the bottom of Справки.
//
// - A red ⚠ sign left of the counters while any of the latest backups
//   failed; clicking it shows the notice again.
// - The notice itself pops up right after logging in if any of them
//   failed, and whenever a new failed backup appears while you're logged
//   in (the server says "backups" over the live updates when a backup has
//   run, and the check is repeated after reconnecting).
let backupRuns = [];
// Failed runs already announced or known (by start time); null until the
// first check after the page opens, which never announces by itself.
let knownFailures = null;

const failedRuns = () => backupRuns.filter(r => !r.ok);

// announce: 'all'  — show the notice if any of the latest runs failed (login)
//           'new'  — only if a failed run appeared since the last check
//           'quiet'— just update the sign (the page was reopened)
async function refreshBackups(announce){
  if(!isAdmin()){ updateBackupSign(); return; }
  try {
    const res = await fetch('/api/backups');
    if(!res.ok) return;
    backupRuns = (await res.json()).runs;
  } catch(_) { return; /* a convenience: never get in the way */ }

  const failed = failedRuns();
  const isNew = knownFailures !== null && failed.some(r => !knownFailures.has(r.startedAt));
  knownFailures = new Set([...(knownFailures || []), ...failed.map(r => r.startedAt)]);
  updateBackupSign();
  if(failed.length && (announce === 'all' || (announce === 'new' && isNew))) openBackupAlert();
}

function updateBackupSign(){
  const failed = isAdmin() ? failedRuns() : [];
  const sign = document.getElementById('backupWarning');
  sign.style.display = failed.length ? '' : 'none';
  sign.title = `${failed.length === 1 ? 'Неуспешно резервно копие' : `${failed.length} неуспешни резервни копия`} — щракнете за подробности`;
  sign.setAttribute('aria-label', sign.title);
}

function openBackupAlert(){
  const failed = failedRuns();
  if(!failed.length) return;
  document.getElementById('backupAlertSub').textContent = failed.length === 1
    ? `1 от последните ${backupRuns.length} резервни копия е неуспешно:`
    : `${failed.length} от последните ${backupRuns.length} резервни копия са неуспешни:`;
  document.getElementById('backupAlertList').innerHTML = failed.map(r =>
    `<li><strong>${escapeHtml(fmtIsoTime(r.startedAt))}</strong> — ${escapeHtml(r.error || 'неизвестна грешка')}</li>`).join('');
  document.getElementById('backupAlertOverlay').classList.add('open');
  document.getElementById('backupAlertDoneBtn').focus();
}

function closeBackupAlert(){
  document.getElementById('backupAlertOverlay').classList.remove('open');
}

// Logging out: forget everything, so the next login starts fresh.
function resetBackups(){
  backupRuns = [];
  knownFailures = null;
  closeBackupAlert();
  updateBackupSign();
}

document.getElementById('backupWarning').addEventListener('click', openBackupAlert);
document.getElementById('backupAlertDoneBtn').addEventListener('click', closeBackupAlert);
document.getElementById('backupAlertOverlay').addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeBackupAlert(); });
