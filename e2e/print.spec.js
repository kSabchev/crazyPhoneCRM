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

// The service label is a P-touch Editor (.lbx) file for the Brother
// QL-600, downloaded rather than opened as a PDF.
async function downloadServiceLabel(page, button) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return download;
}

test('the service label downloads as a .lbx file', async ({ page }) => {
  const t = await createTicketViaApi(page, { description: 'Смяна на батерия' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();

  const download = await downloadServiceLabel(page, page.locator('#printServiceBtn'));
  expect(download.suggestedFilename()).toBe(`poruchka-${t.ticket_no}.lbx`);
  expect(download.url()).toContain(`/api/tickets/${t.id}/service-label.lbx`);
});

test('printing also works from the buttons at the top of the form', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();

  const download = await downloadServiceLabel(page, page.locator('#topActions [data-action="print-service"]'));
  expect(download.suggestedFilename()).toBe(`poruchka-${t.ticket_no}.lbx`);
});

test('the customer card does not show the unlock code', async ({ page }) => {
  const t = await createTicketViaApi(page, { phonePassword: 'Z-шаблон 7' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#printCustomerBtn');
  await capturePdf(page);
  await expect(page.locator('#printCustomerTemplate')).not.toContainText('Z-шаблон 7');
});
