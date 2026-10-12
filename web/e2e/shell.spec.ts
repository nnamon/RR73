// The app shell: tabs, headings, settings stored in IndexedDB, version history and the update notice.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

test('the tab bar moves between screens and marks the current one', async ({ page }) => {
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Operate' })).toHaveAttribute('aria-current', 'page');
  for (const [name, heading] of [
    ['Log', 'Log'],
    ['Activate', 'Activate'],
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
  await page.goto('./#/activate');
  await expect(page.getByText('No activation running')).toBeVisible();
  await page.goto('./#/spots');
  await expect(page.getByText('No spots yet')).toBeVisible();
});

test('Operate shows the band, the frequency and the empty decode list', async ({ page }) => {
  await page.goto('./');
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('20m');
  await expect(band).toContainText('FT8');
  await expect(band).toContainText('14.074 MHz · USB');
  await expect(page.getByText('No decoder in this version')).toBeVisible();
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
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Callsign' })).toHaveValue('9V1NE');
  const stored = await page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('rr73');
        req.onsuccess = () => {
          const get = req.result.transaction('kv').objectStore('kv').get('settings');
          get.onsuccess = () => resolve(get.result);
        };
      }),
  );
  expect(stored).toMatchObject({ key: 'settings', value: { callsign: '9V1NE' } });
});

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
