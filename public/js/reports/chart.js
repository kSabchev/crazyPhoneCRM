// Справки: revenue and profit by month — the chart and its table.

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
