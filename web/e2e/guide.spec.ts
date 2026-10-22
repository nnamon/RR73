// Settings › Guide: the pages of docs/guide, bundled with the app, their links, the link from
// Settings › FT8 and FT4 and reading with no network.
import { expect, test } from '@playwright/test';

test('Settings › Guide lists the pages and opens one with a way back', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('link', { name: 'Guide' }).click();
  await expect(page).toHaveURL(/#\/settings\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible();
  const pages = page.locator('main .pane:not([hidden]) .group a');
  await expect(pages.first()).toHaveText('Getting started');
  await expect(page.getByRole('link', { name: 'Making QSOs' })).toBeVisible();

  await page.getByRole('link', { name: 'Making QSOs' }).click();
  await expect(page).toHaveURL(/#\/settings\/guide\/making-qsos$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Making QSOs' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'After RR73' })).toBeVisible();
  // Messages as transmitted, in the monospace font.
  await expect(page.locator('code', { hasText: 'K1ABC 9V1NE R-12' })).toBeVisible();

  await page.getByRole('link', { name: 'Guide', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible();
});

test('a link to another page of the guide opens it in the app', async ({ page }) => {
  await page.goto('./#/settings/guide/getting-started');
  await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible();
  await page.getByRole('link', { name: 'Your radio' }).first().click();
  await expect(page).toHaveURL(/#\/settings\/guide\/your-radio$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your radio' })).toBeVisible();
});

test('a link to a section opens the page at that section', async ({ page }) => {
  await page.goto('./#/settings/guide/making-qsos/watchdog');
  const head = page.getByRole('heading', { level: 2, name: 'Watchdog' });
  await expect(head).toBeFocused();
  await expect(head).toBeInViewport();
});

test('Settings › FT8 and FT4 links Contest exchange to its page', async ({ page }) => {
  await page.goto('./#/settings/ft8');
  await page.getByRole('link', { name: 'How it works' }).click();
  await expect(page).toHaveURL(/#\/settings\/guide\/contest-exchange$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Contest exchange' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'What to type' })).toBeVisible();
});

test('the guide reads with no network: its pages are in the app', async ({ page, context }) => {
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const asked: string[] = [];
  page.on('request', (r) => asked.push(r.url()));
  await context.route('**/*', (route) => route.abort());
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Guide' }).click();
  await page.getByRole('link', { name: 'Contest exchange' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contest exchange' })).toBeVisible();
  await expect(page.getByText('1D WI', { exact: false }).first()).toBeVisible();
  expect(asked.filter((u) => /\.md\b|guide/.test(u))).toEqual([]);
});

test('a page that is not in the guide says so', async ({ page }) => {
  await page.goto('./#/settings/guide/no-such-page');
  await expect(page.getByText('No such page in this version')).toBeVisible();
});
