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
  await row(page, t.customer_name).click();
  await page.click('#printCustomerBtn');
  await expect(page.locator('#printCustomerTemplate')).toContainText('Тест Сервиз');
});
