// Настройки: what the page's scripts share. The page is split by section
// (js/settings/*.js, loaded in order by settings.html); main.js starts it.

// The settings being edited (saved with "Запази промените") and as last saved.
let settings = null;
let originalSettings = null;

const COLUMN_LABELS = {
  customer: 'Клиент',
  callBtn: 'Обаждане',
  model: 'Модел',
  issue: 'Проблем',
  password: 'Парола',
  comment: 'Коментар',
  repairPerformed: 'Извършен ремонт',
  loanerPhone: 'Об. тел (оборотен телефон)',
  pravim: 'Правим',
  status: 'Статус',
  kaparo: 'Капаро',
  servicePrice: 'Изкупна цена',
  customerPrice: 'Продажна цена',
  dateIn: 'Дата на приемане',
  dateReturned: 'Дата на връщане'
};

// Who's logged in, and the shops (lib/auth.js /api/auth/me).
let currentUsername = null;
let currentUserId = null;
let allStores = [];
let currentStoreId = null;   // the shop whose settings this page edits
let allShopsView = false;    // the all-shops view: shared settings only

function showError(id, text){ document.getElementById(id).textContent = text || ''; }

// For the sections saved straight away (shops, accounts): the answer's data,
// or null with the error shown in the section's error line (errorId). A
// change (any method but GET) also refreshes the admin log.
async function saveNow(url, options, errorId){
  const res = await fetch(url, options);
  if(res.status === 401 || res.status === 403){ window.location.href = '/'; return null; }
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ showError(errorId, data.error || 'Промяната не можа да бъде запазена.'); return null; }
  showError(errorId, '');
  if(options && options.method) loadAdminLog();
  return data;
}
