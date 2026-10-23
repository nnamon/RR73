// Settings › Guide: the pages of docs/guide, bundled with the app, their links, the link from
// Settings › FT8 and FT4 and from Operate on first start, reading with no network, and the
// screenshots, tables and message ladders of a page.
import { expect, test } from '@playwright/test';
import { useTheme } from './theme';

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
  await expect(page.locator('code', { hasText: 'K1ABC 9V1NE R-10' })).toBeVisible();

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

test('Guide is the first row of Settings, and About does not repeat it', async ({ page }) => {
  await page.goto('./#/settings');
  const first = page.locator('main .pane:not([hidden]) .group').first().locator('a.row');
  await expect(first).toHaveCount(1);
  await expect(first).toHaveAttribute('href', '#/settings/guide');
  await expect(first.locator('.ic svg')).toBeVisible();
  await expect(page.locator('main .pane:not([hidden]) a.row[href="#/settings/guide"]')).toHaveCount(1);
});

test('on first start, the empty decode list links to Getting started', async ({ page }) => {
  await page.goto('./#/operate');
  const list = page.getByTestId('decode-list');
  await expect(list.getByText('No decodes yet')).toBeVisible();
  await list.getByRole('link', { name: 'Read Getting started' }).click();
  await expect(page).toHaveURL(/#\/settings\/guide\/getting-started$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible();

  // With a callsign set the link goes.
  await page.goto('./#/settings');
  const call = page.getByRole('textbox', { name: 'Callsign' });
  await call.fill('9V1NE');
  await call.press('Enter');
  await page.goto('./#/operate');
  await expect(list.getByText('No decodes yet')).toBeVisible();
  await expect(list.getByRole('link', { name: 'Read Getting started' })).toHaveCount(0);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('Making QSOs shows its screenshot, legend, ladders and table with no network', async ({ page, context }) => {
    // The first visit installs the app, the guide's images with it, for use offline.
    await page.goto('./#/settings/guide');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible();
    await page.getByRole('link', { name: 'Making QSOs' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Making QSOs' })).toBeVisible();

    // The screenshot is in the precache: it loads with the network off.
    const img = page.getByRole('img', { name: "Operate's transmit controls during a QSO with K1ABC" });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    const legend = page.getByRole('list', { name: 'Callouts' });
    await expect(legend.getByRole('listitem')).toHaveCount(7);
    await expect(legend.locator('.num')).toHaveText(['1', '2', '3', '4', '5', '6', '7']);

    // Ladders: You on the left, Them on the right, one rung per slot.
    const ladders = page.getByRole('list', { name: 'Messages, one per slot' });
    await expect(ladders).toHaveCount(5);
    const answering = ladders.first();
    await expect(answering.getByRole('listitem')).toHaveCount(6);
    const them = (await answering.locator('.them code').first().boundingBox())!;
    const you = (await answering.locator('.you code').first().boundingBox())!;
    expect(you.x).toBeLessThan(them.x);
    await expect(answering.locator('.you code').first()).toHaveText('K1ABC 9V1NE OJ11');
    await expect(answering.locator('.you code').first()).toHaveCSS('font-family', /mono|Mono|Menlo|Courier/);
    await expect(ladders.nth(3).getByText('Nothing decoded')).toHaveCount(4);

    await expect(page.getByRole('table').first().getByRole('row')).toHaveCount(10);
    await expect(page.getByRole('cell', { name: 'Repeat CQ', exact: true })).toBeVisible();
  });
});

test('Making QSOs fits a 375 x 667 screen in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await page.goto('./#/settings/guide/making-qsos');
    await expect(page.getByRole('heading', { level: 1, name: 'Making QSOs' })).toBeVisible();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    // Every image, rung and table inside the screen, 16 pt in from the edges for the groups.
    const outside = await page.locator('main .pane:not([hidden])').evaluate((root) =>
      [...root.querySelectorAll('.fig img, .rung > *, table')]
        .map((el) => ({ el: el.textContent?.slice(0, 30) || el.tagName, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.left < 16 || r.right > window.innerWidth - 16)
        .map(({ el }) => el),
    );
    expect(outside).toEqual([]);
    // Ladder bubbles take their colours from the theme: You and Them differ from each other and from the group.
    const colours = await page.locator('.ladder').first().evaluate((el) => {
      const bg = (q: string) => getComputedStyle(el.querySelector(q)!).backgroundColor;
      return { you: bg('.you .bubble'), them: bg('.them .bubble'), group: getComputedStyle(el.closest('.group')!).backgroundColor };
    });
    expect(new Set(Object.values(colours)).size).toBe(3);
  }
});
