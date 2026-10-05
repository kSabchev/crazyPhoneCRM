const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('a wrong password shows an error and stays on the login screen', async ({ page }) => {
  await page.goto('/');
  await page.fill('#loginUser', 'alice');
  await page.fill('#loginPass', 'wrong-password');
  await page.click('#loginForm button[type=submit]');

  await expect(page.locator('#loginError')).toHaveText('Невалидно потребителско име или парола');
  await expect(page.locator('#appScreen')).toBeHidden();
});

test('logging in shows the app, survives a reload, and logging out returns to login', async ({ page }) => {
  await login(page, 'alice');
  await expect(page.locator('#appScreen')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('общо поръчки');

  await page.reload();
  await expect(page.locator('#whoAmI')).toHaveText('alice');

  await page.click('#logoutBtn');
  await expect(page.locator('#loginScreen')).toBeVisible();
  await page.reload();
  await expect(page.locator('#loginScreen')).toBeVisible();
});

test('the settings page sends a logged-out visitor back to login', async ({ page }) => {
  await page.goto('/settings.html');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#loginScreen')).toBeVisible();
});

// While the page asks the server whether you're logged in, neither screen
// is shown — the login form used to flash up for logged-in users (e.g.
// coming back from Справки). The server's answer is held back here so the
// in-between moment can be checked.
async function holdSessionCheck(page) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/auth/me', async route => { await held; await route.continue(); });
  return () => release();
}

test('a logged-in user never sees the login form while the page opens', async ({ page }) => {
  await login(page, 'alice');
  const release = await holdSessionCheck(page);

  // Back from Справки, the way staff move between pages.
  await page.goto('/reports.html');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await expect(page.locator('#loginScreen')).toBeHidden();
  await expect(page.locator('#appScreen')).toBeHidden();

  release();
  await expect(page.locator('#appScreen')).toBeVisible();
  await expect(page.locator('#loginScreen')).toBeHidden();
});

test('when the session check can\'t reach the server, the login form is shown', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loginScreen')).toBeVisible();
  await expect(page.locator('#appScreen')).toBeHidden();
});
