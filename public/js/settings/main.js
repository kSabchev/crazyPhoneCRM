// Настройки: start-up — who's logged in, which shop, then every section.

// ---------- Auth / bootstrap ----------
async function init(){
  const meRes = await fetch('/api/auth/me');
  if(!meRes.ok){ window.location.href = '/'; return; }
  const me = await meRes.json();
  // Настройки is for admins only.
  if(me.role !== 'admin'){ window.location.href = '/'; return; }
  currentUserId = null;
  currentUsername = me.username;
  allStores = me.stores || [];
  currentStoreId = me.store.id;
  allShopsView = !!me.allShops;
  // With several shops, the settings saved here are the current shop's.
  document.getElementById('whoAmI').textContent = allStores.length > 1
    ? `${me.username} · ${me.allShops ? 'всички магазини' : me.store.name}` : me.username;
  // The all-shops view: only what every shop shares. A shop's own settings
  // need that shop picked on the main page.
  if(me.allShops){
    document.querySelectorAll('.settings-section[data-scope="shop"]').forEach(s => { s.style.display = 'none'; });
    document.getElementById('allShopsNote').style.display = '';
  }
  renderNewUserShops(me.store.id);
  // With several shops, say which sections are shared and which are this shop's.
  if(allStores.length > 1 && !me.allShops){
    document.querySelectorAll('.settings-section[data-scope] h2').forEach(h => {
      const shared = h.parentElement.dataset.scope === 'shared';
      h.insertAdjacentHTML('beforeend', ` <span class="scope-tag${shared ? ' scope-shared' : ''}">${
        shared ? 'общо за всички магазини' : `само за ${escapeHtml(me.store.name)}`}</span>`);
    });
  }

  const res = await fetch('/api/settings');
  settings = await res.json();
  originalSettings = JSON.parse(JSON.stringify(settings));

  document.getElementById('settingsScreen').style.display = 'block';
  renderAll();
  loadUsers();
  loadSmsSettings();
  loadShops();
  loadAdminLog();
}

init();
