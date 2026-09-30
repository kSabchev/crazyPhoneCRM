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
  await expect(page.locator('#f_loaner')).toHaveValue('не');
  await expect(page.locator('#f_password')).toHaveValue('');
  await expect(page.locator('#f_status')).toHaveValue('за сервиз');

  // Only meaningful once the ticket exists.
  await expect(page.locator('#f_repair')).toBeHidden();
  await expect(page.locator('#f_pravim')).toBeHidden();
  await expect(page.locator('#f_phone_call')).toBeHidden();
  await expect(page.locator('#deleteBtn')).toBeHidden();
  await expect(page.locator('#printCustomerBtn')).toBeHidden();
  await expect(page.locator('#historySection')).toBeHidden();
});

test('just after midnight, a new ticket defaults to today, not yesterday', async ({ page }) => {
  // 00:30 in Sofia is still the previous day in UTC.
  await page.clock.setFixedTime(new Date('2026-09-29T00:30:00+03:00'));
  await page.reload();
  await page.click('#newTicketBtn');
  await expect(page.locator('#f_date')).toHaveValue('2026-09-29');
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

  await row(page, t.customer_name).locator('.ticket-no').click();
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

test('choosing "издаден" fills in today as the return date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00+03:00'));
  const t = await createTicketViaApi(page);
  await page.reload();

  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#f_date_returned')).toHaveValue('');
  await page.selectOption('#f_status', 'в сервиз');
  await expect(page.locator('#f_date_returned')).toHaveValue('');
  await page.selectOption('#f_status', 'издаден');
  await expect(page.locator('#f_date_returned')).toHaveValue('2026-10-02');

  await page.click('#saveBtn');
  await expectModalClosed(page);
  await expect(row(page, t.customer_name)).toContainText('02.10.2026');
});

test('choosing "издаден" keeps a return date that is already filled in', async ({ page }) => {
  const t = await createTicketViaApi(page, { dateReturned: '2026-08-15' });
  await page.reload();

  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.selectOption('#f_status', 'издаден');
  await expect(page.locator('#f_date_returned')).toHaveValue('2026-08-15');
});

// Same local-date rule as the server (both run on this machine).
function todayDisplay() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

test('clicking a status opens a dropdown that saves without opening the ticket', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.status-cell .badge').click();
  await expectModalClosed(page);
  const select = r.locator('.status-select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('за сервиз');
  await expect(select.locator('option')).toHaveText(['за сервиз', 'в сервиз', 'чака клиент', 'издаден', 'отказан', 'забравен']);

  await select.selectOption('чака клиент');
  await expect(r.locator('.status-select')).toHaveCount(0);
  await expect(r.locator('.badge')).toHaveText('чака клиент');
  await expectModalClosed(page);

  await page.reload();
  await expect(row(page, t.customer_name).locator('.badge')).toHaveText('чака клиент');
});

test('quick-changing the status to "издаден" sets today as the return date', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.status-cell .badge').click();
  await r.locator('.status-select').selectOption('издаден');
  await expect(r.locator('.badge')).toHaveText('издаден');
  await expect(r).toContainText(todayDisplay());
});

test('quick status keeps a return date that is already set', async ({ page }) => {
  const t = await createTicketViaApi(page, { dateReturned: '2026-08-15' });
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.status-cell .badge').click();
  await r.locator('.status-select').selectOption('издаден');
  await expect(r.locator('.badge')).toHaveText('издаден');
  await expect(r).toContainText('15.08.2026');
});

test('Escape or clicking elsewhere closes the status dropdown without saving', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.status-cell .badge').click();
  // The first Escape closes the browser's open option list; the second
  // closes the dropdown itself.
  await r.locator('.status-select').press('Escape');
  await page.keyboard.press('Escape');
  await expect(r.locator('.status-select')).toHaveCount(0);
  await expect(r.locator('.badge')).toHaveText('за сервиз');

  await r.locator('.status-cell .badge').click();
  await expect(r.locator('.status-select')).toBeVisible();
  await page.click('#searchInput');
  await expect(r.locator('.status-select')).toHaveCount(0);
  await expect(r.locator('.badge')).toHaveText('за сервиз');
  await expectModalClosed(page);
});

test('when editing, the action buttons are also at the top of the form', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  await page.click('#newTicketBtn');
  await expect(page.locator('#topActions')).toBeHidden();
  await page.click('#cancelBtn');

  await row(page, t.customer_name).locator('.ticket-no').click();
  const top = page.locator('#topActions');
  await expect(top).toBeVisible();
  await expect(top.locator('button')).toHaveText([
    'Изтрий поръчката', 'Разпечатай за клиента', 'Разпечатай за сервиза', 'Отказ', 'Запази поръчката'
  ]);
  // Directly under the subtitle, above the first field.
  const subBox = await page.locator('#modalSub').boundingBox();
  const topBox = await top.boundingBox();
  const fieldBox = await page.locator('#f_customer').boundingBox();
  expect(topBox.y).toBeGreaterThan(subBox.y);
  expect(topBox.y).toBeLessThan(fieldBox.y);

  await page.fill('#f_comment', 'запазено от горния бутон');
  await top.locator('[data-action="save"]').click();
  await expectModalClosed(page);
  await expect(row(page, t.customer_name)).toContainText('запазено от горния бутон');
});

test('the top Отказ and Изтрий buttons work like the bottom ones', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.locator('#topActions [data-action="cancel"]').click();
  await expectModalClosed(page);

  await row(page, t.customer_name).locator('.ticket-no').click();
  page.once('dialog', d => d.accept());
  await page.locator('#topActions [data-action="delete"]').click();
  await expectModalClosed(page);
  await expect(row(page, t.customer_name)).toHaveCount(0);
});

test('deleting asks for confirmation; cancelling keeps the ticket', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();

  await row(page, t.customer_name).locator('.ticket-no').click();
  page.once('dialog', d => d.dismiss());
  await page.click('#deleteBtn');
  await expectModalOpen(page);
  await page.click('#cancelBtn');
  await expect(row(page, t.customer_name)).toHaveCount(1);

  await row(page, t.customer_name).locator('.ticket-no').click();
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

test('Парола sits between Проблем and Коментар, and the loaner column is "Об. тел"', async ({ page }) => {
  const headers = await page.locator('thead th').allInnerTexts();
  const i = headers.indexOf('Проблем');
  expect(headers.slice(i, i + 3)).toEqual(['Проблем', 'Парола', 'Коментар']);
  expect(headers).toContain('Об. тел');
  expect(headers).not.toContain('Оборотен телефон');
});

test('the unlock code and loaner phone are entered in the form and shown in the table', async ({ page }) => {
  const name = uniqueName();
  await page.click('#newTicketBtn');
  await expect(page.locator('#f_loaner option')).toHaveText(['не', 'да']);
  await page.fill('#f_customer', name);
  await page.fill('#f_phone', '0888 111 222');
  await page.fill('#f_model', 'iPhone 14');
  await page.fill('#f_desc', 'Не пали');
  await page.fill('#f_password', '2580');
  await page.selectOption('#f_loaner', 'да');
  await page.click('#saveBtn');
  await expectModalClosed(page);

  const r = row(page, name);
  await expect(r.locator('.password-cell')).toHaveText('2580');
  await expect(r).toContainText('да');

  await r.locator('.ticket-no').click();
  await expect(page.locator('#f_password')).toHaveValue('2580');
  await expect(page.locator('#f_loaner')).toHaveValue('да');
});

test('the history says the password changed without showing it', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: '1111' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.fill('#f_password', '9999');
  await page.click('#saveBtn');
  await expectModalClosed(page);

  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#historyToggle');
  const historyList = page.locator('#historyList');
  await expect(historyList).toContainText('Паролата е променена.');
  await expect(historyList).not.toContainText('1111');
  await expect(historyList).not.toContainText('9999');
});

test('saving an order as "издаден" keeps its password', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: '4321' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.selectOption('#f_status', 'издаден');
  await page.click('#saveBtn');
  await expectModalClosed(page);
  await expect(row(page, t.customer_name).locator('.password-cell')).toHaveText('4321');
});

test('the quick status change to "издаден" keeps the password', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: '4321' });
  await page.reload();
  const r = row(page, t.customer_name);
  await r.locator('.status-cell .badge').click();
  await r.locator('.status-select').selectOption('издаден');
  await expect(r.locator('.badge')).toHaveText('издаден');
  await expect(r.locator('.password-cell')).toHaveText('4321');
});

test('the header counts orders in "издаден"', async ({ page }) => {
  const stat = page.locator('#stats .stat', { hasText: 'издадени' }).locator('.num');
  await expect(stat).toHaveText(/^\d+$/);
  const before = Number(await stat.textContent());

  const t = await createTicketViaApi(page);
  await page.reload();
  await expect(stat).toHaveText(String(before));
  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('издаден');
  await expect(stat).toHaveText(String(before + 1));

  const labels = await page.locator('#stats .lbl').allInnerTexts();
  expect(labels[labels.length - 1]).toBe('издадени');
});

test('phone numbers not in 0/+359 + 9 digit form get a light red background, but are still saved', async ({ page }) => {
  const good = [
    await createTicketViaApi(page, { phoneContact: '0888 123 456' }),
    await createTicketViaApi(page, { phoneContact: '+359 88 812 3456' }),
    await createTicketViaApi(page, { phoneContact: '0888-123-456' })
  ];
  const bad = [
    await createTicketViaApi(page, { phoneContact: '0888 123 45' }),        // 8 digits after 0
    await createTicketViaApi(page, { phoneContact: '+359 888 123 4567' }),  // 10 digits after +359
    await createTicketViaApi(page, { phoneContact: '888123456' }),          // no leading 0
    await createTicketViaApi(page, { phoneContact: '+49 30 1234567' })      // foreign
  ];
  await page.reload();

  for (const t of good) {
    const phone = row(page, t.customer_name).locator('.cust-phone');
    await expect(phone).not.toHaveClass(/phone-nonstandard/);
    await expect(phone).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  for (const t of bad) {
    const phone = row(page, t.customer_name).locator('.cust-phone');
    await expect(phone).toHaveClass(/phone-nonstandard/);
    await expect(phone).toHaveCSS('background-color', 'rgb(254, 226, 226)');
    await expect(phone).toHaveCSS('color', 'rgb(107, 101, 92)'); // text keeps its usual grey
    await expect(phone).toHaveAttribute('title', /0XXXXXXXXX/);
  }
});

test('the phone field gets a light red background while typing a nonstandard number, and saving still works', async ({ page }) => {
  const name = uniqueName();
  await page.click('#newTicketBtn');
  const phone = page.locator('#f_phone');
  await expect(phone).not.toHaveClass(/phone-nonstandard/);

  await phone.fill('0888 12');
  await expect(phone).toHaveClass(/phone-nonstandard/);
  // Also while focused, where the field normally turns white.
  await expect(phone).toHaveCSS('background-color', 'rgb(254, 226, 226)');
  await phone.fill('0888 123 456');
  await expect(phone).not.toHaveClass(/phone-nonstandard/);
  await phone.fill('12345');
  await expect(phone).toHaveClass(/phone-nonstandard/);

  await page.fill('#f_customer', name);
  await page.fill('#f_model', 'iPhone 14');
  await page.fill('#f_desc', 'тест');
  await page.click('#saveBtn');
  await expectModalClosed(page);
  await expect(row(page, name).locator('.cust-phone')).toHaveText('12345');

  // Reopening shows the warning straight away; a new order starts clean.
  await row(page, name).locator('.ticket-no').click();
  await expect(phone).toHaveClass(/phone-nonstandard/);
  await page.click('#cancelBtn');
  await page.click('#newTicketBtn');
  await expect(phone).not.toHaveClass(/phone-nonstandard/);
});

test('"отказан" and "забравен" are finished: hidden by the "в процес" filter, with their own badges', async ({ page }) => {
  const tag = uniqueName('Затворени');
  const open = await createTicketViaApi(page, { customerName: `${tag} отворена`, status: 'в сервиз' });
  const refused = await createTicketViaApi(page, { customerName: `${tag} отказана`, status: 'отказан' });
  const forgotten = await createTicketViaApi(page, { customerName: `${tag} забравена`, status: 'забравен' });
  await page.reload();

  await expect(row(page, refused.customer_name).locator('.badge')).toHaveCSS('background-color', 'rgb(71, 85, 105)');
  await expect(row(page, forgotten.customer_name).locator('.badge')).toHaveCSS('background-color', 'rgb(154, 52, 18)');

  await page.fill('#searchInput', tag);
  await expect(page.locator('#tableBody tr')).toHaveCount(3);
  await page.selectOption('#statusFilter', '__active__');
  await expect(page.locator('#tableBody tr')).toHaveCount(1);
  await expect(row(page, open.customer_name)).toHaveCount(1);

  await page.selectOption('#statusFilter', 'забравен');
  await expect(row(page, forgotten.customer_name)).toHaveCount(1);
  await expect(page.locator('#tableBody tr')).toHaveCount(1);
});

test('clicking a comment edits only the comment, without opening the order', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'стар коментар' });
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.comment-cell').click();
  await expect(page.locator('#commentOverlay')).toHaveClass(/\bopen\b/);
  await expectModalClosed(page);
  await expect(page.locator('#commentSub')).toContainText(`#${t.ticket_no}`);
  const input = page.locator('#commentInput');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('стар коментар');

  await input.fill('клиентът ще дойде утре');
  await page.click('#commentSaveBtn');
  await expect(page.locator('#commentOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(r.locator('.comment-cell')).toHaveText('клиентът ще дойде утре');

  // Recorded in the order's history like any other edit.
  await r.locator('.ticket-no').click();
  await page.click('#historyToggle');
  await expect(page.locator('#historyList')).toContainText('Коментар: стар коментар → клиентът ще дойде утре');
});

test('a comment can be added to an order that has none, and saved with Ctrl+Enter', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  const cell = row(page, t.customer_name).locator('.comment-cell');
  await expect(cell).toHaveText('—');

  await cell.click();
  await page.locator('#commentInput').fill('нов коментар');
  await page.locator('#commentInput').press('Control+Enter');
  await expect(page.locator('#commentOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(cell).toHaveText('нов коментар');
});

test('cancelling or pressing Escape in the comment editor changes nothing', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'не пипай' });
  await page.reload();
  const cell = row(page, t.customer_name).locator('.comment-cell');

  await cell.click();
  await page.locator('#commentInput').fill('промяна');
  await page.click('#commentCancelBtn');
  await expect(page.locator('#commentOverlay')).not.toHaveClass(/\bopen\b/);

  await cell.click();
  await page.locator('#commentInput').fill('друга промяна');
  await page.locator('#commentInput').press('Escape');
  await expect(page.locator('#commentOverlay')).not.toHaveClass(/\bopen\b/);

  await page.reload();
  await expect(row(page, t.customer_name).locator('.comment-cell')).toHaveText('не пипай');
});

test('saving a comment keeps a colleague\'s other changes made meanwhile', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.comment-cell').click();

  // Someone else changes the status while the comment editor is open.
  await page.request.put(`/api/tickets/${t.id}`, { data: { status: 'чака клиент' } });
  await page.locator('#commentInput').fill('обадих се');
  await page.click('#commentSaveBtn');

  await expect(row(page, t.customer_name).locator('.comment-cell')).toHaveText('обадих се');
  await expect(row(page, t.customer_name).locator('.badge')).toHaveText('чака клиент');
});
