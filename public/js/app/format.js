// Main page: formatting prices, the deposit and history values.
// Dates, money and escaping are in js/utils.js.

// A price for an input field, with a decimal comma as staff type it
// ("25,5"); empty when there's no price. The server accepts comma or point.
function priceForInput(v){
  return v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',');
}
const PRICE_INPUT = /^\s*(\d+(?:[.,]\d{1,2})?)?\s*$/;

// Капаро holds an amount, "Не" (no deposit) or free text from older
// orders: amounts are formatted as money, anything else shown as entered.
function fmtKaparo(v){
  if(v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(€|eur|евро)?$/i);
  return m ? EUR.format(Number(m[1].replace(',', '.'))) : s;
}

// True when the deposit equals the selling price — the customer has
// already paid in full, so the table shows Капаро on a green background.
// A price of 0 (e.g. a refused order) has nothing to pay, so it isn't green.
function kaparoCoversPrice(t){
  if(t.customer_price === null || t.customer_price === undefined || t.customer_price === '') return false;
  if(!(Number(t.customer_price) > 0)) return false;
  const m = String(t.kaparo ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(€|eur|евро)?$/i);
  return !!m && Math.abs(Number(m[1].replace(',', '.')) - Number(t.customer_price)) < 0.005;
}

// A value in the change history, formatted the way the table shows it.
function fmtHistoryValue(field, v){
  if(field === 'pravim') return PRAVIM_SYMBOLS[v] || '—';
  if(v === null || v === undefined || v === '') return '—';
  if(field === 'service_price' || field === 'customer_price') return escapeHtml(fmtPrice(v));
  if(field === 'kaparo') return escapeHtml(fmtKaparo(v));
  return escapeHtml(String(v));
}
