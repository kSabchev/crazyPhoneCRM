// Reports page: fetches /api/reports for the chosen period and renders
// KPI tiles, the monthly revenue/profit chart (+ its table view), and the
// status/workload/data-quality tables. All figures are computed on the
// server (reports.js); this file only displays them.

const eur = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });
const monthLongFmt = new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const fmtMoney = v => eur.format(v);
const fmtDays = v => v === null ? '—' : `${String(v).replace('.', ',')} дни`;
const monthDate = ym => new Date(ym + '-01T00:00:00Z');
// Intl's short bg-BG month is numeric ("10.25 г."), so abbreviate by hand: "окт 25".
const SHORT_MONTHS = ['яну','фев','мар','апр','май','юни','юли','авг','сеп','окт','ное','дек'];
const fmtMonth = ym => `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const fmtMonthLong = ym => { const s = monthLongFmt.format(monthDate(ym)); return s[0].toUpperCase() + s.slice(1); };

function localDateString(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

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
  document.getElementById('whoAmI').textContent = me.username;
  document.getElementById('reportsScreen').style.display = 'block';

  const { from, to } = presetRange('year');
  document.getElementById('fromInput').value = from;
  document.getElementById('toInput').value = to;
  setActivePreset('year');
  load();
}

let lastReport = null;

async function load(){
  const from = document.getElementById('fromInput').value;
  const to = document.getElementById('toInput').value;
  const errEl = document.getElementById('reportError');
  errEl.textContent = '';

  const res = await fetch(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
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
  renderRevenueChart(r.revenue.months);
  renderRevenueTable(r.revenue);
  renderStatusTime(r.statusTime);
  renderWorkload(r.workload);
  renderDataQuality(r.dataQuality);
}

// ---------- KPI tiles ----------
function renderKpis(r){
  const t = r.revenue.totals;
  const tiles = [
    ['Приходи', fmtMoney(t.revenue), `${t.priced} поръчки с цена`],
    ['Печалба', fmtMoney(t.profit), `разходи ${fmtMoney(t.cost)}`],
    ['Издадени поръчки', t.returned, 'в избрания период'],
    ['Средна поръчка', t.averageTicket === null ? '—' : fmtMoney(t.averageTicket), 'продажна цена'],
    ['Срок за ремонт', fmtDays(r.turnaround.medianDays), r.turnaround.count ? `медиана · средно ${fmtDays(r.turnaround.averageDays)}` : 'няма издадени'],
    ['Капаро в момента', fmtMoney(r.workload.depositsHeld.amount), `по ${r.workload.depositsHeld.tickets} отворени поръчки`]
  ];
  document.getElementById('kpis').innerHTML = tiles.map(([label, value, sub])=>`
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(value)}</div>
      <div class="kpi-sub">${escapeHtml(sub)}</div>
    </div>`).join('');
}

// ---------- Revenue chart (inline SVG) ----------
// Grouped columns: revenue and profit per month, one shared € axis.
const CHART_HEIGHT = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };
const MAX_BAR = 24;   // bars never thicker than this
const BAR_GAP = 2;    // surface gap between the two bars of a month
const RADIUS = 4;     // rounded data-end, square at the baseline

// "Nice" axis steps (1, 2, 2.5, 5 × 10^n) so tick labels are round numbers.
function niceTicks(min, max, count = 5){
  if(max === min){ max = min + 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for(let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// A bar from the baseline (y0) to its value (y1), rounded only at the value end.
function barPath(x, w, y0, y1){
  const h = Math.abs(y1 - y0);
  if(h < 0.5) return '';
  const r = Math.min(RADIUS, w / 2, h);
  if(y1 < y0){ // positive value, grows upward
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

const axisMoney = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 0 });

function renderRevenueChart(months){
  const el = document.getElementById('revenueChart');
  const hasData = months.some(m => m.returned > 0);
  if(!hasData){
    el.innerHTML = '<div class="empty-state">Няма издадени поръчки в избрания период.</div>';
    return;
  }

  const width = Math.max(el.clientWidth, 320);
  const plotW = width - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const values = months.flatMap(m => [m.revenue, m.profit]);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const y = v => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const y0 = y(0);

  const band = plotW / months.length;
  const barW = Math.max(2, Math.min(MAX_BAR, (band * 0.7 - BAR_GAP) / 2));
  // Thin out month labels so they never collide (~48px each).
  const labelEvery = Math.max(1, Math.ceil(48 / band));

  let svg = `<svg width="${width}" height="${CHART_HEIGHT}" viewBox="0 0 ${width} ${CHART_HEIGHT}" role="img" aria-label="Приходи и печалба по месеци">`;
  for(const t of ticks){
    svg += `<line class="grid${t === 0 ? ' zero' : ''}" x1="${PAD.left}" x2="${width - PAD.right}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis-label" x="${PAD.left - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${axisMoney.format(t)} €</text>`;
  }
  months.forEach((m, i)=>{
    const cx = PAD.left + band * i + band / 2;
    const xRev = cx - barW - BAR_GAP / 2;
    const xProf = cx + BAR_GAP / 2;
    svg += `<g class="month" data-index="${i}">`;
    svg += `<rect class="hover-band" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${plotH}"/>`;
    svg += `<path class="bar bar-revenue" d="${barPath(xRev, barW, y0, y(m.revenue))}"/>`;
    svg += `<path class="bar bar-profit" d="${barPath(xProf, barW, y0, y(m.profit))}"/>`;
    svg += `</g>`;
    if(i % labelEvery === 0){
      svg += `<text class="axis-label" x="${cx}" y="${CHART_HEIGHT - 8}" text-anchor="middle">${escapeHtml(fmtMonth(m.month))}</text>`;
    }
  });
  svg += '</svg>';
  el.innerHTML = svg;

  const tip = document.getElementById('revenueTooltip');
  el.querySelectorAll('g.month').forEach(g=>{
    g.addEventListener('mouseenter', ()=>{
      const m = months[Number(g.dataset.index)];
      g.classList.add('hover');
      tip.innerHTML = `
        <div class="tip-title">${escapeHtml(fmtMonthLong(m.month))}</div>
        <div><span class="legend-swatch" style="background:var(--series-1)"></span>Приходи <b>${escapeHtml(fmtMoney(m.revenue))}</b></div>
        <div><span class="legend-swatch" style="background:var(--series-2)"></span>Печалба <b>${escapeHtml(fmtMoney(m.profit))}</b></div>
        <div class="tip-sub">${m.returned} издадени · ${m.priced} с цена</div>`;
      tip.classList.add('show');
    });
    g.addEventListener('mousemove', e=>{
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left + 14;
      tip.style.left = `${Math.min(x, box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${e.clientY - box.top + el.offsetTop - 10}px`;
    });
    g.addEventListener('mouseleave', ()=>{
      g.classList.remove('hover');
      tip.classList.remove('show');
    });
  });
}

function renderRevenueTable(revenue){
  const rows = revenue.months.slice().reverse().map(m=>`
    <tr>
      <td>${escapeHtml(fmtMonthLong(m.month))}</td>
      <td class="num">${m.returned}</td>
      <td class="num">${m.priced}</td>
      <td class="num">${escapeHtml(fmtMoney(m.revenue))}</td>
      <td class="num">${escapeHtml(fmtMoney(m.cost))}</td>
      <td class="num">${escapeHtml(fmtMoney(m.profit))}</td>
    </tr>`).join('');
  const t = revenue.totals;
  document.getElementById('revenueTable').innerHTML = rows + `
    <tr class="total-row">
      <td>Общо</td>
      <td class="num">${t.returned}</td>
      <td class="num">${t.priced}</td>
      <td class="num">${escapeHtml(fmtMoney(t.revenue))}</td>
      <td class="num">${escapeHtml(fmtMoney(t.cost))}</td>
      <td class="num">${escapeHtml(fmtMoney(t.profit))}</td>
    </tr>`;
}

// ---------- Tables ----------
function emptyRow(cols, text){
  return `<tr><td colspan="${cols}" class="empty-cell">${escapeHtml(text)}</td></tr>`;
}

function renderStatusTime(rows){
  document.getElementById('statusTimeTable').innerHTML = rows.length
    ? rows.map(s=>`<tr><td>${escapeHtml(s.status)}</td><td class="num">${escapeHtml(fmtDays(s.averageDays))}</td><td class="num">${s.count}</td></tr>`).join('')
    : emptyRow(3, 'Няма смени на статус в избрания период.');
}

function renderWorkload(w){
  document.getElementById('workloadTable').innerHTML = w.byStatus.length
    ? w.byStatus.map(s=>`<tr><td>${escapeHtml(s.status)}</td><td class="num">${s.count}</td><td class="num">${s.oldestDays}</td></tr>`).join('')
      + `<tr class="total-row"><td>Общо</td><td class="num">${w.openCount}</td><td></td></tr>`
    : emptyRow(3, 'Няма отворени поръчки.');

  document.getElementById('oldestTable').innerHTML = w.oldest.length
    ? w.oldest.map(t=>`
      <tr>
        <td class="ticket-no">#${t.ticketNo}</td>
        <td>${escapeHtml(t.customerName)}</td>
        <td>${escapeHtml(t.phoneModel)}</td>
        <td>${escapeHtml(t.status)}</td>
        <td class="num">${t.daysOpen}</td>
      </tr>`).join('')
    : emptyRow(5, 'Няма отворени поръчки.');
}

const QUALITY_LABELS = {
  returnedWithoutPrice: 'Издадени без продажна цена (не влизат в приходите)',
  returnedWithoutCost: 'Издадени с продажна, но без изкупна цена (печалбата е завишена)',
  issuedWithoutReturnDate: 'Със статус „издаден“, но без дата на връщане (не влизат в никой месец)',
  unreadableKaparo: 'Капаро, което не е число (не влиза в „Капаро в момента“)'
};

function renderDataQuality(q){
  const items = Object.entries(QUALITY_LABELS).map(([key, label])=>{
    const item = q[key];
    const ok = item.count === 0;
    const refs = item.tickets.map(t => `#${t.ticketNo}`).join(', ') + (item.count > item.tickets.length ? ` и още ${item.count - item.tickets.length}` : '');
    return `
      <div class="quality-row ${ok ? 'ok' : 'warn'}" data-check="${key}">
        <span class="quality-icon" aria-hidden="true">${ok ? '✓' : '!'}</span>
        <span class="quality-label">${escapeHtml(label)}</span>
        <span class="quality-count">${ok ? 'няма' : item.count}</span>
        ${ok ? '' : `<div class="quality-refs">${escapeHtml(refs)}</div>`}
      </div>`;
  });
  document.getElementById('dataQuality').innerHTML = items.join('');
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
