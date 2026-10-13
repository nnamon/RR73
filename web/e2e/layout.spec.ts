// Layout on iPhone viewports in WebKit, light and dark: nothing overflows sideways, Operate fits
// with its top bar, waterfall, filters, list and bottom bar, every control is at least 44 px,
// pushed screens start with a 44 pt back bar, and each screen is captured.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkLayout, smallTargets } from './layout-checks';
import { LOG_SHEETS, SCREENS, open } from './screens';

const SHOTS = fileURLToPath(new URL('../test-results/screens', import.meta.url));

/** Ink boxes of every bar button glyph in the visible pane: the drawn shapes plus half their stroke. */
function barInks(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<SVGSVGElement>('main .pane:not([hidden]) .bar-button svg')].map((svg) => {
      const box = svg.getBoundingClientRect();
      const scale = box.width / 24;
      let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const el of svg.querySelectorAll<SVGGraphicsElement>('path, circle, ellipse')) {
        const bb = el.getBBox();
        const cs = getComputedStyle(el);
        const half = cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) / 2 : 0;
        l = Math.min(l, bb.x - half);
        t = Math.min(t, bb.y - half);
        r = Math.max(r, bb.x + bb.width + half);
        b = Math.max(b, bb.y + bb.height + half);
      }
      return { left: box.left + l * scale, right: box.left + r * scale, width: (r - l) * scale, height: (b - t) * scale };
    }),
  );
}

for (const theme of ['light', 'dark'] as const) {
  for (const s of SCREENS) {
    test(`${s.name} in ${theme}`, async ({ page }, info) => {
      await open(page, s.path, theme, s.seed, s.features);
      await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeAttached();
      await checkLayout(page);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${s.name}.png` });
    });
  }

  test(`pushed screens start with a 44 pt back bar and bar buttons follow iOS in ${theme}`, async ({ page }) => {
    const titles: { path: string; top: number; fontSize: string }[] = [];
    for (const path of ['#/log', '#/spots', '#/settings', '#/settings/logging', '#/settings/logging/wavelog', '#/settings/radio', '#/settings/versions']) {
      await open(page, path, theme, undefined, path === '#/spots' ? { activations: true } : undefined);
      const pane = page.locator('main .pane:not([hidden])');
      const back = (await pane.locator('.bar').first().boundingBox())!;
      expect([Math.round(back.y), Math.round(back.height)], path).toEqual([0, 44]);
      const h1 = pane.locator('h1');
      titles.push({ path, top: Math.round((await h1.boundingBox())!.y), fontSize: await h1.evaluate((el) => getComputedStyle(el).fontSize) });
    }
    // One title row for every screen: the centred 17 pt title in the bar.
    expect(new Set(titles.map((t) => `${t.top},${t.fontSize}`)).size, JSON.stringify(titles)).toBe(1);
    // Log, Spots and Settings go back to Operate.
    await open(page, '#/log', theme);
    await expect(page.getByRole('link', { name: 'Operate' })).toHaveAttribute('href', '#/operate');

    // The Log's bar buttons, Add QSO and Export ADIF (disabled: no QSOs yet).
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const buttons = page.locator('main .pane:not([hidden]) .bar-button');
    await expect(buttons).toHaveCount(2);
    const boxes = [(await buttons.nth(0).boundingBox())!, (await buttons.nth(1).boundingBox())!];
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    // Side by side as UIKit places bar items: the targets never overlap.
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 0.5);
    const inks = await barInks(page);
    expect(width - inks[1].right).toBeCloseTo(16, 0);
    const gap = inks[1].left - inks[0].right;
    expect(gap).toBeGreaterThanOrEqual(24);
    expect(gap).toBeLessThanOrEqual(28);
    expect(Math.abs(inks[0].width - inks[1].width)).toBeLessThan(0.5);
    const look = (i: number) => buttons.nth(i).evaluate((el) => ({ color: getComputedStyle(el).color, opacity: Number(getComputedStyle(el).opacity), stroke: getComputedStyle(el.querySelector('g')!).strokeWidth }));
    const [add, exportAdif] = [await look(0), await look(1)];
    await expect(buttons.nth(1)).toBeDisabled();
    expect(exportAdif.color).toBe(add.color);
    expect(exportAdif.stroke).toBe(add.stroke);
    expect(add.opacity).toBe(1);
    expect(exportAdif.opacity).toBeLessThan(0.5);
  });

  for (const running of [false, true]) {
    test(`operate fits without scrolling, one bar at each end${running ? ' with an activation running' : ''} in ${theme}`, async ({ page }) => {
      await open(page, '#/operate', theme, running ? 'running' : undefined, running ? { activations: true } : undefined);
      if (running) await expect(page.getByRole('link', { name: /^Activation POTA VK-0921 \+1, 7 of 10\./ })).toBeVisible();
      const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
      const top = (await page.locator('.operate header.top').boundingBox())!;
      const wf = (await page.getByTestId('waterfall').boundingBox())!;
      const filters = (await page.getByRole('radiogroup', { name: 'Show decodes' }).boundingBox())!;
      const list = (await page.getByTestId('decode-list').boundingBox())!;
      const bar = (await page.getByRole('region', { name: 'Transmit' }).boundingBox())!;
      // The top bar is one 44 pt row; the waterfall is 130 pt at 393 x 852 and 110 pt at 375 x 667.
      expect([Math.round(top.y), Math.round(top.height)]).toEqual([0, 44]);
      expect(wf.height).toBeCloseTo(38 + 0.108 * vh, 0);
      expect(filters.height).toBeLessThanOrEqual(44);
      expect(list.y + list.height).toBeLessThanOrEqual(bar.y + 0.5);
      // The bottom bar sits at the bottom, with Halt in it; no tab bar.
      expect(bar.y + bar.height).toBeCloseTo(vh, 0);
      expect(bar.height).toBeLessThanOrEqual(54);
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
      const halt = (await page.getByRole('button', { name: 'Halt' }).boundingBox())!;
      expect(halt.height).toBeGreaterThanOrEqual(43.5);
      expect(halt.x + halt.width).toBeLessThanOrEqual(vw);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(vh);
      await checkLayout(page);
    });
  }

  test(`band sheet in ${theme}`, async ({ page }, info) => {
    await open(page, '#/operate', theme);
    await page.getByRole('button', { name: /^Change band/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Change band' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('14.074 MHz')).toBeVisible();
    // No Use or Cancel step: a tap on a band applies it.
    await expect(sheet.getByRole('button', { name: /^Use / })).toHaveCount(0);
    const box = (await sheet.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-band.png` });
  });

  for (const c of LOG_SHEETS) {
    test(`${c.name} sheet in ${theme}`, async ({ page }, info) => {
      await open(page, c.path, theme, c.seed, c.features);
      await c.open(page);
      const sheet = page.getByRole('dialog', { name: c.title });
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      const wide = await page.evaluate((w) => [...document.querySelectorAll<HTMLElement>('dialog[open] *')].filter((el) => el.getBoundingClientRect().right > w + 0.5 && !el.closest('.visually-hidden')).map((el) => el.className), vw);
      expect(wide).toEqual([]);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-sheet-${c.name}.png` });
    });
  }

  test(`logged notice sits inside the screen in ${theme}`, async ({ page }, info) => {
    await open(page, '#/log', theme);
    await page.getByRole('button', { name: 'Add QSO' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add QSO' });
    await sheet.getByRole('textbox', { name: 'Callsign' }).fill('VK3/9V1NE/P');
    await sheet.getByRole('button', { name: 'Add QSO' }).click();
    const notice = page.getByTestId('log-notice');
    await expect(notice).toBeVisible();
    const n = (await notice.boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    expect(await smallTargets(page, '[data-testid=log-notice]')).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-logged-notice.png` });
  });

  test(`tune sheet in ${theme}`, async ({ page }, info) => {
    await open(page, '#/settings/radio', theme);
    await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Tuning' });
    await expect(sheet).toBeVisible();
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-tune.png` });
    await sheet.getByRole('button', { name: 'Halt' }).click();
    await expect(sheet).toBeHidden();
  });

  test(`bottom bar controls in one row in ${theme}`, async ({ page }, info) => {
    await open(page, '#/operate', theme);
    const bar = page.getByRole('region', { name: 'Transmit' });
    const buttons = await bar.getByRole('button').all();
    expect(buttons).toHaveLength(5);
    const boxes = await Promise.all(buttons.map(async (b) => (await b.boundingBox())!));
    // One row of 44 pt targets, side by side; Halt takes the rest of the row.
    for (const b of boxes) {
      expect(b.height).toBeGreaterThanOrEqual(43.5);
      expect(b.width).toBeGreaterThanOrEqual(43.5);
      expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(1);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
    const halt = boxes.at(-1)!;
    for (const b of boxes.slice(0, -1)) expect(halt.width).toBeGreaterThanOrEqual(b.width);
    await expect(buttons.at(-1)!).toHaveText('Halt');

    await bar.getByRole('button', { name: 'More' }).click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu).toBeVisible();
    expect(await smallTargets(page, '[role=menu]')).toEqual([]);
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(halt.y);
    expect(m.x + m.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-menu.png` });
  });
}
