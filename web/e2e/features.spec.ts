// Optional features (Settings › Optional features): all off on a new install, so the app shows
// three tabs; each one brings back only its own part of the app.
import { expect, test, type Page } from '@playwright/test';
import { mockupLog, seed, withFeatures } from './log-data';
import { FIXED_TIME } from './time';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const feature = (page: Page, name: string) => page.getByRole('switch', { name: new RegExp(`^${name}`) });
/** The Log's All, To do and Activations control. */
const views = (page: Page) => page.getByRole('radiogroup', { name: 'Show' }).locator('label');

/** Reads the stored settings straight from IndexedDB. */
function stored(page: Page): Promise<{ features?: Record<string, boolean>; schema?: number } | null> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('rr73');
        req.onsuccess = () => {
          const get = req.result.transaction('kv').objectStore('kv').get('settings');
          get.onsuccess = () => {
            req.result.close();
            resolve((get.result?.value ?? null) as { features?: Record<string, boolean>; schema?: number } | null);
          };
        };
      }),
  );
}

test('a new install shows three tabs, every feature off, and Spots opens Optional features', async ({ page }) => {
  await page.goto('./');
  await expect(nav(page).getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
  await page.goto('./#/spots');
  await expect(page).toHaveURL(/#\/settings\/features$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Optional features' })).toBeInViewport();
  await expect(page.getByText('The Spots tab shows while Activations, POTA spots or Cluster spots is on.', { exact: false })).toBeVisible();
  for (const name of ['Activations', 'POTA spots', 'Cluster spots', 'LoTW users']) await expect(feature(page, name)).not.toBeChecked();
});

test('turning Activations on brings Spots back with the activation, and turning it off hides it again', async ({ page }) => {
  await page.goto('./#/settings');
  await feature(page, 'Activations').check();
  await expect(nav(page).getByRole('link')).toHaveText(['Operate', 'Log', 'Spots', 'Settings']);
  await expect.poll(async () => (await stored(page))?.features?.activations).toBe(true);

  await nav(page).getByRole('link', { name: 'Spots' }).click();
  await expect(page.getByRole('button', { name: /^Start activation/ })).toBeVisible();
  // No spot source is on, so no spots section.
  await expect(page.getByRole('heading', { level: 2, name: 'Spots' })).toHaveCount(0);

  await nav(page).getByRole('link', { name: 'Log' }).click();
  await expect(views(page)).toHaveText(['All', 'To do', 'Activations']);
  await page.goto('./#/settings/logging');
  await expect(page.getByText('A file per park and UTC day, to upload at pota.app')).toBeVisible();

  // It survives a reload, then turns off again.
  await page.goto('./#/settings');
  await page.reload();
  await expect(feature(page, 'Activations')).toBeChecked();
  await feature(page, 'Activations').uncheck();
  await expect(nav(page).getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
  await page.goto('./#/log');
  await expect(views(page)).toHaveText(['All', 'To do']);
  await page.goto('./#/settings/logging');
  await expect(page.getByRole('heading', { level: 1, name: 'Logging' })).toBeVisible();
  await expect(page.getByText('A file per park and UTC day, to upload at pota.app')).toHaveCount(0);
  await page.goto('./#/spots');
  await expect(page).toHaveURL(/#\/settings\/features$/);
});

test('a spot source alone shows Spots with spots and no activation', async ({ page }) => {
  await page.goto('./#/settings');
  await feature(page, 'Cluster spots').check();
  await nav(page).getByRole('link', { name: 'Spots' }).click();
  await expect(page.getByText(/^No spots yet\. DX cluster spots on your bands/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Start activation/ })).toHaveCount(0);
  // LoTW users alone does not bring Spots back.
  await page.goto('./#/settings');
  await feature(page, 'Cluster spots').uncheck();
  await feature(page, 'LoTW users').check();
  await expect(nav(page).getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
});

test('a phone that ran 0.5.0 with an activation running ends up with every feature off, and keeps the activation and its QSOs', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('./');
  // 0.5.0 stored settings without a schema; it always showed activations.
  await seed(page, mockupLog({ running: true }));
  await expect(nav(page).getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
  await expect.poll(async () => (await stored(page))?.schema).toBe(2);
  expect((await stored(page))?.features).toEqual({ activations: false, potaSpots: false, clusterSpots: false, lotw: false });
  // Operate shows no activation line; the log keeps every QSO.
  await expect(page.getByRole('link', { name: /^Activation / })).toHaveCount(0);
  await page.goto('./#/log');
  await expect(page.getByRole('button', { name: /^ZL2AB/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Activations' })).toHaveCount(0);

  await page.goto('./#/settings');
  await feature(page, 'Activations').check();
  await page.goto('./#/operate');
  await expect(page.getByRole('link', { name: /^Activation POTA VK-0921 \+1, 7 of 10\./ })).toBeVisible();
  await page.goto('./#/spots');
  await expect(page.getByRole('button', { name: 'End activation…' })).toBeVisible();
});

test('the QSO sheet offers the running activation only with Activations on', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('./');
  await seed(page, mockupLog({ running: true }));
  await page.goto('./#/log');
  await page.getByRole('button', { name: 'Add QSO' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add QSO' });
  await expect(sheet.getByText('Add to the activation')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await seed(page, withFeatures(mockupLog({ running: true }), { activations: true }));
  await page.getByRole('button', { name: 'Add QSO' }).click();
  await expect(page.getByRole('dialog', { name: 'Add QSO' }).getByText('Add to the activation')).toBeVisible();
});
