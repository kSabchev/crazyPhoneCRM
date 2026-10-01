const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row } = require('./helpers');

let original;

test.beforeEach(async ({ page }) => {
  await login(page, 'alice');
  original = await (await page.request.get('/api/settings')).json();
});

// Specs share one database — put settings back for the other tests.
test.afterEach(async ({ page }) => {
  await page.request.put('/api/settings', { data: original });
});

test('hiding a column on the settings page hides it in the ticket table', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'видим коментар' });

  await page.click('#settingsBtn');
  await expect(page).toHaveURL(/settings\.html$/);
  await page.locator('#columnGrid input[data-col="comment"]').uncheck();
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

  await page.click('#backBtn');
  await expect(page.locator('th[data-col="comment"]')).toBeHidden();
  await expect(row(page, t.customer_name).locator('td', { hasText: 'видим коментар' })).toBeHidden();
  await expect(row(page, t.customer_name)).toBeVisible();
});

test('a new status added in settings is offered in the ticket form', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#newStatusInput', 'чака одобрение');
  await page.click('#addStatusBtn');
  await expect(page.locator('#statusList')).toContainText('чака одобрение');
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

  await page.goto('/');
  await page.click('#newTicketBtn');
  await expect(page.locator('#f_status option', { hasText: 'чака одобрение' })).toHaveCount(1);
});

test('discarding unsaved settings changes restores the saved values', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#shopNameInput', 'Временно име');
  await page.click('#resetBtn');
  await expect(page.locator('#shopNameInput')).toHaveValue(original.shopName);
});

test('the shop name from settings is printed on the customer card', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#shopNameInput', 'Тест Сервиз');
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/');
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#printCustomerBtn');
  await expect(page.locator('#printCustomerTemplate')).toContainText('Тест Сервиз');
});

test('a new status gets the colour chosen next to it, shown on its badge', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#newStatusInput', 'чака части');
  await page.locator('#newStatusColor').fill('#0ea5e9');
  await page.click('#addStatusBtn');
  const preview = page.locator('#statusList .status-preview', { hasText: 'чака части' });
  await expect(preview).toHaveCSS('background-color', 'rgb(14, 165, 233)');
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

  await page.goto('/');
  const t = await createTicketViaApi(page, { status: 'чака части' });
  await page.reload();
  await expect(row(page, t.customer_name).locator('.badge')).toHaveCSS('background-color', 'rgb(14, 165, 233)');
});

test('an existing status can be recoloured, with readable text', async ({ page }) => {
  await page.goto('/settings.html');
  const statusRow = page.locator('#statusList .editable-row', { hasText: 'в сервиз' });
  await statusRow.locator('input.status-color').fill('#fde047'); // light yellow
  await expect(statusRow.locator('.status-preview')).toHaveCSS('color', 'rgb(33, 30, 26)'); // dark text
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

  await page.goto('/');
  const t = await createTicketViaApi(page, { status: 'в сервиз' });
  await page.reload();
  const badge = row(page, t.customer_name).locator('.badge');
  await expect(badge).toHaveCSS('background-color', 'rgb(253, 224, 71)');
  await expect(badge).toHaveCSS('color', 'rgb(33, 30, 26)');
});

test('leaving with unsaved changes asks first; cancelling stays on the page', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#shopTaglineInput', 'незапазен слоган');

  let message = null;
  page.once('dialog', d => { message = d.message(); d.dismiss(); });
  await page.click('#backBtn');
  await expect.poll(() => message).toContain('незапазени промени');
  await expect(page).toHaveURL(/settings\.html$/);

  page.once('dialog', d => d.accept());
  await page.click('#backBtn');
  await expect(page).toHaveURL(/\/$/);
});

test('unsaved list changes (e.g. hidden columns) also count', async ({ page }) => {
  await page.goto('/settings.html');
  await page.locator('#columnGrid input[data-col="comment"]').uncheck();
  let asked = false;
  page.once('dialog', d => { asked = true; d.dismiss(); });
  await page.click('#backBtn');
  await expect.poll(() => asked).toBe(true);
  await expect(page).toHaveURL(/settings\.html$/);
});

test('no question when nothing changed, after saving, or after discarding', async ({ page }) => {
  let asked = false;
  page.on('dialog', d => { asked = true; d.dismiss(); });

  await page.goto('/settings.html');
  await page.click('#backBtn');
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings.html');
  await page.fill('#shopTaglineInput', 'запазен слоган');
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');
  await page.click('#backBtn');
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings.html');
  await page.fill('#shopTaglineInput', 'ще бъде отхвърлено');
  await page.click('#resetBtn');
  await page.click('#backBtn');
  await expect(page).toHaveURL(/\/$/);
  expect(asked).toBe(false);
});

test('closing or reloading the tab with unsaved changes triggers the browser warning', async ({ page }) => {
  await page.goto('/settings.html');
  await page.fill('#shopNameInput', 'Незапазено име');
  const dialog = page.waitForEvent('dialog');
  page.reload().catch(() => {});
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss();
  await expect(page.locator('#shopNameInput')).toHaveValue('Незапазено име');
});
