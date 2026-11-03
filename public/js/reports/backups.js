// Справки: the latest backup runs (admins).

// ---------- Backups ----------
// The latest backup runs, recorded by backup.js (newest first): green for a
// successful one, red for a failed one. Not tied to the chosen period.
const NAS_LABEL = { ok: 'копирано', failed: 'неуспешно', off: 'не е настроено' };

function fmtBytes(n){
  if(!(n > 0)) return '—';
  if(n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

async function loadBackups(){
  const res = await fetch('/api/backups');
  if(!res.ok) return;
  const { runs, keep } = await res.json();
  document.getElementById('backupSub').textContent =
    `Последните ${keep} резервни копия на базата данни (правят се автоматично всяка нощ), най-новото най-горе. Не зависи от избрания период.`;
  document.getElementById('backupTable').innerHTML = runs.length
    ? runs.map(r => `<tr class="${r.ok ? 'backup-row-ok' : 'backup-row-failed'}">
        <td class="nowrap">${escapeHtml(fmtIsoTime(r.startedAt))}</td>
        <td><span class="backup-status ${r.ok ? 'backup-status-ok' : 'backup-status-failed'}">${r.ok ? '✓ успешно' : '✗ неуспешно'}</span></td>
        <td class="backup-file">${r.file ? escapeHtml(r.file) : '—'}${(r.shopFiles || []).length
          ? `<div class="muted">+ ${r.shopFiles.length === 1 ? 'още 1 магазин' : `още ${r.shopFiles.length} магазина`}</div>` : ''}</td>
        <td class="num nowrap">${fmtBytes(r.sizeBytes)}</td>
        <td>${escapeHtml(NAS_LABEL[r.nas] || '—')}</td>
        <td class="backup-details">${r.error ? escapeHtml(r.error) : '—'}</td>
      </tr>`).join('')
    : emptyRow(6, 'Все още няма записани резервни копия — ще се появят след следващото нощно копие.');
}
