// The backup log: the latest runs at the bottom of Справки (green / red),
// and a notice right after an admin logs in if any of them failed.
const assert = require('node:assert/strict');
const { test, expect } = require('@playwright/test');
const { login, setBackupLog } = require('./helpers');

const ok = (startedAt, file) => ({ startedAt, finishedAt: startedAt, ok: true, file, sizeBytes: 2.5 * 1024 * 1024, nas: 'ok', error: null });
const failed = (startedAt, error) => ({ startedAt, finishedAt: startedAt, ok: false, file: null, sizeBytes: null, nas: 'off', error });

// Every other spec logs in as an admin: never leave a failed run behind.
test.afterEach(() => setBackupLog([]));

test('Справки lists the latest backups, successful ones green and failed ones red', async ({ page }) => {
  setBackupLog([
    ok('2026-10-04T00:30:00.000Z', 'repair-log_2026-10-04T00-30-00.db'),
    failed('2026-10-03T00:30:00.000Z', 'Базата данни не е намерена (D:\data\repair-log.db)'),
    ok('2026-10-02T00:30:00.000Z', 'repair-log_2026-10-02T00-30-00.db')
  ]);
  await login(page, 'alice');
  await page.locator('#backupAlertDoneBtn').click(); // the notice; tested below
  await page.goto('/reports.html');

  const rows = page.locator('#backupTable tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveClass(/backup-row-ok/);
  await expect(rows.nth(0)).toContainText('✓ успешно');
  await expect(rows.nth(0)).toContainText('04.10.2026');
  await expect(rows.nth(0)).toContainText('2,5 MB');
  await expect(rows.nth(0)).toContainText('копирано');
  await expect(rows.nth(1)).toHaveClass(/backup-row-failed/);
  await expect(rows.nth(1)).toContainText('✗ неуспешно');
  await expect(rows.nth(1)).toContainText('Базата данни не е намерена');

  // Green and red backgrounds, so they're told apart at a glance.
  await expect(rows.nth(0).locator('td').first()).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  await expect(rows.nth(1).locator('td').first()).toHaveCSS('background-color', 'rgb(254, 226, 226)');
});

test('with no backups recorded yet, Справки says so', async ({ page }) => {
  await login(page, 'alice');
  await page.goto('/reports.html');
  await expect(page.locator('#backupTable')).toContainText('Все още няма записани резервни копия');
});

test('after an admin logs in, a failed backup among the latest is announced', async ({ page }) => {
  setBackupLog([
    ok('2026-10-04T00:30:00.000Z', 'a.db'),
    failed('2026-10-03T00:30:00.000Z', 'Локалното копие е запазено, но копирането към NAS не успя: ENOENT')
  ]);
  await login(page, 'alice');
  const notice = page.locator('#backupAlertOverlay');
  await expect(notice).toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupAlertSub')).toHaveText('1 от последните 2 резервни копия е неуспешно:');
  await expect(page.locator('#backupAlertList li')).toHaveCount(1);
  await expect(page.locator('#backupAlertList')).toContainText('копирането към NAS не успя');

  await page.locator('#backupAlertDoneBtn').click();
  await expect(notice).not.toHaveClass(/\bopen\b/);
});

test('the notice links to the backups in Справки', async ({ page }) => {
  setBackupLog([failed('2026-10-03T00:30:00.000Z', 'грешка')]);
  await login(page, 'alice');
  await page.locator('#backupAlertReportsLink').click();
  await expect(page).toHaveURL(/\/reports\.html#backups$/);
  await expect(page.locator('#backupTable tr.backup-row-failed')).toHaveCount(1);
});

test('no notice when the latest backups all succeeded, or for staff', async ({ page }) => {
  setBackupLog([ok('2026-10-04T00:30:00.000Z', 'a.db')]);
  await login(page, 'alice');
  await page.waitForTimeout(500);
  await expect(page.locator('#backupAlertOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupWarning')).toBeHidden();

  // Staff can't do anything about backups (and Справки is admin-only).
  setBackupLog([failed('2026-10-03T00:30:00.000Z', 'грешка')]);
  await page.click('#logoutBtn');
  await login(page, 'bob');
  await page.waitForTimeout(800);
  await expect(page.locator('#backupAlertOverlay')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupWarning')).toBeHidden();
});

test('reopening the page shows the red sign, not the notice; the sign opens it again', async ({ page }) => {
  setBackupLog([failed('2026-10-03T00:30:00.000Z', 'грешка при копиране')]);
  await login(page, 'alice');
  await page.locator('#backupAlertDoneBtn').click();

  await page.reload();
  await expect(page.locator('#whoAmI')).toHaveText('alice');
  const sign = page.locator('#backupWarning');
  await expect(sign).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#backupAlertOverlay')).not.toHaveClass(/\bopen\b/);

  // Left of "общо поръчки", on the counters' row. Measured together in one
  // step: the counters are rebuilt on every redraw.
  const [signBox, totalBox] = await page.evaluate(() =>
    [document.getElementById('backupWarning'), document.querySelector('#stats .stat')]
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  assert.ok(signBox.x + signBox.width <= totalBox.x, 'sign is left of the counters');
  assert.ok(Math.abs((signBox.y + signBox.height / 2) - (totalBox.y + totalBox.height / 2)) < 20, 'on the same row');

  await sign.click();
  await expect(page.locator('#backupAlertOverlay')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupAlertList')).toContainText('грешка при копиране');
});

test('a backup that fails while an admin is logged in is announced straight away', async ({ page }) => {
  setBackupLog([ok('2026-10-03T00:30:00.000Z', 'a.db')]);
  await login(page, 'alice');
  await expect(page.locator('#backupWarning')).toBeHidden();

  // Tonight's backup fails (the server notices within a moment in tests).
  setBackupLog([failed('2026-10-04T00:30:00.000Z', 'Базата данни не е намерена'), ok('2026-10-03T00:30:00.000Z', 'a.db')]);
  await expect(page.locator('#backupAlertOverlay')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupAlertList')).toContainText('Базата данни не е намерена');
  await page.locator('#backupAlertDoneBtn').click();
  await expect(page.locator('#backupWarning')).toBeVisible();

  // A successful run after it doesn't pop up again (the failure is known)...
  setBackupLog([ok('2026-10-05T00:30:00.000Z', 'b.db'), failed('2026-10-04T00:30:00.000Z', 'Базата данни не е намерена')]);
  await page.waitForTimeout(1200);
  await expect(page.locator('#backupAlertOverlay')).not.toHaveClass(/\bopen\b/);

  // ...but another failure does.
  setBackupLog([failed('2026-10-06T00:30:00.000Z', 'NAS'), ok('2026-10-05T00:30:00.000Z', 'b.db'), failed('2026-10-04T00:30:00.000Z', 'Базата данни не е намерена')]);
  await expect(page.locator('#backupAlertOverlay')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#backupAlertList li')).toHaveCount(2);

  // Once the latest runs are all successful again, the sign goes away.
  await page.locator('#backupAlertDoneBtn').click();
  setBackupLog([ok('2026-10-07T00:30:00.000Z', 'c.db')]);
  await expect(page.locator('#backupWarning')).toBeHidden();
});
