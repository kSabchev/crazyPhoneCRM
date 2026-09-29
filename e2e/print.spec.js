// Printing generates an exact-size PDF (html2canvas + jsPDF) and opens it
// in a new tab. These tests capture that PDF and check its real page size,
// which is what the printer sees.
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row } = require('./helpers');

const PT_PER_MM = 72 / 25.4;

test.beforeEach(async ({ page }) => {
  // Record the PDF blob URL instead of opening a new tab.
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.open = url => { window.__openedUrls.push(url); return null; };
  });
  await login(page, 'alice');
});

// Returns { width, height } in mm of the single page in the opened PDF,
// plus its raw text for further checks.
async function capturePdf(page) {
  await expect.poll(() => page.evaluate(() => window.__openedUrls.length), { timeout: 15000 }).toBe(1);
  const pdf = await page.evaluate(async () => {
    const buf = await (await fetch(window.__openedUrls[0])).arrayBuffer();
    return Array.from(new Uint8Array(buf), b => String.fromCharCode(b)).join('');
  });
  expect(pdf.startsWith('%PDF-')).toBe(true);

  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  expect(boxes).toHaveLength(1);
  const [, x0, y0, x1, y1] = boxes[0].map(Number);
  return { width: (x1 - x0) / PT_PER_MM, height: (y1 - y0) / PT_PER_MM, pdf };
}

test('the customer copy is a 100 × 95 mm landscape card', async ({ page }) => {
  const t = await createTicketViaApi(page, { description: 'Счупен дисплей и заден капак' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#printCustomerBtn');

  const { width, height, pdf } = await capturePdf(page);
  // Regression: without an explicit orientation jsPDF swapped this to a
  // portrait page and the card was clipped.
  expect(width).toBeCloseTo(100, 0);
  expect(height).toBeCloseTo(95, 0);
  expect(pdf).toContain('/Subtype /Image');

  const card = page.locator('#printCustomerTemplate');
  await expect(card).toContainText(t.customer_name);
  await expect(card).toContainText(`№ ${t.ticket_no}`);
  await expect(card).toContainText('СЕРВИЗНА КАРТА');
  await expect(card).toContainText('Счупен дисплей и заден капак');
  await expect(card).toContainText('01.09.2026');
});

test('the service label is a 50 × 30 mm sticker', async ({ page }) => {
  const t = await createTicketViaApi(page, { description: 'Смяна на батерия' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#printServiceBtn');

  const { width, height } = await capturePdf(page);
  expect(width).toBeCloseTo(50, 0);
  expect(height).toBeCloseTo(30, 0);

  const label = page.locator('#printServiceTemplate');
  await expect(label).toContainText(`№ ${t.ticket_no}`);
  await expect(label).toContainText('Смяна на батерия');
});

test('printing also works from the buttons at the top of the form', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.locator('#topActions [data-action="print-service"]').click();

  const { width, height } = await capturePdf(page);
  expect(width).toBeCloseTo(50, 0);
  expect(height).toBeCloseTo(30, 0);
});

test('the service label shows the unlock code; the customer card does not', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: 'Z-шаблон 7' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();

  await page.click('#printServiceBtn');
  await capturePdf(page);
  await expect(page.locator('#printServiceTemplate')).toContainText('Парола: Z-шаблон 7');

  await page.evaluate(() => { window.__openedUrls = []; });
  await page.click('#printCustomerBtn');
  await capturePdf(page);
  await expect(page.locator('#printCustomerTemplate')).not.toContainText('Z-шаблон 7');
});

test('the service label has no password line when none is set', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#printServiceBtn');
  await capturePdf(page);
  await expect(page.locator('#printServiceTemplate .label-password')).toHaveCount(0);
});
