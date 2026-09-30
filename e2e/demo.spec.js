// The DEMO banner and pre-filled login. The test server isn't in demo
// mode, so /api/demo is answered here as a demo server would answer it.
const { test, expect } = require('@playwright/test');

const DEMO = { demo: true, users: [{ username: 'demo', password: 'demo1234' }, { username: 'demo2', password: 'demo1234' }] };

test('in demo mode, every page shows the banner and the login is pre-filled', async ({ page }) => {
  await page.route('**/api/demo', route => route.fulfill({ json: DEMO }));
  await page.goto('/');

  const banner = page.locator('.demo-banner');
  await expect(banner).toContainText('ДЕМО версия');
  await expect(banner).toContainText('demo / demo1234 или demo2 / demo1234');
  await expect(page.locator('#loginUser')).toHaveValue('demo');
  await expect(page.locator('#loginPass')).toHaveValue('demo1234');

  // Pre-filled with the demo account; log in as a real test user instead.
  await page.fill('#loginUser', 'alice');
  await page.fill('#loginPass', 'secret123');
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#whoAmI')).toHaveText('alice');
  await expect(banner).toBeVisible();

  for (const url of ['/reports.html', '/settings.html']) {
    await page.goto(url);
    await expect(page.locator('.demo-banner')).toContainText('ДЕМО версия');
  }
});

test('outside demo mode there is no banner and the login is empty', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  await expect(page.locator('#loginUser')).toHaveValue('');
});
