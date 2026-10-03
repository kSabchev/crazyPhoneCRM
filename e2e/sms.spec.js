// SMS to the customer when an order moves to "чака клиент". The test server
// sends SMS to a fake phone gateway on port 3199 (see e2e/server.js).
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row, expectModalClosed } = require('./helpers');

const GATEWAY = 'http://127.0.0.1:3199';
const smsWindow = page => page.locator('#smsOverlay');

async function sentTo(page, phone) {
  const all = await (await page.request.get(`${GATEWAY}/__sent`)).json();
  return all.filter(m => m.phoneNumbers[0] === phone);
}

test.beforeEach(async ({ page }) => {
  await login(page, 'alice');
});

// A unique, valid number per test so the fake gateway's log can be checked.
let n = 0;
const uniquePhone = () => `0888 ${String(Date.now() % 1000).padStart(3, '0')} ${String(100 + (n++ % 900))}`;
const intl = phone => '+359' + phone.replace(/\s/g, '').slice(1);

test('moving an order to "чака клиент" asks before sending, and sends on confirm', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone, status: 'в сервиз' });
  await page.reload();

  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('чака клиент');

  await expect(smsWindow(page)).toHaveClass(/\bopen\b/);
  await expect(page.locator('#smsTo')).toContainText(intl(phone));
  await expect(page.locator('#smsSub')).toContainText(`#${t.ticket_no}`);
  await expect(page.locator('#smsText')).toHaveValue(`Здравейте! Телефонът Ви по поръчка №${t.ticket_no} е готов. CrazyPhone`);
  await expect(page.locator('#smsCounter')).toContainText('1 SMS');
  expect(await sentTo(page, intl(phone))).toHaveLength(0); // nothing before confirming

  await page.click('#smsConfirmBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);
  const sent = await sentTo(page, intl(phone));
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain(`№${t.ticket_no}`);
});

test('"Не изпращай" sends nothing', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone });
  await page.reload();
  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('чака клиент');

  await expect(smsWindow(page)).toHaveClass(/\bopen\b/);
  await page.click('#smsSkipBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);
  await expect(row(page, t.customer_name).locator('.badge')).toHaveText('чака клиент');
  expect(await sentTo(page, intl(phone))).toHaveLength(0);
});

test('saving the order form with "чака клиент" also asks, and the text can be edited', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.selectOption('#f_status', 'чака клиент');
  await page.click('#saveBtn');
  await expectModalClosed(page);

  await expect(smsWindow(page)).toHaveClass(/\bopen\b/);
  await page.fill('#smsText', 'Телефонът е готов. Работим до 19:00 ч. — CrazyPhone, ул. Примерна 1, тел. 0888 000 000');
  await expect(page.locator('#smsCounter')).toContainText('2 SMS');
  await page.click('#smsConfirmBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);
  const sent = await sentTo(page, intl(phone));
  expect(sent[0].text).toBe('Телефонът е готов. Работим до 19:00 ч. — CrazyPhone, ул. Примерна 1, тел. 0888 000 000');
});

test('no question for other status changes, or when it was already "чака клиент"', async ({ page }) => {
  const t = await createTicketViaApi(page, { status: 'чака клиент' });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.fill('#f_comment', 'само коментар');
  await page.click('#saveBtn');
  await expectModalClosed(page);

  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('издаден');
  await expect(row(page, t.customer_name).locator('.badge')).toHaveText('издаден');
  await page.waitForTimeout(500);
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);
});

test('a nonstandard number cannot be sent to, with an explanation', async ({ page }) => {
  const t = await createTicketViaApi(page, { phoneContact: '0888 12 34' });
  await page.reload();
  await row(page, t.customer_name).locator('.status-cell .badge').click();
  await row(page, t.customer_name).locator('.status-select').selectOption('чака клиент');

  await expect(smsWindow(page)).toHaveClass(/\bopen\b/);
  await expect(page.locator('#smsError')).toContainText('не е валиден');
  await expect(page.locator('#smsConfirmBtn')).toBeDisabled();
  await page.click('#smsSkipBtn');
});

test('the order shows its SMS, and "Изпрати SMS" can send again later', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone });
  await page.reload();

  await row(page, t.customer_name).locator('.ticket-no').click();
  await expect(page.locator('#smsSection')).toBeVisible();
  await expect(page.locator('#smsList')).toContainText('Все още не е изпращан SMS');

  await page.click('#smsSendBtn');
  await expect(smsWindow(page)).toHaveClass(/\bopen\b/);
  await page.click('#smsConfirmBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);

  const entry = page.locator('#smsList .sms-entry').first();
  await expect(entry).toContainText(intl(phone));
  await expect(entry).toContainText('alice');
  await expect(entry).toContainText('изчаква изпращане');

  await page.click('#historyToggle');
  await expect(page.locator('#historyList')).toContainText(`Изпрати SMS до ${intl(phone)}.`);
});

test('a second send within 30 seconds is refused with a clear message', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();

  await page.click('#smsSendBtn');
  await page.click('#smsConfirmBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);

  await page.click('#smsSendBtn');
  await page.click('#smsConfirmBtn');
  await expect(page.locator('#smsError')).toContainText('току-що беше изпратен');
  await expect(page.locator('#smsConfirmBtn')).toHaveText('Опитай отново');
  expect(await sentTo(page, intl(phone))).toHaveLength(1);
});

// ---- Phone status ----
const setHealth = (page, health) => page.request.post(`${GATEWAY}/__health`, { data: health });

test('the header shows that the phone is connected and ready, with details', async ({ page }) => {
  const pill = page.locator('#smsPill');
  await expect(pill).toHaveText('📱 SMS: готов');
  await expect(pill).toHaveClass(/sms-pill-ok/);
  await expect(pill).toHaveAttribute('title', /Батерия: 87% \(зарежда се\)/);
  await expect(pill).toHaveAttribute('title', /Мрежа: WiFi/);
});

test('an unreachable phone shows "няма връзка" in the header and in the SMS window', async ({ page }) => {
  await setHealth(page, { mode: 'down' });
  try {
    const pill = page.locator('#smsPill');
    await pill.click(); // re-check now
    await expect(pill).toHaveText('📱 SMS: няма връзка');
    await expect(pill).toHaveClass(/sms-pill-bad/);

    const t = await createTicketViaApi(page);
    await page.reload();
    await row(page, t.customer_name).locator('.ticket-no').click();
    await page.click('#smsSendBtn');
    await expect(page.locator('#smsPhoneStatus')).toContainText('не отговаря');
    await expect(page.locator('#smsPhoneStatus')).toHaveClass(/sms-phone-bad/);
    await page.click('#smsSkipBtn');
    await page.click('#cancelBtn');
  } finally {
    await setHealth(page, { mode: 'ok' });
  }
  await page.locator('#smsPill').click();
  await expect(page.locator('#smsPill')).toHaveText('📱 SMS: готов');
});

test('a phone reporting low battery shows a warning with the reason', async ({ page }) => {
  await setHealth(page, {
    status: 503,
    body: { status: 'fail', checks: { 'battery:level': { observedValue: 7, status: 'fail' } } }
  });
  try {
    const pill = page.locator('#smsPill');
    await pill.click();
    await expect(pill).toHaveText('📱 SMS: внимание');
    await expect(pill).toHaveAttribute('title', /ниска батерия/);
    await expect(pill).toHaveAttribute('title', /Батерия: 7%/);
  } finally {
    await setHealth(page, { mode: 'ok' });
  }
});

test('the SMS window confirms the phone is ready before sending', async ({ page }) => {
  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#smsSendBtn');
  await expect(page.locator('#smsPhoneStatus')).toContainText('свързан и готов');
  await page.click('#smsSkipBtn');
});

test('Справки lists the SMS sent in the period', async ({ page }) => {
  const phone = uniquePhone();
  const t = await createTicketViaApi(page, { phoneContact: phone });
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#smsSendBtn');
  await page.click('#smsConfirmBtn');
  await expect(smsWindow(page)).not.toHaveClass(/\bopen\b/);

  await page.goto('/reports.html');
  const smsRow = page.locator('#smsTable tr', { hasText: intl(phone) });
  await expect(smsRow).toHaveCount(1);
  await expect(smsRow).toContainText(`#${t.ticket_no}`);
  await expect(smsRow).toContainText(t.customer_name);
  await expect(smsRow).toContainText('alice');
  await expect(page.locator('#smsSummary')).toContainText('SMS части от плана');
});

test('the SMS text can be changed in Настройки, with a part counter', async ({ page }) => {
  const original = await (await page.request.get('/api/settings')).json();
  try {
    await page.goto('/settings.html');
    await expect(page.locator('#smsTemplateInput')).toHaveValue(original.smsTemplate);
    await expect(page.locator('#smsTemplateCounter')).toContainText('1 SMS');
    await page.fill('#smsTemplateInput', 'Поръчка №{номер} ({модел}) е готова. {магазин}');
    await page.click('#saveBtn');
    await expect(page.locator('#saveStatus')).toHaveText('Запазено.');

    await page.goto('/');
    const t = await createTicketViaApi(page, { phoneModel: 'iPhone 13' });
    await page.reload();
    await row(page, t.customer_name).locator('.ticket-no').click();
    await page.click('#smsSendBtn');
    await expect(page.locator('#smsText')).toHaveValue(`Поръчка №${t.ticket_no} (iPhone 13) е готова. CrazyPhone`);
    await page.click('#smsSkipBtn');
  } finally {
    await page.request.put('/api/settings', { data: original });
  }
});

// With SMSAPI.bg configured the wording is about the service, not a phone.
// The test server uses the phone gateway, so these two answers are given
// here the way a server configured for SMSAPI would give them.
test('with SMSAPI.bg, the header and SMS window describe the service and credit', async ({ page }) => {
  await page.route('**/api/sms/config', route => route.fulfill({ json: { enabled: true, provider: 'smsapi' } }));
  await page.route('**/api/sms/status*', route => route.fulfill({ json: {
    state: 'warning', provider: 'smsapi', checkedAt: new Date().toISOString(),
    details: { provider: 'smsapi', credit: 2, sender: 'CrazyPhone', test: false, problems: ['малко кредит — заредете профила в SMSAPI'] }
  } }));
  await page.reload();

  const pill = page.locator('#smsPill');
  await expect(pill).toHaveText('📱 SMS: внимание');
  await expect(pill).toHaveAttribute('title', /SMSAPI\.bg е свързан, но малко кредит/);
  await expect(pill).toHaveAttribute('title', /Кредит: 2/);
  await expect(pill).toHaveAttribute('title', /Подател: CrazyPhone/);
  await expect(pill).not.toHaveAttribute('title', /Батерия|Телефонът/);

  const t = await createTicketViaApi(page);
  await page.reload();
  await row(page, t.customer_name).locator('.ticket-no').click();
  await page.click('#smsSendBtn');
  await expect(page.locator('#smsViaHint')).toHaveText('Изпраща се чрез SMSAPI.bg');
  await expect(page.locator('#smsPhoneStatus')).toContainText('SMSAPI.bg');
  await page.click('#smsSkipBtn');
});
