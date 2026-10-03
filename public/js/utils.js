// Small helpers shared by every page (main page, Настройки, Справки).
// Loaded before the page's own scripts; everything here is a global.

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// White or dark text, whichever reads better on a status badge colour.
function readableTextOn(hex){
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#211E1A' : '#FFFFFF';
}

// Dates are stored as yyyy-mm-dd (native <input type="date"> value format).
// Displayed as dd.mm.yyyy throughout the app, regardless of browser locale.
// Today as yyyy-mm-dd in the browser's own time zone. (toISOString() is UTC,
// which gave yesterday's date for tickets opened between midnight and ~3am.)
function localDateString(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d){
  if(!d) return '—';
  const parts = d.split('-');
  if(parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}.${m}.${y}`;
}

// SQLite datetime('now') is UTC, e.g. "2026-09-10 15:42:19" -> local
// "10.09.2026 18:42".
function fmtUtcTime(s){
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if(isNaN(d)) return s;
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Money is shown the same way everywhere (table, history, print, reports):
// "25,00 €" — Bulgarian format, comma decimals, euro sign after.
const EUR = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });

function fmtPrice(v){
  if(v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? EUR.format(n) : String(v);
}

// How many SMS a text takes: Latin-only fits 160 characters (153 per part
// when longer), anything with Cyrillic 70 (67 per part).
function smsParts(text){
  const len = [...text].length;
  if(len === 0) return 0;
  const latin = /^[\x20-\x7E\r\n]*$/.test(text);
  const [single, multi] = latin ? [160, 153] : [70, 67];
  return len <= single ? 1 : Math.ceil(len / multi);
}
