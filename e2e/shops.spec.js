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
  await expect(page.locator('#activityLogBtn')).toBeVisible();

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
  await expect(picker.locator('option')).toHaveText(['CrazyPhone', 'Магазин Лозенец', 'Всички магазини']);
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

test('admins set where a shop\'s SMS go from, in its Настройки', async ({ page }) => {
  await login(page, 'alice');
  // The second shop, so the SMS tests in the first shop are unaffected.
  expect((await page.request.post('/api/auth/store', { data: { storeId: 2 } })).status()).toBe(200);
  await page.goto('/settings.html');
  const section = page.locator('#smsSendSection');
  await expect(section.locator('h2 .scope-tag')).toHaveText('само за Магазин Лозенец');
  await expect(page.locator('#smsMode')).toHaveValue('env');
  await expect(page.locator('#smsModeHint')).toHaveText('В .env: телефон.');
  await expect(page.locator('#smsOwnFields')).toBeHidden();

  await page.selectOption('#smsMode', 'own');
  await expect(page.locator('#smsOwnFields')).toBeVisible();
  await page.click('#smsSaveBtn');
  await expect(page.locator('#smsSaveStatus')).toContainText('SMSAPI ключ или адрес на телефона');

  await page.fill('#smsGatewayUrl', 'http://127.0.0.1:3199');
  await page.fill('#smsGatewayUser', 'sms');
  await page.fill('#smsGatewayPassword', 'secret');
  await page.click('#smsSaveBtn');
  await expect(page.locator('#smsSaveStatus')).toHaveText('Запазено. SMS: телефон.');
  // The password isn't shown again, only that one is saved.
  await page.reload();
  await expect(page.locator('#smsMode')).toHaveValue('own');
  await expect(page.locator('#smsGatewayPassword')).toHaveValue('');
  await expect(page.locator('#smsGatewayPassword')).toHaveAttribute('placeholder', /запазен/);

  await page.selectOption('#smsMode', 'env');
  await page.click('#smsSaveBtn');
  await expect(page.locator('#smsSaveStatus')).toHaveText('Запазено. SMS: телефон.');
});

test('the all-shops view lists every shop\'s orders, editable, and new ones go to the chosen shop', async ({ page, browser }) => {
  // One order in each shop.
  await login(page, 'alice');
  const inFirst = await createTicketViaApi(page);
  const ctx = await browser.newContext();
  const dora = await ctx.newPage();
  await login(dora, 'dora');
  const inSecond = await createTicketViaApi(dora);

  await page.locator('#storeSwitch').selectOption('all');
  await expect(page.locator('#storeSwitch')).toHaveValue('all'); // after the page reloads
  await showAllStatuses(page);
  const second = row(page, inSecond.customer_name);
  await expect(row(page, inFirst.customer_name).locator('.shop-tag')).toHaveText('CrazyPhone');
  await expect(second.locator('.shop-tag')).toHaveText('Магазин Лозенец');
  await expect(second.locator('.ticket-no')).toContainText(`#Л-${inSecond.ticket_no}`);

  // Edited in place, in its own shop: dora sees the change.
  await second.locator('.ticket-no').click();
  await expect(page.locator('#modalTitle')).toHaveText(`Поръчка #Л-${inSecond.ticket_no} — Магазин Лозенец`);
  await page.fill('#f_comment', 'от всички магазини');
  await page.click('#saveBtn');
  await expect.poll(async () => {
    const list = await (await dora.request.get('/api/tickets')).json();
    return list.find(t => t.customer_name === inSecond.customer_name).comment;
  }).toBe('от всички магазини');

  // A new order needs its shop.
  const name = uniqueName();
  await page.click('#newTicketBtn');
  await expect(page.locator('#storeField')).toBeVisible();
  await page.fill('#f_customer', name);
  await page.fill('#f_phone', '0888 123 456');
  await page.fill('#f_model', 'Pixel 9');
  await page.fill('#f_desc', 'Не зарежда');
  page.once('dialog', d => d.accept());
  await page.click('#saveBtn');
  await expect(page.locator('#overlay')).toHaveClass(/\bopen\b/); // asked to pick a shop
  await page.selectOption('#f_store', { label: 'Магазин Лозенец' });
  await page.click('#saveBtn');
  await expect(row(page, name).locator('.shop-tag')).toHaveText('Магазин Лозенец');
  const doraList = await (await dora.request.get('/api/tickets')).json();
  expect(doraList.map(t => t.customer_name)).toContain(name);
  await ctx.close();
});

test('Справки and Настройки in the all-shops view', async ({ page }) => {
  await login(page, 'alice');
  expect((await page.request.post('/api/auth/store', { data: { storeId: 'all' } })).status()).toBe(200);
  await page.goto('/reports.html');
  await expect(page.locator('#whoAmI')).toHaveText('alice · всички магазини');
  await page.goto('/settings.html');
  await expect(page.locator('#whoAmI')).toHaveText('alice · всички магазини');
  await expect(page.locator('#allShopsNote')).toBeVisible();
  // Only what every shop shares.
  await expect(page.locator('.settings-section', { hasText: 'Статуси' }).first()).toBeVisible();
  await expect(page.locator('#smsSendSection')).toBeHidden();
  await expect(page.locator('#shopNameInput')).toBeHidden();
});

test('Настройки → Магазини lists the shops and saves name and prefix changes', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const rows = page.locator('#shopList .shop-row');
  await expect(rows).toHaveCount(2);
  const second = rows.nth(1);
  await expect(second.locator('.shop-name')).toHaveValue('Магазин Лозенец');
  await expect(second.locator('.shop-prefix')).toHaveValue('Л');

  // A taken prefix is explained, and nothing is added.
  await page.fill('#newShopName', 'Трети магазин');
  await page.fill('#newShopPrefix', 'л');
  await page.click('#addShopBtn');
  await expect(page.locator('#shopError')).toContainText('вече се използва от „Магазин Лозенец“');
  await expect(rows).toHaveCount(2);

  // Renamed (also in the account dropdowns), then back.
  await second.locator('.shop-name').fill('Лозенец 2');
  await second.locator('[data-action="save-shop"]').click();
  await expect(page.locator('#userList .user-row', { hasText: 'dora' }).locator('select.user-shop option:checked')).toHaveText('Лозенец 2');
  await rows.nth(1).locator('.shop-name').fill('Магазин Лозенец');
  await rows.nth(1).locator('[data-action="save-shop"]').click();
  await expect(page.locator('#userList .user-row', { hasText: 'dora' }).locator('select.user-shop option:checked')).toHaveText('Магазин Лозенец');
  await expect(page.locator('#shopError')).toHaveText('');
});

test('renaming the open shop in Магазини keeps the name field in step', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const first = page.locator('#shopList .shop-row').first();
  await first.locator('.shop-name').fill('CrazyPhone Център');
  await first.locator('[data-action="save-shop"]').click();
  await expect(page.locator('#shopNameInput')).toHaveValue('CrazyPhone Център');
  // Saving the other settings now keeps the new name.
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toHaveText('Запазено.');
  expect((await (await page.request.get('/api/settings')).json()).shopName).toBe('CrazyPhone Център');

  await page.locator('#shopList .shop-row').first().locator('.shop-name').fill('CrazyPhone');
  await page.locator('#shopList .shop-row').first().locator('[data-action="save-shop"]').click();
  await expect(page.locator('#shopNameInput')).toHaveValue('CrazyPhone');
});

// Also on a phone: the report tables scroll inside their box, never the page.
const pageOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Справки in the all-shops view breaks the figures down by shop', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/reports.html');
  await expect(page.locator('#reportsScreen')).toBeVisible();
  await expect(page.locator('#byShopSection')).toBeHidden(); // one shop: nothing to compare
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  expect((await page.request.post('/api/auth/store', { data: { storeId: 'all' } })).status()).toBe(200);
  await page.reload();
  const rows = page.locator('#byShopTable tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('td').first()).toHaveText('CrazyPhone');
  await expect(rows.nth(1).locator('td').first()).toHaveText('Магазин Лозенец (Л)');
  await expect(rows.nth(2)).toHaveClass(/total-row/);

  await page.setViewportSize({ width: 390, height: 800 });
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test('admins tick which shops Справки covers', async ({ page }) => {
  await login(page, 'alice');
  // A single shop's page: the choice starts with that shop.
  await page.goto('/reports.html');
  const picks = page.locator('#shopPickList input');
  await expect(picks).toHaveCount(2);
  await expect(picks.nth(0)).toBeChecked();
  await expect(picks.nth(1)).not.toBeChecked();
  await expect(page.locator('#byShopSection')).toBeHidden();

  // Ticking the second shop reloads every section for both, with the breakdown.
  const both = page.waitForResponse(r => r.url().includes('/api/reports') && r.url().includes('shops=1,2'));
  await picks.nth(1).check();
  expect((await both).status()).toBe(200);
  await expect(page.locator('#byShopTable tr')).toHaveCount(3);

  // Only the second shop.
  const second = page.waitForResponse(r => r.url().includes('/api/reports') && /shops=2$/.test(r.url()));
  await picks.nth(0).uncheck();
  await second;
  await expect(page.locator('#byShopSection')).toBeHidden();

  // None: explained, nothing loaded.
  await picks.nth(1).uncheck();
  await expect(page.locator('#reportError')).toHaveText('Изберете поне един магазин.');
  const all = page.waitForResponse(r => r.url().includes('shops=1,2'));
  await page.click('#pickAllShops');
  await all;
  await expect(page.locator('#reportError')).toHaveText('');
  await expect(page.locator('#byShopTable tr')).toHaveCount(3);

  // The all-shops view starts with every shop ticked.
  expect((await page.request.post('/api/auth/store', { data: { storeId: 'all' } })).status()).toBe(200);
  await page.reload();
  await expect(picks.nth(0)).toBeChecked();
  await expect(picks.nth(1)).toBeChecked();
});

test('shop managers get no shop choice in Справки', async ({ page }) => {
  await login(page, 'vera');
  await page.goto('/reports.html');
  await expect(page.locator('#reportsScreen')).toBeVisible();
  await expect(page.locator('#shopPicks')).toBeHidden();
});

test('admins archive a shop in Магазини, and restore it', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const rows = page.locator('#shopList .shop-row');

  // A shop with accounts can't be archived (dora works in Лозенец).
  page.once('dialog', d => d.accept());
  await rows.nth(1).locator('[data-action="archive-shop"]').click();
  await expect(page.locator('#shopError')).toContainText('профилите му: dora');

  // A new, empty shop can.
  await page.fill('#newShopName', 'Временен');
  await page.fill('#newShopPrefix', 'В');
  await page.click('#addShopBtn');
  const temp = rows.filter({ has: page.locator('.shop-name[value="Временен"]') });
  await expect(temp).toHaveCount(1);
  page.once('dialog', d => d.accept());
  await temp.locator('[data-action="archive-shop"]').click();
  await expect(temp).toHaveClass(/shop-archived/);
  await expect(temp.locator('.shop-orders')).toContainText('архивиран');
  // Not offered for accounts…
  await expect(page.locator('#newUserShop option', { hasText: 'Временен' })).toHaveCount(0);
  // …nor in the picker; but it can be ticked in Справки.
  await page.goto('/');
  await expect(page.locator('#storeSwitch option', { hasText: 'Временен' })).toHaveCount(0);
  await page.goto('/reports.html');
  const pick = page.locator('.shop-pick', { hasText: 'Временен' });
  await expect(pick).toContainText('(архивиран)');
  await expect(pick.locator('input')).not.toBeChecked();

  await page.goto('/settings.html');
  await temp.locator('[data-action="restore-shop"]').click();
  await expect(temp).not.toHaveClass(/shop-archived/);
  page.once('dialog', d => d.accept());
  await temp.locator('[data-action="archive-shop"]').click(); // leave it archived for the tests after
  await expect(temp).toHaveClass(/shop-archived/);
});

// The pages are split into several scripts (js/settings, js/reports): a
// script using another one's function before it has loaded fails silently
// for the user, so check for script errors on every admin page.
test('Настройки, Справки and the main page load without script errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await login(page, 'alice');
  for (const url of ['/settings.html', '/reports.html', '/']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});
