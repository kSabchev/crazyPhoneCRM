// Справки: the key figures, time in status, open orders, the longest
// waiting, the data check and the SMS sent.

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

// ---------- SMS sent to customers ----------
const SMS_STATES = [
  ['Delivered', 'доставени', 'ok'],
  ['Sent', 'изпратени', 'ok'],
  ['Pending', 'изчакват изпращане', 'pending'],
  ['Processed', 'изпращат се', 'pending'],
  ['Sending', 'изпращат се', 'pending'],
  ['Failed', 'неуспешни', 'bad']
];
const SMS_STATE_LABEL = {
  Delivered: 'доставено ✓', Sent: 'изпратено', Pending: 'изчаква изпращане',
  Processed: 'изпраща се', Sending: 'изпраща се', Failed: 'неуспешно'
};

function renderSms(s){
  if(!s) return;
  const counts = SMS_STATES
    .filter(([state]) => s.byState[state])
    .map(([state, label, cls]) => `<span class="sms-count sms-count-${cls}">${s.byState[state]} ${label}</span>`);
  document.getElementById('smsSummary').innerHTML = s.total
    ? `<strong>${s.total}</strong> SMS · <strong>${s.parts}</strong> SMS части от плана · ${counts.join(' ')}`
    : '';
  document.getElementById('smsTable').innerHTML = s.messages.length
    ? s.messages.map(m=>`
      <tr class="sms-row sms-row-${escapeHtml(m.state.toLowerCase())}">
        <td class="nowrap">${escapeHtml(fmtUtcTime(m.createdAt))}</td>
        <td class="ticket-no">#${m.ticketNo}</td>
        <td>${m.customerName ? escapeHtml(m.customerName) : '<span class="muted">(изтрита поръчка)</span>'}</td>
        <td class="nowrap">${escapeHtml(m.phone)}</td>
        <td class="sms-text-cell">${escapeHtml(m.text)}</td>
        <td class="num">${m.parts}</td>
        <td>${escapeHtml(SMS_STATE_LABEL[m.state] || m.state)}${m.error ? `<div class="muted">${escapeHtml(m.error)}</div>` : ''}</td>
        <td>${escapeHtml(m.sentBy)}</td>
      </tr>`).join('')
    : emptyRow(8, 'Няма изпратени SMS в избрания период.');
  document.getElementById('smsTruncated').textContent = s.truncated
    ? `Показани са последните ${s.messages.length} от ${s.total} SMS. Изберете по-кратък период, за да видите всички.`
    : '';
}
