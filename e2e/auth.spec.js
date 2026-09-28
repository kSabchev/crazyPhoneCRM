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
