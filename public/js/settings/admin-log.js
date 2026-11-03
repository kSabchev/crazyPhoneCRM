// Настройки: the admin log.

// ---------- Admin log ----------
// Changes to shops, accounts and settings (lib/admin-log.js), described in
// words. Reloaded after every change made on this page.
const ROLE_NAMES_LOG = { admin: 'администратор', shop_manager: 'управител', staff: 'служител' };
const SETTING_LABELS = {
  shopName: 'име', shopTagline: 'слоган', phone: 'телефон', smsTemplate: 'текст на SMS',
  printFooter: 'предупреждение на разпечатката', statuses: 'статуси', columns: 'колони',
  devices: 'модели телефони', statusColors: 'цветове'
};
const SMS_MODE_NAMES = { env: 'както в .env', own: 'собствени', off: 'изключени' };
const SECRET_WORDS = { set: 'зададен', changed: 'сменен', removed: 'премахнат' };
const quoted = v => `„${escapeHtml(v === '' || v === null || v === undefined ? '—' : String(v))}“`;

function describeSettingChange(key, c){
  const label = SETTING_LABELS[key] || key;
  if(key === 'statusColors'){
    return Object.entries(c).map(([s, v]) => `цвят на ${quoted(s)}: ${escapeHtml(v.from)} → ${escapeHtml(v.to)}`).join('; ');
  }
  if(c.added || c.removed){
    if(c.reordered) return `${label}: пренаредени`;
    const parts = [...c.added.map(x => `+ ${escapeHtml(x)}`), ...c.removed.map(x => `− ${escapeHtml(x)}`)];
    return `${label}: ${parts.join(', ')}`;
  }
  // Long texts: just that they changed.
  if(key === 'smsTemplate' || key === 'printFooter') return `${label}: променен`;
  return `${label}: ${quoted(c.from)} → ${quoted(c.to)}`;
}

function describeAdminEntry(e){
  const d = e.details || {};
  const ch = d.changes || {};
  switch(e.action){
    case 'shop_added': return `Добави магазин ${quoted(d.name)}${d.prefix ? ` (префикс ${escapeHtml(d.prefix)})` : ''}.`;
    case 'shop_changed': return 'Промени магазина: ' + [
      ch.name ? `име ${quoted(ch.name.from)} → ${quoted(ch.name.to)}` : '',
      ch.prefix ? `префикс ${quoted(ch.prefix.from)} → ${quoted(ch.prefix.to)}` : ''
    ].filter(Boolean).join('; ') + '.';
    case 'shop_archived': return `Архивира магазин ${quoted(d.name)}.`;
    case 'shop_restored': return `Възстанови магазин ${quoted(d.name)}.`;
    case 'user_added': return `Добави профил ${quoted(d.username)} (${ROLE_NAMES_LOG[d.role] || escapeHtml(d.role)}${d.store ? `, ${escapeHtml(d.store)}` : ''}).`;
    case 'user_changed': return `Промени профил ${quoted(d.username)}: ` + [
      ch.role ? `роля ${ROLE_NAMES_LOG[ch.role.from] || ch.role.from} → ${ROLE_NAMES_LOG[ch.role.to] || ch.role.to}` : '',
      ch.store ? `магазин ${quoted(ch.store.from || 'всички')} → ${quoted(ch.store.to || 'всички')}` : '',
      ch.password ? 'нова парола' : ''
    ].filter(Boolean).join('; ') + '.';
    case 'user_removed': return `Премахна профил ${quoted(d.username)} (${ROLE_NAMES_LOG[d.role] || escapeHtml(d.role)}).`;
    case 'password_changed': return 'Смени собствената си парола.';
    case 'settings_changed': return 'Промени настройките: ' + Object.entries(ch).map(([k, c]) => describeSettingChange(k, c)).join('; ') + '.';
    case 'sms_settings_changed': return 'Промени изпращането на SMS: ' + Object.entries(ch).map(([k, c]) => {
      if(c.secret) return `${escapeHtml(k)} ${SECRET_WORDS[c.secret] || c.secret}`;
      if(k === 'mode') return `${SMS_MODE_NAMES[c.from] || c.from} → ${SMS_MODE_NAMES[c.to] || c.to}`;
      return `${escapeHtml(k)} ${quoted(c.from)} → ${quoted(c.to)}`;
    }).join('; ') + '.';
    default: return escapeHtml(e.action);
  }
}

async function loadAdminLog(){
  const res = await fetch('/api/admin-log');
  if(!res.ok) return;
  const entries = await res.json();
  document.getElementById('adminLog').innerHTML = entries.length
    ? entries.map(e => `
      <div class="admin-log-entry" data-action="${escapeHtml(e.action)}">
        <div class="who-when">${escapeHtml(e.performed_by)} · ${escapeHtml(new Date(e.performed_at.replace(' ', 'T') + 'Z').toLocaleString('bg-BG'))}${e.store_name ? ` · <span class="shop-tag">${escapeHtml(e.store_name)}</span>` : ''}</div>
        <div>${describeAdminEntry(e)}</div>
      </div>`).join('')
    : '<div class="muted">Още няма записани промени.</div>';
}
