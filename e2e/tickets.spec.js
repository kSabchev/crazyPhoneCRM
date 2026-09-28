const { test, expect } = require('@playwright/test');
const {
  uniqueName, login, createTicketViaApi, row, expectModalOpen, expectModalClosed
} = require('./helpers');

test.beforeEach(async ({ page }) => {
  await login(page, 'alice');
});

test('the new-ticket form has sensible defaults and hides repair-progress fields', async ({ page }) => {
  await page.click('#newTicketBtn');
  await expectModalOpen(page);

  await expect(page.locator('#modalTitle')).toHaveText('Нова сервизна поръчка');
  await expect(page.locator('#f_date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#f_kaparo')).toHaveValue('Не');
  await expect(page.locator('#f_loaner')).toHaveValue('Не');
  await expect(page.locator('#f_status')).toHaveValue('за сервиз');

  // Only meaningful once the ticket exists.
  await expect(page.locator('#f_repair')).toBeHidden();
  await expect(page.locator('#f_pravim')).toBeHidden();
  await expect(page.locator('#f_phone_call')).toBeHidden();
  await expect(page.locator('#deleteBtn')).toBeHidden();
  await expect(page.locator('#printCustomerBtn')).toBeHidden();
  await expect(page.locator('#historySection')).toBeHidden();
});

test('creating a ticket through the form adds it to the table', async ({ page }) => {
  const name = uniqueName();
  await page.click('#newTicketBtn');
  await page.fill('#f_customer', name);
  await page.fill('#f_phone', '0877 555 111');
  await page.fill('#f_model', 'Samsung Galaxy S24');
  await page.fill('#f_desc', 'Не зарежда');
  await page.fill('#f_customer_price', '80');
  await page.click('#saveBtn');

  await expectModalClosed(page);
  const r = row(page, name);
  await expect(r).toHaveCount(1);
  await expect(r).toContainText('Samsung Galaxy S24');
  await expect(r).toContainText('Не зарежда');
  await expect(r.locator('.badge')).toHaveText('за сервиз');
  await expect(r.locator('.ticket-no')).toHaveText(/^#\d+$/);
});

test('saving without required fields shows a message and keeps the form open', async ({ page }) => {
  await page.click('#newTicketBtn');
  await page.fill('#f_customer', uniqueName());

  // This alert fires synchronously inside the click, so the handler must
  // be in place before clicking or the click never completes.
  let message;
  page.once('dialog', d => { message = d.message(); d.accept(); });
  await page.click('#saveBtn');
  expect(message).toContain('Моля, попълнете');
  await expectModalOpen(page);
});

test('a server-side validation error is shown to the user', async ({ page }) => {
  await page.click('#newTicketBtn');
  await page.fill('#f_customer', 'x'.repeat(201));
  await page.fill('#f_phone', '0888');
  await page.fill('#f_model', 'iPhone 15');
  await page.fill('#f_desc', 'тест');

  const dialog = page.waitForEvent('dialog');
  await page.click('#saveBtn');
  const d = await dialog;
  expect(d.message()).toContain('Име на клиента е твърде дълго');
  await d.accept();
  await expectModalOpen(page);
});

test('editing a ticket updates the table and records history', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  await row(page, t.customer_name).click();
  await expectModalOpen(page);
  await expect(page.locator('#modalTitle')).toHaveText(`Поръчка #${t.ticket_no}`);
  await expect(page.locator('#f_customer')).toHaveValue(t.customer_name);
  await expect(page.locator('#f_repair')).toBeVisible();
  await expect(page.locator('#f_phone_call')).toHaveAttribute('href', 'tel:0888123456');

  await page.selectOption('#f_status', 'в сервиз');
  await page.fill('#f_repair', 'Сменен дисплей');
  await page.click('#saveBtn');
  await expectModalClosed(page);

  const r = row(page, t.customer_name);
  await expect(r.locator('.badge')).toHaveText('в сервиз');
  await expect(r).toContainText('Сменен дисплей');

  await r.click();
  await expect(page.locator('#historyCount')).toHaveText('(2)');
  await page.click('#historyToggle');
  await expect(page.locator('#historyList')).toContainText('alice');
  await expect(page.locator('#historyList')).toContainText('Статус');
});

test('deleting asks for confirmation; cancelling keeps the ticket', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  await row(page, t.customer_name).click();
  page.once('dialog', d => d.dismiss());
  await page.click('#deleteBtn');
  await expectModalOpen(page);
  await page.click('#cancelBtn');
  await expect(row(page, t.customer_name)).toHaveCount(1);

  await row(page, t.customer_name).click();
  page.once('dialog', d => d.accept());
  await page.click('#deleteBtn');
  await expectModalClosed(page);
  await expect(row(page, t.customer_name)).toHaveCount(0);
});

test('clicking the Правим marker cycles it without opening the ticket', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  const marker = row(page, t.customer_name).locator('.pravim-cell .pravim-toggle');
  await expect(marker).toHaveText('○');
  await marker.click();
  await expect(marker).toHaveText('✓');
  await marker.click();
  await expect(marker).toHaveText('✗');
  await expectModalClosed(page);
});

test('the call column dials the customer and does not open the ticket', async ({ page }) => {
  const t = await createTicketViaApi(page, { phoneContact: '+359 88 765 4321' });
  await page.reload();

  const cell = row(page, t.customer_name).locator('.call-cell');
  await expect(cell.locator('a')).toHaveAttribute('href', 'tel:+359887654321');

  // Regression: clicks anywhere in the call cell (not just the icon) used
  // to fall through to the row and open the edit modal.
  await cell.click({ position: { x: 3, y: 3 } });
  await expectModalClosed(page);
});

test('search and the "in progress" filter narrow the table', async ({ page }) => {
  const tag = uniqueName('Търсене');
  const open = await createTicketViaApi(page, { customerName: `${tag} отворена` });
  const done = await createTicketViaApi(page, { customerName: `${tag} издадена`, status: 'издаден' });
  await page.reload();

  await page.fill('#searchInput', tag);
  await expect(page.locator('#tableBody tr')).toHaveCount(2);

  await page.selectOption('#statusFilter', '__active__');
  await expect(row(page, open.customer_name)).toHaveCount(1);
  await expect(row(page, done.customer_name)).toHaveCount(0);

  await page.fill('#searchInput', 'няма-такъв-клиент-xyz');
  await expect(page.locator('#emptyState')).toContainText('Няма намерени поръчки');
});

test('the activity log lists recent changes by user', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.click('#activityLogBtn');
  await expect(page.locator('#activityOverlay')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#activityList')).toContainText(`#${t.ticket_no}`);
  await page.click('#closeActivityBtn');
  await expect(page.locator('#activityOverlay')).not.toHaveClass(/\bopen\b/);
});
