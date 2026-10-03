// Admin (alice) and staff (bob) views, changing your own password, and
// managing accounts in Настройки → Потребители.
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row, uniqueName } = require('./helpers');

test('staff don\'t see Справки, Настройки or the delete buttons', async ({ page }) => {
  await login(page, 'bob');
  await expect(page.locator('#roleTag')).toHaveText('служител');
  await expect(page.locator('#reportsBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toBeHidden();

  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#deleteBtn')).toBeHidden();
  await expect(page.locator('#topActions [data-action="delete"]')).toBeHidden();
  // Everything else in the order still works for staff.
  await expect(page.locator('#topActions [data-action="save"]')).toBeVisible();
  await expect(page.locator('#printCustomerBtn')).toBeVisible();
});

test('staff opening Настройки or Справки directly are sent back', async ({ page }) => {
  await login(page, 'bob');
  for (const url of ['/settings.html', '/reports.html']) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/$/);
  }
});

test('admins see everything', async ({ page }) => {
  await login(page, 'alice');
  await expect(page.locator('#roleTag')).toHaveText('');
  await expect(page.locator('#reportsBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#deleteBtn')).toBeVisible();
  await expect(page.locator('#topActions [data-action="delete"]')).toBeVisible();
});

test('anyone can change their own password from the username in the header', async ({ page, browser }) => {
  // A throwaway account, so the shared test logins stay unchanged.
  await login(page, 'alice');
  const name = `pw${Date.now().toString(36)}`;
  await page.request.post('/api/users', { data: { username: name, password: 'firstpass1', role: 'staff' } });

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/');
  await p.fill('#loginUser', name);
  await p.fill('#loginPass', 'firstpass1');
  await p.click('#loginForm button[type=submit]');
  await expect(p.locator('#whoAmI')).toHaveText(name);

  await p.click('#whoAmI');
  await expect(p.locator('#passwordOverlay')).toHaveClass(/\bopen\b/);
  await p.fill('#pwCurrent', 'wrong-one');
  await p.fill('#pwNew', 'secondpass2');
  await p.fill('#pwConfirm', 'secondpass2');
  await p.click('#pwSaveBtn');
  await expect(p.locator('#pwError')).toHaveText('Текущата парола е грешна');

  await p.fill('#pwCurrent', 'firstpass1');
  await p.fill('#pwConfirm', 'different');
  await p.click('#pwSaveBtn');
  await expect(p.locator('#pwError')).toContainText('не съвпадат');

  await p.fill('#pwConfirm', 'secondpass2');
  p.once('dialog', d => d.accept());
  await p.click('#pwSaveBtn');
  await expect(p.locator('#passwordOverlay')).not.toHaveClass(/\bopen\b/);

  const relogin = await page.request.post('/api/auth/login', { data: { username: name, password: 'secondpass2' } });
  expect(relogin.status()).toBe(200);
  await ctx.close();
});

test('admins add, change, reset and remove accounts in Настройки', async ({ page, browser }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  const list = page.locator('#userList');
  const own = list.locator('.user-row', { hasText: 'alice' });
  await expect(own).toContainText('(вие)');
  await expect(own.locator('.user-role')).toBeDisabled();
  await expect(own.locator('[data-action="remove"]')).toHaveCount(0);

  const name = uniqueName('user').replace(/\s/g, '');
  await page.fill('#newUserName', name);
  await page.fill('#newUserPassword', 'short');
  await page.click('#addUserBtn');
  await expect(page.locator('#userError')).toContainText('поне 8 знака');

  await page.fill('#newUserPassword', 'goodpassword');
  await page.click('#addUserBtn');
  const r = list.locator('.user-row', { hasText: name });
  await expect(r).toHaveCount(1);
  await expect(r.locator('.user-role')).toHaveValue('staff');
  await expect(page.locator('#userError')).toHaveText('');

  // Role change is saved straight away.
  await r.locator('.user-role').selectOption('admin');
  await expect.poll(async () => {
    const users = await (await page.request.get('/api/users')).json();
    return users.find(u => u.username === name).role;
  }).toBe('admin');

  // New password via the prompt, then the "changed" confirmation.
  const answers = ['resetpass99', undefined];
  const onDialog = d => d.accept(answers.shift());
  page.on('dialog', onDialog);
  await r.locator('[data-action="password"]').click();
  await expect.poll(() => answers.length).toBe(0);
  page.off('dialog', onDialog);
  // Check it from a separate session, so this page stays logged in as alice.
  const other = await browser.newContext();
  await expect.poll(async () =>
    (await other.request.post('/api/auth/login', { data: { username: name, password: 'resetpass99' } })).status()
  ).toBe(200);
  await other.close();

  page.once('dialog', d => d.accept());
  await list.locator('.user-row', { hasText: name }).locator('[data-action="remove"]').click();
  await expect(list.locator('.user-row', { hasText: name })).toHaveCount(0);
});

test('the last-admin rule is explained when it applies', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/settings.html');
  // bob is staff; trying to make alice (self) staff isn't possible (disabled),
  // so check the server's message through the API instead.
  const users = await (await page.request.get('/api/users')).json();
  const alice = users.find(u => u.username === 'alice');
  const res = await page.request.put(`/api/users/${alice.id}`, { data: { role: 'staff' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain('собствените си администраторски права');
});
