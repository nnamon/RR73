// Layout on iPhone viewports in WebKit, light and dark: nothing overflows sideways, the tab bar
// sits at the bottom, every control is at least 44 px, and each screen is captured.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SCREENS, open } from './screens';

const SHOTS = fileURLToPath(new URL('../test-results/screens', import.meta.url));

async function checkLayout(page: Page) {
  const { innerWidth, innerHeight } = await page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
  // Nothing wider than the screen, in the page or in any element.
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push('document');
    for (const el of document.querySelectorAll<HTMLElement>('main *, nav *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5) && getComputedStyle(el).position !== 'fixed' && !el.closest('.visually-hidden') && !el.closest('[hidden]')) {
        out.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return out;
  });
  expect(wide).toEqual([]);

  const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(bar.y + bar.height).toBeCloseTo(innerHeight, 0);
  expect(bar.width).toBeCloseTo(innerWidth, 0);

  expect(await smallTargets(page, 'main, nav')).toEqual([]);
}

/** Buttons, links and fields under `scope` smaller than 44 by 44 px (checkboxes and radios count their label). */
async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    const sel = ['button', 'a[href]', 'select', 'input:not([type=checkbox]):not([type=radio])', 'label:has(input)'];
    const targets = scope
      .split(',')
      .flatMap((s) => sel.map((t) => `${s.trim()} ${t}`))
      .join(', ');
    for (const el of document.querySelectorAll<HTMLElement>(targets)) {
      if (el.closest('[hidden]') || el.closest('dialog:not([open])') || el.classList.contains('visually-hidden')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

for (const theme of ['light', 'dark'] as const) {
  for (const s of SCREENS) {
    test(`${s.name} in ${theme}`, async ({ page }, info) => {
      await open(page, s.path, theme);
      await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeAttached();
      await checkLayout(page);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${s.name}.png` });
    });
  }

  test(`operate fits without scrolling and keeps the decode list on screen in ${theme}`, async ({ page }) => {
    await open(page, '#/operate', theme);
    const vh = await page.evaluate(() => window.innerHeight);
    const wf = (await page.getByTestId('waterfall').boundingBox())!;
    const list = (await page.locator('.operate .list').boundingBox())!;
    const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
    const banner = (await page.getByRole('status').filter({ hasText: 'Audio is off' }).boundingBox())!;
    const dock = (await page.getByRole('region', { name: 'Transmit' }).boundingBox())!;
    expect(wf.height).toBeGreaterThanOrEqual(120);
    // The banner goes once audio starts; the list then has its space too.
    expect(list.height).toBeGreaterThanOrEqual(64);
    expect(list.height + banner.height).toBeGreaterThanOrEqual(200);
    expect(list.y + list.height).toBeLessThanOrEqual(dock.y + 0.5);
    expect(dock.y + dock.height).toBeLessThanOrEqual(bar.y + 0.5);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(vh);
  });

  test(`band sheet in ${theme}`, async ({ page }, info) => {
    await open(page, '#/operate', theme);
    await page.getByRole('button', { name: /^Change band/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Change band' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('14.074 MHz')).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-band.png` });
  });

  test(`tune confirmation in ${theme}`, async ({ page }, info) => {
    await open(page, '#/settings/radio', theme);
    await page.getByRole('button', { name: /^Tune/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Transmit a tune tone?' });
    await expect(sheet).toBeVisible();
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-tune.png` });
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
  });
}
