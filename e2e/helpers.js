const { expect } = require('@playwright/test');

const PASSWORD = 'secret123';

// All specs share one database, so every test works with its own
// uniquely-named customers and never depends on what else is in the table.
let counter = 0;
function uniqueName(prefix = 'Клиент') {
  counter += 1;
  return `${prefix} ${Date.now().toString(36)}${counter}`;
}

async function login(page, username = 'alice') {
  await page.goto('/');
  await page.fill('#loginUser', username);
  await page.fill('#loginPass', PASSWORD);
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#whoAmI')).toHaveText(username);
}

// Fast setup through the API, using the page's own login cookie.
async function createTicketViaApi(page, overrides = {}) {
  const res = await page.request.post('/api/tickets', {
    data: {
      customerName: uniqueName(),
      phoneContact: '0888 123 456',
      phoneModel: 'iPhone 15',
      dateReceived: '2026-09-01',
      description: 'Счупен дисплей',
      ...overrides
    }
  });
  expect(res.status()).toBe(201);
  return res.json();
}

function row(page, customerName) {
  return page.locator('#tableBody tr', { hasText: customerName });
}

const modal = page => page.locator('#overlay');

async function expectModalClosed(page) {
  await expect(modal(page)).not.toHaveClass(/\bopen\b/);
}

async function expectModalOpen(page) {
  await expect(modal(page)).toHaveClass(/\bopen\b/);
}

// After creating an order through the form, the app offers to print it;
// close that window to continue.
async function dismissPrintOffer(page) {
  const offer = page.locator("#printOfferOverlay");
  await expect(offer).toHaveClass(new RegExp("(^| )open( |$)"));
  await page.click("#printOfferDoneBtn");
  await expect(offer).not.toHaveClass(new RegExp("(^| )open( |$)"));
}

// Replaces the test server's backup log (newest first), as backup.js
// would leave it. [] = no backups recorded.
function setBackupLog(runs) {
  const dir = require('path').join(process.env.CRAZYPHONE_E2E_DATA_ROOT, 'backups');
  require('fs').mkdirSync(dir, { recursive: true });
  require('fs').writeFileSync(require('path').join(dir, 'backup-log.json'), JSON.stringify(runs));
}

module.exports = {
  PASSWORD, uniqueName, login, createTicketViaApi, row, expectModalOpen, expectModalClosed, dismissPrintOffer,
  setBackupLog
};
