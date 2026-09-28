// The reports page. Each test seeds its tickets in its own random
// far-future year, so the period it reports on contains only its own data,
// whatever else is in the shared database (including from repeated runs).
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, uniqueName } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await login(page, 'alice');
});

async function showPeriod(page, from, to) {
  await page.fill('#fromInput', from);
  await page.fill('#toInput', to);
  await page.click('#applyBtn');
}

const freshYear = () => String(2100 + Math.floor(Math.random() * 7900));

const kpi = (page, label) => page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: label }) });

test('the header link opens reports, which default to this year', async ({ page }) => {
  await page.click('#reportsBtn');
  await expect(page).toHaveURL(/reports\.html$/);
  await expect(page.locator('#whoAmI')).toHaveText('alice');
  const year = new Date().getFullYear();
  await expect(page.locator('#fromInput')).toHaveValue(`${year}-01-01`);
  await expect(page.locator('#presets .active')).toHaveText('Тази година');
  await expect(kpi(page, 'Приходи')).toBeVisible();
});

test('revenue, profit and turnaround reflect returned tickets', async ({ page }) => {
  const y = freshYear();
  await createTicketViaApi(page, {
    dateReceived: `${y}-01-05`, dateReturned: `${y}-01-10`, status: 'издаден', customerPrice: '120', servicePrice: '45.5'
  });
  await createTicketViaApi(page, {
    dateReceived: `${y}-02-01`, dateReturned: `${y}-02-08`, status: 'издаден', customerPrice: '80'
  });

  await page.goto('/reports.html');
  await showPeriod(page, `${y}-01-01`, `${y}-03-31`);

  await expect(kpi(page, 'Приходи').locator('.kpi-value')).toHaveText(/200,00\s€/);
  await expect(kpi(page, 'Печалба').locator('.kpi-value')).toHaveText(/154,50\s€/);
  await expect(kpi(page, 'Върнати поръчки').locator('.kpi-value')).toHaveText('2');
  await expect(kpi(page, 'Срок за ремонт').locator('.kpi-value')).toHaveText('6 дни');

  // One month group per month in the period, with a bar per series.
  await expect(page.locator('#revenueChart g.month')).toHaveCount(3);
  const jan = page.locator('#revenueTable tr', { hasText: `Януари ${y}` });
  await expect(jan).toContainText(/120,00\s€/);
  await expect(jan).toContainText(/45,50\s€/);
  await expect(page.locator('#revenueTable tr.total-row')).toContainText(/200,00\s€/);
});

test('hovering a month shows its figures', async ({ page }) => {
  const y = freshYear();
  await createTicketViaApi(page, {
    dateReceived: `${y}-05-02`, dateReturned: `${y}-05-04`, status: 'издаден', customerPrice: '99', servicePrice: '30'
  });
  await page.goto('/reports.html');
  await showPeriod(page, `${y}-05-01`, `${y}-05-31`);

  await page.locator('#revenueChart g.month .hover-band').first().hover();
  const tip = page.locator('#revenueTooltip');
  await expect(tip).toHaveClass(/show/);
  await expect(tip).toContainText(`Май ${y}`);
  await expect(tip).toContainText(/99,00\s€/);
  await expect(tip).toContainText(/69,00\s€/);
});

test('a period with no returns shows an empty state instead of a chart', async ({ page }) => {
  await page.goto('/reports.html');
  const y = freshYear();
  await showPeriod(page, `${y}-01-01`, `${y}-02-28`);
  await expect(page.locator('#revenueChart')).toContainText('Няма върнати поръчки');
  await expect(page.locator('#revenueChart svg')).toHaveCount(0);
});

test('an invalid period shows the error from the server', async ({ page }) => {
  await page.goto('/reports.html');
  await showPeriod(page, '2031-05-01', '2031-04-01');
  await expect(page.locator('#reportError')).toHaveText('Началната дата е след крайната');
});

test('open tickets and data problems are listed', async ({ page }) => {
  const y = freshYear();
  const open = await createTicketViaApi(page, { customerName: uniqueName('Чака'), status: 'чака клиент', dateReceived: '1990-01-01' });
  const noPrice = await createTicketViaApi(page, { dateReceived: `${y}-06-01`, dateReturned: `${y}-06-02`, status: 'издаден' });

  await page.goto('/reports.html');
  await showPeriod(page, `${y}-06-01`, `${y}-06-30`);

  // Received in 1990, so it ranks among the ten oldest open tickets.
  await expect(page.locator('#oldestTable')).toContainText(open.customer_name);
  await expect(page.locator('#workloadTable')).toContainText('чака клиент');

  const missingPrice = page.locator('.quality-row[data-check="returnedWithoutPrice"]');
  await expect(missingPrice).toHaveClass(/warn/);
  await expect(missingPrice).toContainText(`#${noPrice.ticket_no}`);
});

test('presets fill in the period', async ({ page }) => {
  await page.goto('/reports.html');
  await page.click('[data-preset="month"]');
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  await expect(page.locator('#fromInput')).toHaveValue(monthStart);
  await expect(page.locator('#presets .active')).toHaveText('Този месец');
});

test('logged-out visitors are sent to the login screen', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/reports.html');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#loginScreen')).toBeVisible();
});
