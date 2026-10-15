// Decode colours on iPhone viewports in WebKit, light, dark and Sun: the Decode colours screen and
// its colour sheet, and Operate with a decode of every category on screen. Operate keeps 32 pt rows,
// shows 13 rows at 393 x 852 (10 at 375 x 667), and a colour change moves no row. The review
// projects save the screens to test-results/screens/colours; CI runs the light theme (ci() in
// layout-checks.ts). The status bar and home indicator insets are applied, as in states.spec.ts.
// Decodes, QSOs and the sent row come through the screen-review hooks. The country file is the
// one the test helper converts, so New DXCC shows wherever the test runs.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLayout, ci, shot, smallTargets } from './layout-checks';
import { useTheme } from './theme';
import { bigCtyFixture } from '../src/lib/reference/testing';

const CTY = JSON.stringify(bigCtyFixture());
test.beforeEach(async ({ page }) => {
  await page.route('**/data/cty.json', (route) => route.fulfill({ body: CTY, contentType: 'application/json' }));
});

const SHOTS = fileURLToPath(new URL('../test-results/screens/colours', import.meta.url));
const INSETS: Record<number, { top: number; bottom: number }> = { 393: { top: 59, bottom: 34 }, 375: { top: 20, bottom: 0 } };
const TARGET: Record<number, number> = { 393: 13, 375: 10 };

/** The log: each QSO puts a call, grid and DXCC entity on a band, so the decodes below fall in every category RR73's scheme turns on. */
const LOG: [string, string, string, 'FT8' | 'FT4'][] = [
  ['JA7XVZ', 'QM09', '40m', 'FT8'],
  ['JH1RRT', 'QM09', '20m', 'FT8'],
  ['BH1LKO', 'OM89', '40m', 'FT8'],
  ['VK2AXN', 'OL72', '20m', 'FT8'],
  ['9M2TRX', 'OJ02', '20m', 'FT8'],
  ['4I1LCT', 'PK04', '20m', 'FT4'],
];

/** Decodes on 20m FT8, the background each takes and whether worked before greys its text. */
const DECODES: [string, string | null, boolean][] = [
  ['9V1NE JA1KXM PM95', 'myCall', false],
  ['CQ A41ZZ LL93', 'newDxcc', false],
  ['CQ JA6BBM PM51', 'newGrid', false],
  ['CQ BH1LKO OM89', 'newGridBand', false],
  ['CQ JA7BEW QM09', 'newCall', false],
  ['CQ JA7XVZ QM09', 'newCallBand', false],
  ['JA8HCE 4I1LCT RR73', 'ending', false],
  ['CQ 4I1LCT PK04', 'cq', false],
  ['CQ VK2AXN OL72', 'cq', true],
  ['BD7PDP 9M2TRX RR73', 'ending', true],
  ['JG1FVM 9M2TRX R-07', null, true],
  ['JG1FVM E27CJS RRR', null, false],
  ['UN3P BA5CJ -11', null, false],
  ['LB7YK JR1NHD PM95', null, false],
  ['M7IUN JA7XVZ R-06', null, false],
  ['RA6LIS BA4IE OM86', null, false],
  ['PV5N 6K2MAS PM37', null, false],
];

function rowsOnScreen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid=decode-list]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid=decode-list] button.dr')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5;
    }).length;
  });
}

/** Each row's box relative to the first row's: a new slot's bar above them all moves none of them. */
const rowBoxes = (page: Page) =>
  page.locator('[data-testid=decode-list] button.dr').evaluateAll((els) => {
    const top = els[0]?.getBoundingClientRect().top ?? 0;
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.top - top, width: r.width, height: r.height });
    });
  });

for (const theme of ['light', 'dark', 'sun'] as const) {
  test(`decode colours screen and sheet in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    await useTheme(page, theme);
    await page.goto('./#/settings/colours');
    await expect(page.getByRole('heading', { level: 1, name: 'Decode colours' })).toBeVisible();
    // The example places its stations once the country file has loaded: A41ZZ is in Oman, an entity the sample log lacks.
    await expect(page.getByTestId('colours-example').locator('[data-hl="newDxcc"]')).toHaveCount(1);
    await page.waitForTimeout(300);
    await checkLayout(page);
    // Every category row is one switch, one swatch and, in Highlight, one handle, at least 56 pt high.
    const rows = page.locator('.hl-list > li');
    await expect(page.locator('.hl-list:not(.text-list) > li')).toHaveCount(16);
    await expect(page.locator('.text-list > li')).toHaveCount(1);
    await expect(page.locator('.text-list .grip')).toHaveCount(0);
    for (const box of await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(55.5);
    await shot(page, info, SHOTS, `${theme}-screen`);
    await page.locator('main .pane:not([hidden])').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await shot(page, info, SHOTS, `${theme}-screen-end`, 200);

    await page.getByRole('button', { name: 'Change colour: New call', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'New call' });
    await expect(sheet).toBeVisible();
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await shot(page, info, SHOTS, `${theme}-sheet`, 250);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Change colour: Worked before' }).click();
    await expect(page.getByRole('dialog', { name: 'Worked before' })).toBeVisible();
    await shot(page, info, SHOTS, `${theme}-sheet-text`, 250);
  });

  test(`Operate with every category in ${theme}`, ci(theme, 375, 393), async ({ page }, info) => {
    mkdirSync(SHOTS, { recursive: true });
    const width = page.viewportSize()!.width;
    await page.addInitScript((i) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
        document.head.append(s);
      });
    }, INSETS[width]);
    await useTheme(page, theme);
    await page.goto('./#/settings');
    for (const [name, value] of [
      ['Callsign', '9V1NE'],
      ['Grid', 'OJ11'],
    ]) {
      const field = page.getByRole('textbox', { name });
      await field.fill(value);
      await field.press('Enter');
    }
    await page.getByRole('link', { name: 'Operate' }).click();

    await page.evaluate(async (log) => {
      const end = Date.now() - 86_400_000;
      for (const [call, grid, band, mode] of log) {
        await window.__rr73!.logged({ call, grid, band, mode, dialHz: band === '40m' ? 7_074_000 : 14_074_000, audioHz: 1500, startUtcMs: end - 60_000, endUtcMs: end, reportSent: -10, reportRcvd: -12 });
      }
    }, LOG);
    await page.getByRole('button', { name: 'Dismiss the notice' }).click();

    // Receiving, as in states.spec.ts: audio on, so the Start audio banner is gone.
    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });

    // Sent: a CQ in the current slot, so it shows above the decodes.
    await page.evaluate(() => window.__rr73!.sent(Math.floor(Date.now() / 15_000) * 15_000, 'CQ 9V1NE OJ11'));
    await expect(page.getByTestId('decode-list').locator('button.dr[data-hl="sent"]')).toHaveCount(1);

    await page.evaluate((ds) => {
      const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
      window.__rr73!.decoded(
        slot,
        ds.map(([text], i) => ({ text, freq_hz: 400 + 140 * i, dt_s: 0.1 + (i % 4) / 10, snr_db: -18 + i })),
      );
    }, DECODES);
    for (const [text, hl, grey] of DECODES) {
      const r = page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) });
      if (hl) await expect(r, text).toHaveAttribute('data-hl', hl);
      else await expect(r, text).not.toHaveAttribute('data-hl');
      if (grey) await expect(r, text).toHaveAttribute('data-ink', 'worked');
      else await expect(r, text).not.toHaveAttribute('data-ink');
    }
    await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(400);

    // 32 pt rows, as many on screen as option B of the decode list promised.
    const heights = await page.locator('[data-testid=decode-list] button.dr').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(new Set(heights.map((h) => Math.round(h)))).toEqual(new Set([32]));
    expect(await rowsOnScreen(page)).toBeGreaterThanOrEqual(TARGET[width]);
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-operate`);

    // A colour change moves no row.
    const before = await rowBoxes(page);
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: /^Decode colours/ }).click();
    await page.getByRole('button', { name: 'Change colour: CQ in the message' }).click();
    await page.getByRole('dialog', { name: 'CQ in the message' }).getByRole('button', { name: 'Sky blue' }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('link', { name: 'Operate' }).click();
    await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    expect(await rowBoxes(page)).toEqual(before);
    await shot(page, info, SHOTS, `${theme}-operate-teal`);
  });
}
