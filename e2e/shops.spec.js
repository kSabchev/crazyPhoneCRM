// Several shops: the shop manager's view, the admin's shop picker, and
// staff seeing only their own shop. The test server (e2e/server.js) has two
// shops: the first (alice, bob, vera) and "Магазин Лозенец" (dora).
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row, uniqueName, showAllStatuses } = require('./helpers');

test('shop managers see Справки and the delete buttons, but not Настройки or the backup log', async ({ page }) => {
  await login(page, 'vera');
  await expect(page.locator('#roleTag')).toHaveText('управител');
  await expect(page.locator('#reportsBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeHidden();
  await expect(page.locator('#storeSwitch')).toBeHidden();

  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#deleteBtn')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.locator('#deleteBtn').click();
  await expect(row(page, t.customer_name)).toHaveCount(0);

  await page.goto('/reports.html');
  await expect(page.locator('#reportsScreen')).toBeVisible();
  await expect(page.locator('#backups')).toBeHidden();

  await page.goto('/settings.html');
  await expect(page).toHaveURL(/\/$/);
});

test('staff only see their own shop, and get no shop picker', async ({ page, browser }) => {
  await login(page, 'bob');
  const first = await createTicketViaApi(page);
  await expect(page.locator('#storeSwitch')).toBeHidden();

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await login(other, 'dora');
  const second = await createTicketViaApi(other);
  await other.reload();
  await expect(row(other, second.customer_name)).toHaveCount(1);
  await expect(row(other, first.customer_name)).toHaveCount(0);
  await ctx.close();

  await page.reload();
  await expect(row(page, first.customer_name)).toHaveCount(1);
  await expect(row(page, second.customer_name)).toHaveCount(0);
});

test('admins pick the shop in the header, and work on its orders', async ({ page }) => {
  await login(page, 'alice');
  const picker = page.locator('#storeSwitch');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveText(['CrazyPhone', 'Магазин Лозенец']);
  await expect(picker).toHaveValue('1');
  const inFirst = await createTicketViaApi(page);

  await picker.selectOption({ label: 'Магазин Лозенец' });
  await expect(picker).toHaveValue('2'); // after the page reloads
  await expect(page.locator('#whoAmI')).toHaveText('alice');
  await expect(row(page, inFirst.customer_name)).toHaveCount(0);

  // A new order goes into the picked shop, where its staff see it.
  const name = uniqueName();
  await page.click('#newTicketBtn');
  await page.fill('#f_customer', name);
  await page.fill('#f_phone', '0888 123 456');
  await page.fill('#f_model', 'Pixel 9');
  await page.fill('#f_desc', 'Не зарежда');
  await page.click('#saveBtn');
  await expect(row(page, name)).toHaveCount(1);

  const res = await page.request.post('/api/auth/login', { data: { username: 'dora', password: 'secret123' } });
  expect(res.status()).toBe(200);
  const doraOrders = await (await page.request.get('/api/tickets')).json();
  expect(doraOrders.map(t => t.customer_name)).toContain(name);
  expect(doraOrders.map(t => t.customer_name)).not.toContain(inFirst.customer_name);
});

test('Справки and Настройки say which shop they are about when there are several', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/reports.html');
  await expect(page.locator('#whoAmI')).toHaveText('alice · CrazyPhone');
  await expect(page.locator('#backups')).toBeVisible();
  await page.goto('/settings.html');
  await expect(page.locator('#whoAmI')).toHaveText('alice · CrazyPhone');
});

test('admins choose the shop of a new account, and can move it', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const list = page.locator('#userList');
  await expect(list.locator('.user-row', { hasText: 'alice' }).locator('.user-shop-all')).toHaveText('всички магазини');
  await expect(list.locator('.user-row', { hasText: 'dora' }).locator('select.user-shop')).toHaveValue('2');

  // Admins have no shop to choose.
  await page.selectOption('#newUserRole', 'admin');
  await expect(page.locator('#newUserShop')).toBeHidden();
  await page.selectOption('#newUserRole', 'shop_manager');
  await expect(page.locator('#newUserShop')).toBeVisible();
  await expect(page.locator('#newUserShop')).toHaveValue('1'); // the shop alice works on

  const name = uniqueName('mgr').replace(/\s/g, '');
  await page.fill('#newUserName', name);
  await page.fill('#newUserPassword', 'goodpassword');
  await page.selectOption('#newUserShop', { label: 'Магазин Лозенец' });
  await page.click('#addUserBtn');
  const r = list.locator('.user-row', { hasText: name });
  await expect(r.locator('.user-role')).toHaveValue('shop_manager');
  await expect(r.locator('select.user-shop')).toHaveValue('2');

  // Moved to the first shop: saved straight away.
  await r.locator('select.user-shop').selectOption('1');
  await expect.poll(async () => {
    const users = await (await page.request.get('/api/users')).json();
    return users.find(u => u.username === name).store_id;
  }).toBe(1);

  page.once('dialog', d => d.accept());
  await r.locator('[data-action="remove"]').click();
  await expect(r).toHaveCount(0);
});

// Not shop-specific, but shows the picker didn't push the header out of
// shape for an admin on a phone.
test('the shop picker fits the header on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page, 'alice');
  await showAllStatuses(page);
  await expect(page.locator('#storeSwitch')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Настройки says which sections are shared and which are the shop\'s own', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const tag = h2 => page.locator('.settings-section h2', { hasText: h2 }).locator('.scope-tag');
  await expect(tag('Статуси')).toHaveText('общо за всички магазини');
  await expect(tag('Колони в таблицата')).toHaveText('общо за всички магазини');
  await expect(tag('Предложения за модели телефони')).toHaveText('общо за всички магазини');
  await expect(tag('Име на сервиза')).toHaveText('само за CrazyPhone');
  await expect(tag('SMS до клиента')).toHaveText('само за CrazyPhone');
  await expect(page.locator('#shopPhoneInput')).toBeVisible();
});
