// Настройки: the shops (Магазини).

// ---------- Shops ----------
// Saved straight away, like accounts. Adding or renaming a shop also
// updates the shop dropdowns of the accounts below.
const shopsRequest = (url, options) => saveNow(url, options, 'shopError');

async function loadShops(){
  const shops = await shopsRequest('/api/stores');
  if(!shops) return;
  // The account dropdowns offer only the shops in use.
  const inUse = shops.filter(s => !s.archived);
  const changed = JSON.stringify(inUse.map(s => [s.id, s.name])) !== JSON.stringify(allStores.map(s => [s.id, s.name]));
  allStores = inUse.map(s => ({ id: s.id, name: s.name, prefix: s.prefix }));
  const el = document.getElementById('shopList');
  el.innerHTML = shops.map(s => `
    <div class="editable-row shop-row${s.archived ? ' shop-archived' : ''}" data-id="${s.id}">
      <input type="text" class="shop-name" value="${escapeHtml(s.name)}" maxlength="60" aria-label="Име на магазина">
      <input type="text" class="shop-prefix" value="${escapeHtml(s.prefix)}" maxlength="5" placeholder="без" aria-label="Префикс">
      <span class="muted shop-orders">${s.archived ? 'архивиран · ' : ''}${s.orders} ${s.orders === 1 ? 'поръчка' : 'поръчки'}</span>
      <button class="row-btn" data-action="save-shop">Запази</button>
      ${s.archived
        ? '<button class="row-btn" data-action="restore-shop">Възстанови</button>'
        : '<button class="row-btn" data-action="archive-shop">Архивирай</button>'}
    </div>`).join('');
  el.querySelectorAll('.shop-row').forEach(row => {
    const name = () => row.querySelector('.shop-name').value.trim();
    const archive = row.querySelector('[data-action="archive-shop"]');
    if(archive) archive.addEventListener('click', async () => {
      if(!confirm(`Да се архивира ли „${name()}“? Магазинът изчезва от избора и списъците; поръчките и историята му се пазят и могат да се виждат в Справки. Може да бъде възстановен по всяко време.`)) return;
      if(await shopsRequest(`/api/stores/${row.dataset.id}/archive`, { method: 'POST' })) loadShops();
    });
    const restore = row.querySelector('[data-action="restore-shop"]');
    if(restore) restore.addEventListener('click', async () => {
      if(await shopsRequest(`/api/stores/${row.dataset.id}/restore`, { method: 'POST' })) loadShops();
    });
    row.querySelector('[data-action="save-shop"]').addEventListener('click', async () => {
      const saved = await shopsRequest(`/api/stores/${row.dataset.id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: row.querySelector('.shop-name').value, prefix: row.querySelector('.shop-prefix').value })
      });
      if(!saved) return;
      // The shop whose settings are open: its name field shows the new name,
      // so "Запази промените" later doesn't put the old one back.
      if(saved.id === currentStoreId && settings && !allShopsView){
        settings.shopName = saved.name;
        originalSettings.shopName = saved.name;
        document.getElementById('shopNameInput').value = saved.name;
      }
      loadShops();
    });
  });
  // The account shop dropdowns list the shops too.
  if(changed){
    renderNewUserShops(Number(document.getElementById('newUserShop').value) || (allStores[0] && allStores[0].id));
    loadUsers();
  }
}

document.getElementById('addShopBtn').addEventListener('click', async () => {
  const name = document.getElementById('newShopName').value.trim();
  const prefix = document.getElementById('newShopPrefix').value.trim();
  if(!name){ showError('shopError', 'Въведете име на магазина.'); return; }
  const created = await shopsRequest('/api/stores', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, prefix })
  });
  if(!created) return;
  document.getElementById('newShopName').value = '';
  document.getElementById('newShopPrefix').value = '';
  loadShops();
});
