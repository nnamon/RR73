// Updating while an older copy of RR73 still runs, in WebKit and Chromium.
//
// RR73 0.4.x opened the database at version 1 and never closed it for a newer version. On a
// phone that kept a 0.4.x page alive, 0.5.0 waited for its upgrade before the first render and
// showed a blank screen until that page closed. The app now opens at once with the stored
// settings, says why the log waits, and finishes the upgrade by itself once the older copy closes.
import { expect, test, type Page } from '@playwright/test';

/** Opens the database as 0.4.x did, in another page of the same origin, and keeps it open. */
async function olderCopy(page: Page, settings: Record<string, unknown>) {
  // A file of the app's origin that runs none of the app.
  await page.goto('./manifest.webmanifest');
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('rr73', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv', { keyPath: 'key' });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          (window as unknown as { held: IDBDatabase }).held = db;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ key: 'settings', value });
          tx.oncomplete = () => resolve();
        };
      }),
    settings,
  );
}

const version = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'rr73')?.version ?? null);

test('opens while an older copy holds the database, says so, and finishes the upgrade when it closes', async ({ page, context }) => {
  const old = await context.newPage();
  await olderCopy(old, { callsign: '9V1NE', theme: 'dark' });

  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 5000 });
  // The stored settings show at once, read without the upgrade.
  await expect(page.getByRole('textbox', { name: 'Callsign' })).toHaveValue('9V1NE');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const notice = page.getByTestId('status-notice');
  // Reported after 1.5 s of waiting; a loaded test machine takes longer.
  await expect(notice).toContainText('Close other copies of RR73 to finish updating.', { timeout: 15_000 });
  await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.goto('./#/log');
  await expect(page.getByText('The log opens when other copies of RR73 close.')).toBeVisible();
  expect(await version(page)).toBe(1);

  await old.close();
  await expect(notice).toBeHidden();
  await expect(page.getByText('No QSOs yet')).toBeVisible();
  expect(await version(page)).toBe(2);
  await page.goto('./#/settings');
  await expect(page.getByRole('textbox', { name: 'Callsign' })).toHaveValue('9V1NE');
});

test('a change made while the upgrade waits is stored once it finishes', async ({ page, context }) => {
  const old = await context.newPage();
  await olderCopy(old, { callsign: '9V1NE' });
  await page.goto('./#/settings');
  await expect(page.getByTestId('status-notice')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Dark', { exact: true }).click();
  await old.close();
  await expect(page.getByTestId('status-notice')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Callsign' })).toHaveValue('9V1NE');
});

test('a page whose build the server replaced says so, and reloads at the next change of screen', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Operate' })).toBeAttached();
  // The server now has a newer build: its index.html names another main script, and this build's files are gone.
  await page.route('**/index.html', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-N3wBu1ld.js') });
  });
  await page.route('**/assets/gone-*.js', (route) => route.fulfill({ status: 404, body: 'File not found' }));
  await page.evaluate(() => {
    (window as unknown as { marker: boolean }).marker = true;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'assets/gone-Q1w2e3.js';
    document.head.append(s);
  });
  const notice = page.getByTestId('status-notice');
  await expect(notice).toContainText('A new version of RR73 is ready.', { timeout: 15_000 });
  await Promise.all([page.waitForEvent('load'), page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Log' }).click()]);
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker ?? false)).toBe(false);
  await expect(page.getByRole('heading', { level: 1, name: 'Log' })).toBeVisible();
});

test('a failed load with the same build on the server changes nothing', async ({ page }) => {
  await page.goto('./');
  await page.route('**/assets/gone-*.js', (route) => route.fulfill({ status: 404, body: 'File not found' }));
  const checked = page.waitForResponse('**/index.html');
  await page.evaluate(() => {
    (window as unknown as { marker: boolean }).marker = true;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'assets/gone-Q1w2e3.js';
    document.head.append(s);
  });
  await checked;
  await page.waitForTimeout(500);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Log' })).toBeVisible();
  await page.waitForTimeout(1000);
  // No notice, and the same page: nothing reloaded.
  await expect(page.getByTestId('status-notice')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker ?? false)).toBe(true);
});
