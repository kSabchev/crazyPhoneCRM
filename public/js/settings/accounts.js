// Настройки: the accounts (Потребители).

// ---------- Accounts ----------
// Managed separately from the other settings: each change is saved
// straight away and isn't part of "Запази промените".
const ROLE_LABELS = { staff: 'служител', shop_manager: 'управител', admin: 'администратор' };

// Managers and staff each work in one shop; admins in all. The shop
// dropdowns are only shown when there's more than one shop.
const manyShops = () => allStores.length > 1;
function shopOptions(selectedId){
  return allStores.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
}
function renderNewUserShops(currentStoreId){
  const select = document.getElementById('newUserShop');
  select.innerHTML = shopOptions(currentStoreId);
  updateNewUserShop();
}
function updateNewUserShop(){
  const isAdminRole = document.getElementById('newUserRole').value === 'admin';
  document.getElementById('newUserShop').style.display = manyShops() && !isAdminRole ? '' : 'none';
}
document.getElementById('newUserRole').addEventListener('change', updateNewUserShop);

const usersRequest = (url, options) => saveNow(url, options, 'userError');

async function loadUsers(){
  const users = await usersRequest('/api/users');
  if(!users) return;
  const me = users.find(u => u.username === currentUsername);
  currentUserId = me ? me.id : null;
  const el = document.getElementById('userList');
  el.innerHTML = users.map(u => {
    const self = u.id === currentUserId;
    return `
    <div class="editable-row user-row" data-id="${u.id}">
      <span class="item-text">${escapeHtml(u.username)}${self ? ' <span class="muted">(вие)</span>' : ''}</span>
      <select class="user-role" ${self ? 'disabled title="Не можете да смените собствената си роля"' : ''}>
        ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}"${u.role === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      ${!manyShops() ? '' : u.role === 'admin'
        ? '<span class="user-shop user-shop-all">всички магазини</span>'
        : `<select class="user-shop" title="Магазин">${shopOptions(u.store_id)}</select>`}
      <button class="row-btn" data-action="password">Нова парола</button>
      ${self ? '<span class="row-lock" title="Не можете да премахнете собствения си профил">—</span>'
             : '<button class="row-btn remove" data-action="remove">Премахни</button>'}
    </div>`;
  }).join('');

  el.querySelectorAll('.user-row').forEach(row => {
    const id = Number(row.dataset.id);
    const name = row.querySelector('.item-text').textContent.replace(' (вие)', '');
    row.querySelector('.user-role').addEventListener('change', async (e) => {
      const ok = await usersRequest(`/api/users/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: e.target.value })
      });
      loadUsers(); // re-render either way (reverts the dropdown on error)
      return ok;
    });
    const shop = row.querySelector('select.user-shop');
    if(shop) shop.addEventListener('change', async (e) => {
      await usersRequest(`/api/users/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ storeId: Number(e.target.value) })
      });
      loadUsers();
    });
    row.querySelector('[data-action="password"]').addEventListener('click', async () => {
      const pw = prompt(`Нова парола за „${name}“ (поне 8 знака):`);
      if(pw === null) return;
      const ok = await usersRequest(`/api/users/${id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: pw })
      });
      if(ok) alert(`Паролата на „${name}“ е сменена.`);
    });
    const remove = row.querySelector('[data-action="remove"]');
    if(remove) remove.addEventListener('click', async () => {
      if(!confirm(`Да се премахне ли профилът „${name}“? Той ще бъде изведен от системата.`)) return;
      if(await usersRequest(`/api/users/${id}`, { method: 'DELETE' })) loadUsers();
    });
  });
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  // Without a choice (one shop), the server uses the current shop.
  const storeId = manyShops() && role !== 'admin' ? Number(document.getElementById('newUserShop').value) : undefined;
  const created = await usersRequest('/api/users', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password, role, storeId })
  });
  if(!created) return;
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserRole').value = 'staff';
  updateNewUserShop();
  loadUsers();
});
