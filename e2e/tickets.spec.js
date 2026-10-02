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

  await r.locator('.ticket-no').click();
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
  expect(labels.indexOf('издадени')).toBe(labels.indexOf('чакат клиент') + 1);
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
  await expect(page.locator('#quickEditOverlay')).toHaveClass(/\bopen\b/);
  await expectModalClosed(page);
  await expect(page.locator('#quickEditSub')).toContainText(`#${t.ticket_no}`);
  const input = page.locator('#quickEditInput');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('стар коментар');

  await input.fill('клиентът ще дойде утре');
  await page.click('#quickEditSaveBtn');
  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);
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
  await page.locator('#quickEditInput').fill('нов коментар');
  await page.locator('#quickEditInput').press('Control+Enter');
  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(cell).toHaveText('нов коментар');
});

test('cancelling or pressing Escape in the comment editor changes nothing', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'не пипай' });
  await page.reload();
  const cell = row(page, t.customer_name).locator('.comment-cell');

  await cell.click();
  await page.locator('#quickEditInput').fill('промяна');
  await page.click('#quickEditCancelBtn');
  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);

  await cell.click();
  await page.locator('#quickEditInput').fill('друга промяна');
  await page.locator('#quickEditInput').press('Escape');
  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);

  await page.reload();
  await expect(row(page, t.customer_name).locator('.comment-cell')).toHaveText('не пипай');
});

test('saving a comment keeps a colleague\'s other changes made meanwhile', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.comment-cell').click();

  // Someone else changes the status while the comment editor is open.
  await page.request.put(`/api/tickets/${t.id}`, { data: { status: 'чака клиент' } });
  await page.locator('#quickEditInput').fill('обадих се');
  await page.click('#quickEditSaveBtn');

  await expect(row(page, t.customer_name).locator('.comment-cell')).toHaveText('обадих се');
  await expect(row(page, t.customer_name).locator('.badge')).toHaveText('чака клиент');
});

test('the header counts "отказани" and "забравени", and the form offers both statuses', async ({ page }) => {
  const stat = label => page.locator('#stats .stat', { hasText: label }).locator('.num');
  const labels = await page.locator('#stats .lbl').allInnerTexts();
  expect(labels.slice(-3)).toEqual(['издадени', 'отказани', 'забравени']);
  await expect(stat('отказани')).toHaveCSS('color', 'rgb(71, 85, 105)');
  await expect(stat('забравени')).toHaveCSS('color', 'rgb(154, 52, 18)');
  const refusedBefore = Number(await stat('отказани').textContent());
  const forgottenBefore = Number(await stat('забравени').textContent());

  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#f_status option')).toHaveText(['за сервиз', 'в сервиз', 'чака клиент', 'издаден', 'отказан', 'забравен']);
  await page.selectOption('#f_status', 'отказан');
  await page.click('#saveBtn');
  await expectModalClosed(page);
  await expect(stat('отказани')).toHaveText(String(refusedBefore + 1));

  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('забравен');
  await expect(stat('забравени')).toHaveText(String(forgottenBefore + 1));
  await expect(stat('отказани')).toHaveText(String(refusedBefore));
});

test('clicking "Извършен ремонт" edits only that field, without opening the order', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'не пипай' });
  await page.reload();
  const r = row(page, t.customer_name);
  const cell = r.locator('.repair-cell');
  await expect(cell).toHaveText('—');

  await cell.click();
  await expect(page.locator('#quickEditOverlay')).toHaveClass(/\bopen\b/);
  await expectModalClosed(page);
  await expect(page.locator('#quickEditTitle')).toHaveText('Извършен ремонт');
  await expect(page.locator('#quickEditInput')).toBeFocused();
  await page.locator('#quickEditInput').fill('Сменен дисплей и батерия');
  await page.locator('#quickEditInput').press('Control+Enter');

  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(cell).toHaveText('Сменен дисплей и батерия');
  await expect(r.locator('.comment-cell')).toHaveText('не пипай');

  // Reopening shows the saved text; the comment editor still shows the comment.
  await cell.click();
  await expect(page.locator('#quickEditInput')).toHaveValue('Сменен дисплей и батерия');
  await page.locator('#quickEditInput').press('Escape');
  await r.locator('.comment-cell').click();
  await expect(page.locator('#quickEditTitle')).toHaveText('Коментар');
  await expect(page.locator('#quickEditInput')).toHaveValue('не пипай');
});

test('clicking Парола edits only the password, on one line, Enter saves', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: '1111', comment: 'не пипай' });
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.password-cell').click();
  await expectModalClosed(page);
  await expect(page.locator('#quickEditTitle')).toHaveText('Парола');
  await expect(page.locator('#quickEditInput')).toBeHidden();
  const line = page.locator('#quickEditLine');
  await expect(line).toBeVisible();
  await expect(line).toBeFocused();
  await expect(line).toHaveValue('1111');
  await expect(page.locator('#quickEditHint')).toHaveText('Enter запазва, Esc затваря');

  await line.fill('Г-шаблон 2580');
  await line.press('Enter');
  await expect(page.locator('#quickEditOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(r.locator('.password-cell')).toHaveText('Г-шаблон 2580');
  await expect(r.locator('.comment-cell')).toHaveText('не пипай');

  // The history notes the change without the value.
  await r.locator('.ticket-no').click();
  await page.click('#historyToggle');
  await expect(page.locator('#historyList')).toContainText('Паролата е променена.');
  await expect(page.locator('#historyList')).not.toContainText('2580');
});

test('clicking a price edits it as an amount; empty removes the price', async ({ page }) => {
  const t = await createTicketViaApi(page, { servicePrice: '30', customerPrice: '80' });
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.customer-price-cell').click();
  await expectModalClosed(page);
  await expect(page.locator('#quickEditTitle')).toHaveText('Продажна цена (€)');
  const line = page.locator('#quickEditLine');
  // A text field with a numeric keyboard: no up/down arrows.
  await expect(line).toHaveAttribute('type', 'text');
  await expect(line).toHaveAttribute('inputmode', 'decimal');
  await expect(line).toHaveValue('80');
  await line.fill('95.5');
  await line.press('Enter');
  await expect(r.locator('.customer-price-cell')).toHaveText(/^95,50\s€$/);
  await expect(r.locator('.service-price-cell')).toHaveText(/^30,00\s€$/);

  await r.locator('.service-price-cell').click();
  await expect(page.locator('#quickEditTitle')).toHaveText('Изкупна цена (€)');
  await line.fill('');
  await page.click('#quickEditSaveBtn');
  await expect(r.locator('.service-price-cell')).toHaveText('—');
  await expect(r.locator('.customer-price-cell')).toHaveText(/^95,50\s€$/);
});

test('a negative price is rejected with a message and nothing changes', async ({ page }) => {
  const t = await createTicketViaApi(page, { customerPrice: '80' });
  await page.reload();
  const r = row(page, t.customer_name);
  await r.locator('.customer-price-cell').click();
  await page.locator('#quickEditLine').fill('-5');

  let message = null;
  page.once('dialog', d => { message = d.message(); d.accept(); });
  await page.locator('#quickEditLine').press('Enter');
  await expect.poll(() => message).toContain('невалидна сума');
  await expect(page.locator('#quickEditOverlay')).toHaveClass(/\bopen\b/);
  await page.locator('#quickEditLine').press('Escape');
  await expect(r.locator('.customer-price-cell')).toHaveText(/^80,00\s€$/);
});

test('after a price edit, the comment editor is multi-line again', async ({ page }) => {
  const t = await createTicketViaApi(page, { comment: 'ред 1' });
  await page.reload();
  const r = row(page, t.customer_name);
  await r.locator('.customer-price-cell').click();
  await page.locator('#quickEditLine').press('Escape');
  await r.locator('.comment-cell').click();
  await expect(page.locator('#quickEditInput')).toBeVisible();
  await expect(page.locator('#quickEditLine')).toBeHidden();
  await expect(page.locator('#quickEditInput')).toHaveValue('ред 1');
  await expect(page.locator('#quickEditHint')).toHaveText('Ctrl+Enter запазва, Esc затваря');
});

test('money is shown as "25,00 €" in the table, history and customer print', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.reload();
  const t = await createTicketViaApi(page, { servicePrice: '30', customerPrice: '1234.5', kaparo: '20' });
  const noDeposit = await createTicketViaApi(page);
  await page.reload();
  const r = row(page, t.customer_name);

  await expect(r.locator('.service-price-cell')).toHaveText(/^30,00\s€$/);
  await expect(r.locator('.customer-price-cell')).toHaveText(/^1234,50\s€$/);
  await expect(r.locator('td').filter({ hasText: /^20,00\s€$/ })).toHaveCount(1);
  // "Не" (no deposit) and empty prices are shown as before.
  await expect(row(page, noDeposit.customer_name).locator('.customer-price-cell')).toHaveText('—');
  await expect(row(page, noDeposit.customer_name)).toContainText('Не');

  // History: old and new amounts in the same format.
  await r.locator('.customer-price-cell').click();
  await page.locator('#quickEditLine').fill('99.9');
  await page.locator('#quickEditLine').press('Enter');
  await r.locator('.ticket-no').click();
  await page.click('#historyToggle');
  await expect(page.locator('#historyList')).toContainText(/Продажна цена: 1234,50\s€ → 99,90\s€/);

  // The printed customer card shows the deposit and the price as money too.
  await page.click('#printCustomerBtn');
  await expect(page.locator('#printCustomerTemplate')).toContainText(/Капаро:\s*20,00\s€/);
  await expect(page.locator('#printCustomerTemplate')).toContainText(/Цена:\s*99,90\s€/);
});

test('Капаро is green in the table when it equals the selling price', async ({ page }) => {
  const paid = await createTicketViaApi(page, { customerPrice: '25.5', kaparo: '25,50' });
  const partial = await createTicketViaApi(page, { customerPrice: '25.5', kaparo: '10' });
  const noPrice = await createTicketViaApi(page, { kaparo: '10' });
  await page.reload();

  await expect(row(page, paid.customer_name).locator('td.kaparo-paid')).toHaveText(/^25,50\s€$/);
  await expect(row(page, partial.customer_name).locator('td.kaparo-paid')).toHaveCount(0);
  await expect(row(page, noPrice.customer_name).locator('td.kaparo-paid')).toHaveCount(0);
});

test('prices can be typed with a decimal comma, in the quick editor and the order form', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  const r = row(page, t.customer_name);

  await r.locator('.customer-price-cell').click();
  await page.locator('#quickEditLine').fill('25,50');
  await page.locator('#quickEditLine').press('Enter');
  await expect(r.locator('.customer-price-cell')).toHaveText(/^25,50\s€$/);

  // Reopening shows the amount with a comma, ready to edit.
  await r.locator('.customer-price-cell').click();
  await expect(page.locator('#quickEditLine')).toHaveValue('25,5');
  await page.locator('#quickEditLine').press('Escape');

  // The order form: text fields with a numeric keyboard, no arrows.
  await r.locator('.ticket-no').click();
  for (const id of ['#f_service_price', '#f_customer_price']) {
    await expect(page.locator(id)).toHaveAttribute('type', 'text');
    await expect(page.locator(id)).toHaveAttribute('inputmode', 'decimal');
  }
  await expect(page.locator('#f_customer_price')).toHaveValue('25,5');
  await page.fill('#f_service_price', '12,3');
  await page.click('#saveBtn');
  await expectModalClosed(page);
  await expect(r.locator('.service-price-cell')).toHaveText(/^12,30\s€$/);
});

test('an invalid amount in the order form is refused with the field named', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.fill('#f_customer_price', '12,5,0');
  let message = null;
  page.once('dialog', d => { message = d.message(); d.accept(); });
  await page.click('#saveBtn');
  await expect.poll(() => message).toContain('Продажна цена: невалидна сума');
  await expectModalOpen(page);
});

test('the header counters filter the table, and clicking again shows all', async ({ page }) => {
  const tag = uniqueName('Брояч');
  const waiting = await createTicketViaApi(page, { customerName: `${tag} чака`, status: 'чака клиент' });
  const other = await createTicketViaApi(page, { customerName: `${tag} в сервиз`, status: 'в сервиз' });
  await page.reload();

  const counter = label => page.locator('#stats .stat', { hasText: label });
  const filter = page.locator('#statusFilter');

  await counter('чакат клиент').click();
  await expect(filter).toHaveValue('чака клиент');
  await expect(counter('чакат клиент')).toHaveClass(/\bactive\b/);
  await expect(counter('чакат клиент')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, waiting.customer_name)).toHaveCount(1);
  await expect(row(page, other.customer_name)).toHaveCount(0);
  // Every row shown is in that status, and the count matches.
  const shown = await page.locator('#tableBody tr .badge').allInnerTexts();
  expect(new Set(shown)).toEqual(new Set(['чака клиент']));
  expect(String(shown.length)).toBe(await counter('чакат клиент').locator('.num').textContent());

  // Clicking the active counter again clears the filter.
  await counter('чакат клиент').click();
  await expect(filter).toHaveValue('');
  await expect(counter('чакат клиент')).not.toHaveClass(/\bactive\b/);
  await expect(row(page, other.customer_name)).toHaveCount(1);

  // "общо поръчки" always shows everything.
  await counter('в сервиза').click();
  await expect(row(page, waiting.customer_name)).toHaveCount(0);
  await counter('общо поръчки').click();
  await expect(filter).toHaveValue('');
  await expect(row(page, waiting.customer_name)).toHaveCount(1);
});

test('choosing a status in the dropdown highlights its counter', async ({ page }) => {
  await page.selectOption('#statusFilter', 'издаден');
  await expect(page.locator('#stats .stat.active')).toHaveCount(1);
  await expect(page.locator('#stats .stat.active')).toContainText('издадени');
  await page.selectOption('#statusFilter', '__active__');
  await expect(page.locator('#stats .stat.active')).toHaveCount(0);
});

test('the chosen filter survives a live-update reconnect and settings reload', async ({ page }) => {
  await page.locator('#stats .stat', { hasText: 'чакат клиент' }).click();
  await expect(page.locator('#statusFilter')).toHaveValue('чака клиент');

  // A reconnect reloads settings (and rebuilds the dropdown).
  await page.evaluate(() => { disconnectLiveUpdates(); connectLiveUpdates(); });
  await page.evaluate(() => loadSettings());
  await expect(page.locator('#statusFilter')).toHaveValue('чака клиент');
  await expect(page.locator('#stats .stat.active')).toContainText('чакат клиент');
});

test('the counters work from the keyboard', async ({ page }) => {
  await page.locator('#stats .stat', { hasText: 'забравени' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#statusFilter')).toHaveValue('забравен');
});
