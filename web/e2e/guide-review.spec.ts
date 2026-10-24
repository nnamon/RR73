// The guide as the app shows it, for review beside the Markdown (guide-review project only,
// RR73_GUIDE_SHOTS=1; docs/testing.md): every page at full length in light, Making QSOs screen by
// screen and at full length in both themes, the top of Settings and Operate's empty decode list on
// first start. An iPhone at
// 393 x 852 in WebKit, with its status bar and home indicator insets. Screenshots go to
// test-results/screens/guide.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { INSETS } from './operate-checks';
import { useTheme } from './theme';

const OUT = fileURLToPath(new URL('../test-results/screens/guide', import.meta.url));

async function openAt(page: Page, path: string, theme: 'light' | 'dark') {
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[393]);
  await useTheme(page, theme);
  await page.goto(`./${path}`);
  await page.locator('main h1:visible').first().waitFor();
  await page.waitForTimeout(400);
}

/** The element that scrolls the screen's content. */
const scroller = (page: Page) =>
  page.evaluateHandle(() => {
    const all = [...document.querySelectorAll<HTMLElement>('main *')];
    return all.find((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) ?? document.scrollingElement;
  });

for (const theme of ['light', 'dark'] as const) {
  test(`Making QSOs in ${theme}`, async ({ page }) => {
    await openAt(page, '#/settings/guide/making-qsos', theme);
    await expect(page.getByRole('img', { name: /transmit controls/ })).toBeVisible();
    const el = await scroller(page);
    const { total, view } = await el.evaluate((s) => ({ total: (s as HTMLElement).scrollHeight, view: (s as HTMLElement).clientHeight }));
    // Screen by screen, each overlapping the last by 64 pt.
    for (let i = 0, y = 0; y < total - 1; i++, y += view - 64) {
      await el.evaluate((s, top) => (s as HTMLElement).scrollTo({ top }), y);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/making-qsos-${theme}-${String(i + 1).padStart(2, '0')}.png` });
    }
    // The whole page in one image: a screen as tall as the content.
    await page.setViewportSize({ width: 393, height: 852 + total - view });
    await el.evaluate((s) => (s as HTMLElement).scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/making-qsos-${theme}-full.png` });
  });

  test(`Settings top in ${theme}`, async ({ page }) => {
    await openAt(page, '#/settings', theme);
    await page.screenshot({ path: `${OUT}/settings-top-${theme}.png` });
  });

  test(`Operate on first start in ${theme}`, async ({ page }) => {
    await openAt(page, '#/operate', theme);
    await expect(page.getByRole('link', { name: 'Getting started guide' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/first-start-${theme}.png` });
  });
}

const PAGES = ['getting-started', 'your-radio', 'operate', 'making-qsos', 'activations', 'contest-exchange', 'logging', 'wspr', 'rtty', 'web-sdr', 'practice-band', 'timing', 'settings-reference'];

for (const [i, slug] of PAGES.entries()) {
  test(`${slug} at full length in light`, async ({ page }) => {
    await openAt(page, `#/settings/guide/${slug}`, 'light');
    for (const img of await page.locator('.fig img').all()) await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const el = await scroller(page);
    const { total, view } = await el.evaluate((s) => ({ total: (s as HTMLElement).scrollHeight, view: (s as HTMLElement).clientHeight }));
    await page.setViewportSize({ width: 393, height: 852 + Math.max(0, total - view) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/page-${String(i + 1).padStart(2, '0')}-${slug}.png` });
  });
}
