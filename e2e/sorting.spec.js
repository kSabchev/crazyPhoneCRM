// Sorting the order table by №, Статус and the two dates.
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, uniqueName } = require('./helpers');

let tag, a, b, c;

test.beforeEach(async ({ page }) => {
  await login(page, 'alice');
  await page.evaluate(() => localStorage.removeItem('ticketSort'));
  // Three orders created in this order (so a < b < c by number), with
  // statuses and dates chosen so every sort gives a different order.
  tag = uniqueName('Сорт');
  a = await createTicketViaApi(page, { customerName: `${tag} А`, status: 'чака клиент', dateReceived: '2026-03-01', dateReturned: '2026-03-20' });
  b = await createTicketViaApi(page, { customerName: `${tag} Б`, status: 'за сервиз', dateReceived: '2026-01-01' });
  c = await createTicketViaApi(page, { customerName: `${tag} В`, status: 'в сервиз', dateReceived: '2026-02-01', dateReturned: '2026-02-10' });
  await page.reload();
  await page.fill('#searchInput', tag);
  await expect(page.locator('#tableBody tr')).toHaveCount(3);
});

const order = page => page.locator('#tableBody tr .cust-name').allInnerTexts();
const names = (...ts) => ts.map(t => t.customer_name);
const header = (page, key) => page.locator(`th[data-sort="${key}"]`);

test('default: by number, newest first, with a ▼ on №', async ({ page }) => {
  expect(await order(page)).toEqual(names(c, b, a));
  await expect(header(page, 'number').locator('.sort-arrow')).toHaveText('▼');
  await expect(header(page, 'number')).toHaveAttribute('aria-sort', 'descending');
  await expect(header(page, 'status').locator('.sort-arrow')).toHaveText('');
});

test('clicking № again reverses it', async ({ page }) => {
  await header(page, 'number').click();
  expect(await order(page)).toEqual(names(a, b, c));
  await expect(header(page, 'number').locator('.sort-arrow')).toHaveText('▲');
});

test('Статус sorts in the order of the status list, and can be reversed', async ({ page }) => {
  await header(page, 'status').click();
  expect(await order(page)).toEqual(names(b, c, a)); // за сервиз, в сервиз, чака клиент
  await expect(header(page, 'status').locator('.sort-arrow')).toHaveText('▲');
  await expect(header(page, 'number').locator('.sort-arrow')).toHaveText('');
  await header(page, 'status').click();
  expect(await order(page)).toEqual(names(a, c, b));
});

test('Дата на приемане sorts newest first, then oldest first', async ({ page }) => {
  await header(page, 'dateIn').click();
  expect(await order(page)).toEqual(names(a, c, b)); // 03-01, 02-01, 01-01
  await expect(header(page, 'dateIn').locator('.sort-arrow')).toHaveText('▼');
  await header(page, 'dateIn').click();
  expect(await order(page)).toEqual(names(b, c, a));
});

test('Дата на връщане keeps orders without a date at the bottom either way', async ({ page }) => {
  await header(page, 'dateReturned').click();
  expect(await order(page)).toEqual(names(a, c, b));
  await header(page, 'dateReturned').click();
  expect(await order(page)).toEqual(names(c, a, b));
});

test('the chosen sort is remembered after a reload', async ({ page }) => {
  await header(page, 'status').click();
  await page.reload();
  await page.fill('#searchInput', tag);
  expect(await order(page)).toEqual(names(b, c, a));
  await expect(header(page, 'status').locator('.sort-arrow')).toHaveText('▲');
});

test('sorting works from the keyboard', async ({ page }) => {
  await header(page, 'dateIn').focus();
  await page.keyboard.press('Enter');
  await expect(header(page, 'dateIn').locator('.sort-arrow')).toHaveText('▼');
});
