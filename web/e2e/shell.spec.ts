// The app shell: Operate and the screens it opens, headings, settings stored in IndexedDB, version history and the update notice.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptySeed, seed, withFeatures } from './log-data';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

test('the top bar opens Log, Spots and Settings, and each goes back to Operate', async ({ page }) => {
  await page.goto('./');
  await seed(page, withFeatures(emptySeed(), { activations: true }));
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'Screens' });
  for (const name of ['Log', 'Spots', 'Settings'] as const) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeFocused();
    await expect(page).toHaveTitle(`${name} · RR73`);
    await page.getByRole('link', { name: 'Operate' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Operate' })).toBeFocused();
    await expect(page).toHaveURL(/#\/operate$/);
  }
});

test('the empty tabs say what will appear', async ({ page }) => {
  await page.goto('./#/log');
  await expect(page.getByText('No QSOs yet')).toBeVisible();
  await seed(page, withFeatures(emptySeed(), { activations: true, potaSpots: true }));
  await page.goto('./#/spots');
  await expect(page.getByRole('button', { name: /^Start activation/ })).toBeVisible();
  await expect(page.getByText(/^(Fetching spots\.|Spots appear here when )/)).toBeVisible();
});

test('Operate shows the band, the frequency and the empty decode list', async ({ page }) => {
  await page.goto('./');
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('20m');
  await expect(band).toContainText('FT8');
  await expect(band).toContainText('14.074');
  await expect(band).toHaveAccessibleName('Change band. Now 20m FT8, 14.074 MHz USB.');
  await expect(page.getByText('No decodes yet')).toBeVisible();
  await expect(page.getByText('Decodes appear here 13.5 s into each 15 s slot, while audio runs.')).toBeVisible();
});

test('a tap on a band applies it at once', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  // A mode applies and the sheet stays open; a band applies and closes it.
  await sheet.getByText('FT4', { exact: true }).click();
  await expect(sheet.getByTestId('ft-dial')).toHaveValue('14.080');
  await sheet.getByText('40m', { exact: true }).click();
  await expect(sheet).toBeHidden();
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toHaveAccessibleName('Change band. Now 40m FT4, 7.0475 MHz USB.');
  await expect(band).toContainText('7.0475');
});

test('the callsign is stored on the phone in capitals and kept over a reload', async ({ page }) => {
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

// Playwright's Desktop Chrome reports Windows.
test('Use GPS without location permission says what to do and keeps the grid', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Grid' });
  await field.fill('OJ11');
  await field.press('Enter');
  await page.getByRole('button', { name: 'Use GPS' }).click();
  await expect(page.getByRole('alert')).toHaveText('Location is off for RR73. Allow it for this site in the browser’s site settings and in Windows Settings › Privacy & security › Location, or type the grid.');
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

test('the app starts in light whatever the system, and Settings › Theme changes it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./#/settings');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await bg();
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByText('System', { exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect.poll(bg).not.toBe(light);
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).not.toBe(light);

  // Sun: light with its own colours, whatever the system, and kept after a reload.
  await page.getByRole('radiogroup', { name: 'Appearance' }).getByText('Sun', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sun');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await expect.poll(bg).toBe('rgb(229, 229, 234)');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.section-head')!).color)).toBe('rgb(58, 58, 60)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sun');
  await expect(page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Sun' })).toBeChecked();
});

test('Settings shows the version, and it opens the version history', async ({ page }) => {
  await page.goto('./#/settings');
  const row = page.getByRole('link', { name: `Version history ${VERSION}` });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Version history' })).toBeVisible();
  const section = page.locator(`[id="v${VERSION}"]`);
  await expect(section).toContainText(VERSION);
  await expect(section).toContainText('This version');
});

test('Settings › About › Credits shows each third-party licence in full', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('link', { name: 'Credits' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Credits' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['ft8_lib', 'Lucide', 'Inter']);
  const text = (await page.locator('main .pane:not([hidden])').innerText()).replace(/\s+/g, ' ');
  // Lucide's ISC licence, word for word.
  const isc = readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8').split('```text\nISC License')[1].split('```')[0];
  expect(text).toContain(`ISC License ${isc.replace(/\s+/g, ' ').trim()}`);
  // ft8_lib's MIT licence, as kept beside the crate.
  const mit = readFileSync(new URL('../../crates/rr73-ft8/LICENSE-ft8_lib', import.meta.url), 'utf8');
  expect(text).toContain(mit.replace(/\s+/g, ' ').trim());
  expect(text).toContain('Kārlis Goba');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
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
  await notice.getByRole('link', { name: 'Show changes' }).click();
  await expect(page).toHaveURL(new RegExp(`#/settings/versions/${VERSION.replace(/\./g, '\\.')}$`));
  await expect(page.locator(`[id="v${VERSION}"]`)).toBeFocused();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByText(`Updated to ${VERSION}`)).toBeHidden();
});

test('the update notice floats over Operate and goes by itself after 4 s', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rr73.lastVersion', '0.0.1');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('./');
  const notice = page.getByRole('status').filter({ hasText: `Updated to ${VERSION}` });
  await expect(notice).toBeVisible();
  // It floats: nothing in Operate moves to make room for it.
  expect(await notice.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  expect(Math.round((await page.locator('header.top').boundingBox())!.y)).toBe(0);
  await page.clock.fastForward(3500);
  await expect(notice).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(notice).toBeHidden();
});

test('a screen opened from Settings starts at the top, and Back returns to the same place', async ({ page }) => {
  await page.goto('./#/settings');
  const pane = page.locator('main .pane.scroll');
  await pane.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const down = await pane.evaluate((el) => el.scrollTop);
  expect(down).toBeGreaterThan(100);
  await page.getByRole('link', { name: /^Version history/ }).click();
  await expect(page).toHaveURL(/#\/settings\/versions$/);
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect.poll(() => pane.evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(down));
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
  await expect(page.getByText('Needs a connection', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /^Clear cached copy and reload/ })).toBeEnabled();
});

test('taps select no text in the app, and fields stay selectable', async ({ page }) => {
  await page.goto('./#/operate');
  // A double-click selected the word under it before 0.12.5.
  await page.getByText('No decodes yet').dblclick();
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.selectText();
  expect(await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))).toBe('9V1NE');
  expect(await field.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none');
});
