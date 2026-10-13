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
    const dock = (await page.getByRole('region', { name: 'Transmit' }).boundingBox())!;
    expect(wf.height).toBeGreaterThanOrEqual(120);
    expect(list.height).toBeGreaterThanOrEqual(120);
    expect(list.y + list.height).toBeLessThanOrEqual(dock.y + 0.5);
    expect(dock.y + dock.height).toBeLessThanOrEqual(bar.y + 0.5);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(vh);
  });

  test(`frequency bar in ${theme}`, async ({ page }, info) => {
    await open(page, '#/operate', theme);
    await expect(page.getByText('Tap the waterfall to set the receive or transmit frequency.')).toBeVisible();
    const wf = (await page.getByTestId('waterfall').boundingBox())!;
    await page.mouse.click(Math.round(wf.x + (wf.width * 1846) / 3000), Math.round(wf.y + wf.height / 2));
    const bar = page.getByRole('group', { name: 'Set the frequency' });
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('freq-guide')).toBeVisible();
    const box = (await bar.boundingBox())!;
    const vw = await page.evaluate(() => window.innerWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    // Below the axis, clear of the dock.
    expect(box.y).toBeGreaterThanOrEqual(wf.y + wf.height);
    const dock = (await page.getByRole('region', { name: 'Transmit' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    expect(await smallTargets(page, '[data-testid=freq-bar]')).toEqual([]);
    // Every label fits its button.
    const clipped = await bar.evaluate((el) =>
      [...el.querySelectorAll('button')].filter((b) => b.scrollWidth > b.clientWidth + 0.5).map((b) => b.textContent?.trim()),
    );
    expect(clipped).toEqual([]);
    await checkLayout(page);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-freq-bar.png` });
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

for (const theme of ['light', 'dark'] as const) {
  test(`transmit dock and Run queue in ${theme}`, async ({ page }, info) => {
    await open(page, '#/settings', theme);
    for (const [name, value] of [
      ['Callsign', '9V1NE'],
      ['Grid', 'OJ11'],
    ]) {
      const field = page.getByRole('textbox', { name });
      await field.fill(value);
      await field.press('Enter');
    }
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Operate' }).click();
    const dock = page.getByRole('region', { name: 'Transmit' });
    await dock.getByRole('button', { name: 'Confirm band' }).click();
    await page.getByRole('dialog', { name: 'Change band' }).getByRole('button', { name: 'Use 20m FT8' }).click();
    await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-dock-idle.png` });

    await dock.getByRole('button', { name: 'Run' }).click();
    await expect(dock.getByRole('button', { name: 'Stop after this QSO' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Callers' })).toBeVisible();
    // Audio is off in WebKit here, so the dock says why nothing goes out.
    await expect(dock.getByText('Resume audio to transmit.')).toBeVisible();
    await checkLayout(page);
    // The dock, and Halt in it, stays above the tab bar.
    const dockBox = (await dock.boundingBox())!;
    const tabs = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(tabs.y + 0.5);
    await expect(page.getByRole('list', { name: 'Callers' })).toBeInViewport();
    // Halt is the largest control in the dock.
    const halt = (await dock.getByRole('button', { name: 'Halt' }).boundingBox())!;
    for (const b of await dock.getByRole('button').all()) {
      const box = (await b.boundingBox())!;
      expect(halt.width * halt.height).toBeGreaterThanOrEqual(box.width * box.height);
      expect(halt.height).toBeGreaterThanOrEqual(box.height);
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-run.png` });
    await dock.getByRole('button', { name: 'Halt' }).click();
    await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
  });
}
