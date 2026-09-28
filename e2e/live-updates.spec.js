// Two staff members (alice and bob) in separate browser sessions, the way
// the shop actually uses the app: changes made by one must appear for the
// other without a reload, and an open ticket must survive those refreshes.
const { test, expect } = require('@playwright/test');
const { login, createTicketViaApi, row, expectModalOpen, expectModalClosed } = require('./helpers');

let alice, bob, aliceCtx, bobCtx;

test.beforeEach(async ({ browser }) => {
  aliceCtx = await browser.newContext();
  bobCtx = await browser.newContext();
  alice = await aliceCtx.newPage();
  bob = await bobCtx.newPage();
  await login(alice, 'alice');
  await login(bob, 'bob');
});

test.afterEach(async () => {
  await aliceCtx.close();
  await bobCtx.close();
});

test('a ticket created by one user appears for the other without a reload', async () => {
  const t = await createTicketViaApi(alice);
  await expect(row(bob, t.customer_name)).toHaveCount(1);
});

test('an edit by one user shows up for the other', async () => {
  const t = await createTicketViaApi(alice);
  await expect(row(bob, t.customer_name)).toHaveCount(1);

  await alice.request.put(`/api/tickets/${t.id}`, { data: { status: 'чака клиент' } });
  await expect(row(bob, t.customer_name).locator('.badge')).toHaveText('чака клиент');
});

test('opening a ticket shows "being viewed by" to others, and clears on close', async () => {
  const t = await createTicketViaApi(alice);
  await expect(row(bob, t.customer_name)).toHaveCount(1);

  await row(bob, t.customer_name).click();
  await expectModalOpen(bob);
  await expect(row(alice, t.customer_name).locator('.editing-badge')).toHaveText('👁 bob');
  // bob never sees a badge for his own open ticket.
  await expect(row(bob, t.customer_name).locator('.editing-badge')).toHaveCount(0);

  await bob.click('#cancelBtn');
  await expect(row(alice, t.customer_name).locator('.editing-badge')).toHaveCount(0);
});

test('opening a ticket someone else has open shows a warning banner', async () => {
  const t = await createTicketViaApi(alice);
  await expect(row(bob, t.customer_name)).toHaveCount(1);

  await row(bob, t.customer_name).click();
  await expect(row(alice, t.customer_name).locator('.editing-badge')).toBeVisible();

  await row(alice, t.customer_name).click();
  await expect(alice.locator('#editingBanner')).toBeVisible();
  await expect(alice.locator('#editingBanner')).toContainText('bob');
});

test('an open ticket keeps unsaved typing while other changes stream in', async () => {
  const mine = await createTicketViaApi(bob);
  await expect(row(bob, mine.customer_name)).toHaveCount(1);

  await row(bob, mine.customer_name).click();
  await bob.fill('#f_comment', 'клиентът ще дойде в петък');

  // alice's change triggers a live table refresh in bob's tab.
  const other = await createTicketViaApi(alice);
  await expect(row(bob, other.customer_name)).toHaveCount(1);

  await expectModalOpen(bob);
  await expect(bob.locator('#f_comment')).toHaveValue('клиентът ще дойде в петък');
  await bob.click('#saveBtn');
  await expectModalClosed(bob);
  await expect(row(alice, mine.customer_name)).toContainText('клиентът ще дойде в петък');
});

test('a settings change reaches other open sessions', async () => {
  const original = await (await alice.request.get('/api/settings')).json();
  try {
    await alice.request.put('/api/settings', {
      data: { statuses: [...original.statuses, 'чака части'] }
    });
    await expect(bob.locator('#statusFilter option', { hasText: 'чака части' })).toHaveCount(1);
    await expect(bob.locator('#f_status option', { hasText: 'чака части' })).toHaveCount(1);
  } finally {
    await alice.request.put('/api/settings', { data: { statuses: original.statuses } });
  }
});
