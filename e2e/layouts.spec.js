// The compact table view (desktop) and the card layout (phones).
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row, expectModalOpen, expectModalClosed } = require('./helpers');

const longText = 'Счупен дисплей, не реагира на допир в долната част и батерията се надува при зареждане';

test.describe('compact view', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'alice');
    await page.evaluate(() => localStorage.removeItem('compactTable'));
    await page.reload();
  });

  test('puts each order on one line, cuts long texts, and is remembered', async ({ page }) => {
    const t = await createTicketViaApi(page, { description: longText });
    await page.reload();
    const r = row(page, t.customer_name);
    // Measured in one step (a live refresh can redraw the row at any moment).
    const height = async () => { await expect(r).toBeVisible(); return r.evaluate(el => el.getBoundingClientRect().height); };

    const normal = await height();
    await page.click('#compactToggle');
    await expect(page.locator('#compactToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ticketTable')).toHaveClass(/\bcompact\b/);
    const compact = await height();
    expect(compact).toBeLessThan(normal * 0.6);

    // Long text is cut on screen; the full text is still there on hover.
    const issue = r.locator('td[data-field="issue"]');
    expect(await issue.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(issue).toHaveAttribute('title', longText);

    await page.reload();
    await expect(page.locator('#ticketTable')).toHaveClass(/\bcompact\b/);
    await page.click('#compactToggle');
    await expect(page.locator('#ticketTable')).not.toHaveClass(/\bcompact\b/);
  });

  test('everything still works in compact view', async ({ page }) => {
    await page.click('#compactToggle');
    const t = await createTicketViaApi(page);
    await page.reload();
    const r = row(page, t.customer_name);
    await r.locator('.status-cell .badge').click();
    await r.locator('.status-select').selectOption('в сервиз');
    await expect(r.locator('.badge')).toHaveText('в сервиз');
    await r.locator('.ticket-no').click();
    await expectModalOpen(page);
  });
});

test.describe('phone cards', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await login(page, 'alice');
  });

  test('orders are shown as cards with the main fields and labels', async ({ page }) => {
    const t = await createTicketViaApi(page, {
      phoneModel: 'iPhone 13', description: 'Не зарежда', customerPrice: '80', kaparo: '20',
      phonePassword: '1234', comment: 'скрит на телефон', status: 'чака клиент'
    });
    await page.reload();
    await expect(page.locator('#ticketTable thead')).toBeHidden();
    const card = row(page, t.customer_name);
    expect(await card.evaluate(el => getComputedStyle(el).display)).toBe('grid');

    await expect(card.locator('td[data-field="status"] .badge')).toHaveText('чака клиент');
    await expect(card.locator('td[data-field="model"]')).toBeVisible();
    expect(await card.locator('td[data-field="model"]').evaluate(el => getComputedStyle(el, '::before').content)).toBe('"Модел: "');
    await expect(card.locator('td[data-field="customerPrice"]')).toHaveText(/80,00\s€/);
    await expect(card.locator('.call-icon-btn')).toHaveAttribute('href', 'tel:0888123456');

    // Less-needed fields are left for the full order.
    for (const field of ['password', 'comment', 'repairPerformed', 'servicePrice', 'pravim']) {
      await expect(card.locator(`td[data-field="${field}"]`)).toBeHidden();
    }
    // Fits the screen: no sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#compactToggle')).toBeHidden();
  });

  test('tapping a card opens the order; the status dropdown works on a card', async ({ page }) => {
    const t = await createTicketViaApi(page);
    await page.reload();
    const card = row(page, t.customer_name);

    await card.locator('td[data-field="status"] .badge').click();
    await card.locator('.status-select').selectOption('в сервиз');
    await expect(card.locator('.badge')).toHaveText('в сервиз');
    await expectModalClosed(page);

    await card.locator('td[data-field="customer"]').click();
    await expectModalOpen(page);
    await expect(page.locator('#f_customer')).toHaveValue(t.customer_name);
  });

  test('columns hidden in Settings stay hidden on cards', async ({ page }) => {
    const original = await (await page.request.get('/api/settings')).json();
    try {
      await page.request.put('/api/settings', { data: { columns: original.columns.filter(c => c !== 'model') } });
      const t = await createTicketViaApi(page);
      await page.reload();
      await expect(row(page, t.customer_name).locator('td[data-field="model"]')).toBeHidden();
      await expect(row(page, t.customer_name).locator('td[data-field="issue"]')).toBeVisible();
    } finally {
      await page.request.put('/api/settings', { data: original });
    }
  });
});
