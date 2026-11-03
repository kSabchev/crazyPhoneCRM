// Справки: the period, start-up, loading the report and drawing it. All
// figures are computed on the server (reports.js); the page only shows them.

// ---------- Period ----------
function presetRange(preset){
  const now = new Date();
  const today = localDateString(now);
  const y = now.getFullYear(), m = now.getMonth();
  switch(preset){
    case 'month': return { from: localDateString(new Date(y, m, 1)), to: today };
    case '3m':    return { from: localDateString(new Date(y, m - 2, 1)), to: today };
    case '12m':   return { from: localDateString(new Date(y, m - 11, 1)), to: today };
    case 'year':
    default:      return { from: `${y}-01-01`, to: today };
  }
}

function setActivePreset(preset){
  document.querySelectorAll('#presets [data-preset]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });
}

// ---------- Bootstrap ----------
async function init(){
  const meRes = await fetch('/api/auth/me');
  if(!meRes.ok){ window.location.href = '/'; return; }
  const me = await meRes.json();
  // Справки (revenue, profit) is for managers and admins, about the shop
  // they work on; the backup log is for admins only.
  if(me.role !== 'admin' && me.role !== 'shop_manager'){ window.location.href = '/'; return; }
  const manyShops = (me.stores || []).length > 1;
  // The all-shops view: every shop's figures together.
  const shopName = me.allShops ? 'всички магазини' : me.store.name;
  document.getElementById('whoAmI').textContent = manyShops ? `${me.username} · ${shopName}` : me.username;
  // Admins with several shops tick which ones the figures cover: to start
  // with, all of them in the all-shops view, otherwise the current shop.
  // Archived shops can be ticked too, to see their figures.
  const archived = (me.archivedStores || []).map(s => ({ ...s, archived: true }));
  if(me.role === 'admin' && (manyShops || archived.length)){
    renderShopPicks([...me.stores, ...archived], me.allShops ? me.stores.map(s => s.id) : [me.store.id]);
  }
  document.getElementById('backups').style.display = me.role === 'admin' ? '' : 'none';
  document.getElementById('reportsScreen').style.display = 'block';

  const { from, to } = presetRange('year');
  document.getElementById('fromInput').value = from;
  document.getElementById('toInput').value = to;
  setActivePreset('year');
  load();
  if(me.role === 'admin') loadBackups();
}

let lastReport = null;

async function load(){
  const from = document.getElementById('fromInput').value;
  const to = document.getElementById('toInput').value;
  const errEl = document.getElementById('reportError');
  errEl.textContent = '';

  const shops = pickedShops();
  if(shops && !shops.length){ errEl.textContent = 'Изберете поне един магазин.'; return; }
  const res = await fetch(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${shops ? `&shops=${shops.join(',')}` : ''}`);
  if(res.status === 401){ window.location.href = '/'; return; }
  if(!res.ok){
    const data = await res.json().catch(()=>({}));
    errEl.textContent = data.error || 'Справката не можа да бъде заредена.';
    return;
  }
  lastReport = await res.json();
  render(lastReport);
}

function render(r){
  renderKpis(r);
  renderByShop(r.byShop);
  renderRevenueChart(r.revenue.months);
  renderRevenueTable(r.revenue);
  renderStatusTime(r.statusTime);
  renderWorkload(r.workload);
  renderDataQuality(r.dataQuality);
  renderSms(r.sms);
}

// ---------- Wire up ----------
document.getElementById('backBtn').addEventListener('click', ()=>{ window.location.href = '/'; });
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await fetch('/api/auth/logout', { method:'POST' });
  window.location.href = '/';
});
document.querySelectorAll('#presets [data-preset]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const { from, to } = presetRange(btn.dataset.preset);
    document.getElementById('fromInput').value = from;
    document.getElementById('toInput').value = to;
    setActivePreset(btn.dataset.preset);
    load();
  });
});
document.getElementById('applyBtn').addEventListener('click', ()=>{ setActivePreset(null); load(); });

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ if(lastReport) renderRevenueChart(lastReport.revenue.months); }, 150);
});

init();
