// Main page: the customer copy (PDF), the service label and the print offer.

// ---------- Print ----------
const LOGO_SRC = '/assets/logo.png';

// The customer copy has a fixed layout matching the shop's paper service
// card, rather than the configurable field-list the service copy uses.
function buildCustomerPrintDoc(t){
  const tagline = settings.shopTagline
    ? `<div class="card-tagline">${escapeHtml(settings.shopTagline)}</div>` : '';

  const topRows = [
    ['Клиент', escapeHtml(t.customer_name)],
    ['Модел и Марка', escapeHtml(t.phone_model)]
  ].map(([label, value]) => `
    <div class="card-row">
      <span class="card-label">${label}:</span>
      <span class="card-value">${value}</span>
    </div>
  `).join('');

  // The damage description tends to run long, so it gets its own stacked
  // row (label above, full-width value below) with room for two lines,
  // rather than being squeezed into the right-hand column of an inline row.
  const descriptionRow = `
    <div class="card-row-stacked">
      <span class="card-label">Описание на повредата:</span>
      <div class="card-value-block">${escapeHtml(t.description) || '—'}</div>
    </div>
  `;

  const bottomRows = [
    ['Оборотен телефон', escapeHtml(t.loaner_phone)],
    ['Капаро', escapeHtml(fmtKaparo(t.kaparo))],
    ['Цена', fmtPrice(t.customer_price)],
    ['Дата на приемане', fmtDate(t.date_received)]
  ].map(([label, value]) => `
    <div class="card-row">
      <span class="card-label">${label}:</span>
      <span class="card-value">${value}</span>
    </div>
  `).join('');

  const warningLines = (settings.printCustomer.footer || '')
    .split('\n').filter(Boolean).map(escapeHtml);
  const warning = warningLines.length ? `
    <div class="card-warning">
      ${warningLines.map((line, i) => i === 0 ? `<strong>${line}</strong>` : `<div>${line}</div>`).join('')}
    </div>
  ` : '';

  return `
    <div class="card-header">
      <img src="${LOGO_SRC}" alt="" class="card-logo">
      <div class="card-brand">
        <div class="card-shop-name">${escapeHtml(settings.shopName)}</div>
        ${tagline}
      </div>
      <div class="card-order-no">
        ${settings.shopPhone ? `<div class="card-doc-title">тел. ${escapeHtml(settings.shopPhone)}</div>` : ''}
        <div>№ ${t.ticket_no}</div>
      </div>
    </div>
    <div class="card-body">${topRows}${descriptionRow}${bottomRows}</div>
    ${warning}
  `;
}

// The customer copy is generated as a real, exactly-sized PDF rather than relying
// on the browser's print dialog and CSS @page (which different printers and
// drivers honor inconsistently, especially at small physical sizes).
// html2canvas rasterizes our existing HTML/CSS exactly as the browser
// renders it — including Cyrillic text, no special font embedding needed —
// and jsPDF places that image on a PDF page sized to the precise mm
// dimensions, so the physical output size is guaranteed regardless of the
// printer or OS print settings.
const CUSTOMER_CARD_MM = { width: 100, height: 95 };
const CAPTURE_SCALE = 4; // renders at 4x resolution for crisp small-format print output

async function renderElementToPdf(el, sizeMm){
  const canvas = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    useCORS: true
  });
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    unit: 'mm',
    format: [sizeMm.width, sizeMm.height],
    // jsPDF silently swaps a [width, height] format to force portrait
    // unless orientation is stated explicitly — without this, a landscape
    // card (wider than tall) ends up on a portrait page and gets clipped.
    orientation: sizeMm.width >= sizeMm.height ? 'landscape' : 'portrait'
  });
  doc.addImage(imgData, 'PNG', 0, 0, sizeMm.width, sizeMm.height);
  window.open(doc.output('bloburl'), '_blank');
}

// ---------- Offer to print after a new order is saved ----------
// The prints are usually made right after taking a phone in, so a new
// order offers both straight away. The window stays open after a print
// (both are often needed); "Готово" closes it and runs `afterClose`.
let printOfferTicket = null;
let printOfferAfter = null;

function openPrintOffer(ticket, afterClose){
  printOfferTicket = ticket;
  printOfferAfter = afterClose || null;
  document.getElementById('printOfferTitle').textContent = `Поръчка #${ticket.ticket_no} е създадена`;
  document.getElementById('printOfferSub').textContent = `${ticket.customer_name}, ${ticket.phone_model}`;
  document.querySelectorAll('#printOfferOverlay [data-print]').forEach(btn => btn.classList.remove('done'));
  document.getElementById('printOfferOverlay').classList.add('open');
  document.querySelector('#printOfferOverlay [data-print="customer"]').focus();
}

function closePrintOffer(){
  document.getElementById('printOfferOverlay').classList.remove('open');
  const after = printOfferAfter;
  printOfferTicket = null;
  printOfferAfter = null;
  if(after) after();
}

document.querySelectorAll('#printOfferOverlay [data-print]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if(!printOfferTicket) return;
    await printCopy(btn.dataset.print, printOfferTicket);
    btn.classList.add('done');
  });
});
document.getElementById('printOfferDoneBtn').addEventListener('click', closePrintOffer);
document.getElementById('printOfferOverlay').addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closePrintOffer(); });

// Prints the customer card or downloads the service label for `ticket`
// (the open order by default).
async function printCopy(kind, ticket = editingTicket){
  if(!ticket || !settings) return;
  const custEl = document.getElementById('printCustomerTemplate');

  if(kind === 'customer'){
    custEl.innerHTML = buildCustomerPrintDoc(ticket);
    const img = custEl.querySelector('img');
    if(img && !img.complete){
      await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    }
    await renderElementToPdf(custEl, CUSTOMER_CARD_MM);
  } else {
    // The service label goes to the Brother QL-600 label printer as a
    // P-touch Editor file (built by the server from the shop's template):
    // it downloads, and opening it in P-touch Editor prints it.
    const a = document.createElement('a');
    a.href = `/api/tickets/${ticket.id}/service-label.lbx`;
    a.download = `poruchka-${ticket.ticket_no}.lbx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
