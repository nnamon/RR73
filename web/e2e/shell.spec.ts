// The app shell: tabs, headings, settings stored in IndexedDB, version history and the update notice.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptySeed, seed, withFeatures } from './log-data';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

test('the tab bar moves between screens and marks the current one', async ({ page }) => {
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Operate' })).toHaveAttribute('aria-current', 'page');
  await seed(page, withFeatures(emptySeed(), { activations: true }));
  for (const [name, heading] of [
    ['Log', 'Log'],
    ['Spots', 'Spots'],
    ['Settings', 'Settings'],
  ] as const) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle(`${heading} · RR73`);
  }
});

test('the empty tabs say what will appear', async ({ page }) => {
  await page.goto('./#/log');
  await expect(page.getByText('No QSOs yet')).toBeVisible();
  await seed(page, withFeatures(emptySeed(), { activations: true, potaSpots: true }));
  await page.goto('./#/spots');
  await expect(page.getByRole('button', { name: /^Start activation/ })).toBeVisible();
  await expect(page.getByText(/^No spots yet\. POTA spots on your bands/)).toBeVisible();
});

test('three tabs on a new install, and an old Activate link opens Optional features', async ({ page }) => {
  await page.goto('./#/activate');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
  await expect(page).toHaveURL(/#\/settings\/features$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('The Spots tab shows while Activations, POTA spots or Cluster spots is on.', { exact: false })).toBeVisible();
});

test('with Activations on, an old Activate link opens Spots', async ({ page }) => {
  await page.goto('./');
  await seed(page, withFeatures(emptySeed(), { activations: true }));
  await page.goto('./#/activate');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Operate', 'Log', 'Spots', 'Settings']);
  await expect(page.getByRole('heading', { level: 1, name: 'Spots' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Spots' })).toHaveAttribute('aria-current', 'page');
});

test('Operate shows the band, the frequency and the empty decode list', async ({ page }) => {
  await page.goto('./');
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('20m');
  await expect(band).toContainText('FT8');
  await expect(band).toContainText('14.074 MHz · USB');
  await expect(page.getByText('No decodes yet')).toBeVisible();
});

test('changing band updates the header', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await sheet.getByText('40m', { exact: true }).click();
  await sheet.getByText('FT4', { exact: true }).click();
  await expect(sheet.getByText('7.0475 MHz')).toBeVisible();
  await sheet.getByRole('button', { name: 'Use 40m FT4' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^Change band/ })).toContainText('7.0475 MHz · USB');
});

test('the callsign is stored on the phone and marks nothing until set', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await expect(field).toHaveValue('');
  await field.fill('9v1ne');
  await field.press('Enter');
  await expect(field).toHaveValue('9V1NE');
  // The IndexedDB write is asynchronous: reload only once it has committed.
  await expect.poll(() => storedSettings(page)).toMatchObject({ key: 'settings', value: { callsign: '9V1NE' } });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Callsign' })).toHaveValue('9V1NE');
});

test('Use GPS sets the 6-character grid from a fine fix', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.8198, accuracy: 30 });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Use GPS' }).click();
  await expect(page.getByRole('textbox', { name: 'Grid' })).toHaveValue('OJ11vi');
  await expect.poll(() => storedSettings(page)).toMatchObject({ value: { grid: 'OJ11vi' } });
});

test('Use GPS gives the 4-character square from a coarse fix and says why', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 1.3521, longitude: 103.8198, accuracy: 3200 });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Use GPS' }).click();
  await expect(page.getByRole('textbox', { name: 'Grid' })).toHaveValue('OJ11');
  await expect(page.getByRole('status').filter({ hasText: 'Position accurate to 3.2 km, so the grid has 4 characters.' })).toBeVisible();
  await expect.poll(() => storedSettings(page)).toMatchObject({ value: { grid: 'OJ11' } });
});

test('Use GPS without location permission says what to do and keeps the grid', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Grid' });
  await field.fill('OJ11');
  await field.press('Enter');
  await page.getByRole('button', { name: 'Use GPS' }).click();
  await expect(page.getByRole('alert')).toHaveText('Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.');
  await expect(field).toHaveValue('OJ11');
});

/** Reads the settings record straight from IndexedDB; null until the store exists. */
function storedSettings(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('rr73');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) return resolve(null);
          const get = db.transaction('kv').objectStore('kv').get('settings');
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => resolve(null);
        };
      }),
  );
}

test('the theme setting overrides the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./#/settings');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  await page.getByText('System', { exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('Settings shows the version, and it opens the version history', async ({ page }) => {
  await page.goto('./#/settings');
  const row = page.getByRole('link', { name: new RegExp(`^Version ${VERSION.replace(/\./g, '\\.')} \\(\\w+\\)`) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Version history' })).toBeVisible();
  await expect(page.getByText(`You are using version ${VERSION}`)).toBeVisible();
  const section = page.locator(`[id="v${VERSION}"]`);
  await expect(section).toContainText(VERSION);
  await expect(section).toContainText('This version');
});

test('after an update, a notice opens the version history at the new version', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rr73.lastVersion', '0.0.1');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('./');
  const notice = page.getByRole('status').filter({ hasText: `Updated to ${VERSION}` });
  await expect(notice).toBeVisible();
  await notice.getByRole('link', { name: /What.s new/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/settings/versions/${VERSION.replace(/\./g, '\\.')}$`));
  await expect(page.locator(`[id="v${VERSION}"]`)).toBeFocused();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByText(`Updated to ${VERSION}`)).toBeHidden();
});

test('Reload app and Clear cached copy and reload both reload the page', async ({ page }) => {
  for (const name of [/^Reload app/, /^Clear cached copy and reload/]) {
    await page.goto('./#/settings');
    await page.evaluate(() => ((window as unknown as { __marker: boolean }).__marker = true));
    const button = page.getByRole('button', { name });
    await expect(button).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), button.click()]);
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker ?? false)).toBe(false);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  }
});

test('Clear cached copy waits for a connection', async ({ page, context }) => {
  await page.goto('./#/settings');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: /^Clear cached copy and reload/ })).toBeDisabled();
  await expect(page.getByText('Needs a connection: the app loads fresh from the network.')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /^Clear cached copy and reload/ })).toBeEnabled();
});
