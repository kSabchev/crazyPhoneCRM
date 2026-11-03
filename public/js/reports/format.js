// Справки: number, money and date formats shared by the page's scripts.
// The page is split by section (js/reports/*.js, loaded in order by
// reports.html); main.js starts it.

const monthLongFmt = new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const fmtMoney = v => EUR.format(v);
const fmtDays = v => v === null ? '—' : `${String(v).replace('.', ',')} дни`;
const monthDate = ym => new Date(ym + '-01T00:00:00Z');
// Intl's short bg-BG month is numeric ("10.25 г."), so abbreviate by hand: "окт 25".
const SHORT_MONTHS = ['яну','фев','мар','апр','май','юни','юли','авг','сеп','окт','ное','дек'];
const fmtMonth = ym => `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const fmtMonthLong = ym => { const s = monthLongFmt.format(monthDate(ym)); return s[0].toUpperCase() + s.slice(1); };
