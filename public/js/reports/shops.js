// Справки: which shops the figures cover, and the figures by shop.

// ---------- Which shops (admins with several) ----------
// A ticked shop's data goes into every figure, chart and list below. The
// report reloads on each change.
function renderShopPicks(shops, checked){
  document.getElementById('shopPicks').style.display = '';
  document.getElementById('shopPickList').innerHTML = shops.map(s => `
    <label class="shop-pick${s.archived ? ' shop-pick-archived' : ''}"><input type="checkbox" value="${s.id}"${checked.includes(s.id) ? ' checked' : ''}> ${escapeHtml(s.name)}${s.archived ? ' <span class="muted">(архивиран)</span>' : ''}</label>`).join('');
}
// The ticked shop ids, or null when there's no choice (one shop, managers).
function pickedShops(){
  if(document.getElementById('shopPicks').style.display === 'none') return null;
  return [...document.querySelectorAll('#shopPickList input:checked')].map(i => Number(i.value));
}
document.getElementById('shopPickList').addEventListener('change', () => load()); // load: main.js, loaded after
document.getElementById('pickAllShops').addEventListener('click', ()=>{
  // Every shop in use (archived ones stay as they are).
  document.querySelectorAll('#shopPickList input').forEach(i => {
    if(!i.closest('.shop-pick-archived')) i.checked = true;
  });
  load();
});

// ---------- By shop (several shops) ----------
// One row per shop and the total. A share of the total revenue is shown
// under each shop's revenue.
function renderByShop(byShop){
  const section = document.getElementById('byShopSection');
  section.style.display = byShop ? '' : 'none';
  if(!byShop) return;
  const total = byShop.total;
  const cells = s => `
      <td class="num">${s.returned}</td>
      <td class="num">${escapeHtml(fmtMoney(s.revenue))}${s.share !== undefined ? `<div class="muted">${s.share}%</div>` : ''}</td>
      <td class="num">${escapeHtml(fmtMoney(s.profit))}</td>
      <td class="num">${s.averageTicket === null ? '—' : escapeHtml(fmtMoney(s.averageTicket))}</td>
      <td class="num">${s.medianDays === null ? '—' : `${String(s.medianDays).replace('.', ',')} дни`}</td>
      <td class="num">${s.openCount}</td>
      <td class="num">${escapeHtml(fmtMoney(s.depositsHeld))}</td>
      <td class="num">${s.smsSent}</td>`;
  document.getElementById('byShopTable').innerHTML = byShop.shops.map(s => {
    const share = total.revenue > 0 ? Math.round(s.revenue / total.revenue * 100) : undefined;
    return `<tr data-shop="${s.id}"><td>${escapeHtml(s.name)}${s.prefix ? ` <span class="muted">(${escapeHtml(s.prefix)})</span>` : ''}</td>${cells({ ...s, share })}</tr>`;
  }).join('') + `<tr class="total-row"><td>Общо</td>${cells(total)}</tr>`;
}
