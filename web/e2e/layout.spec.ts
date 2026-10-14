// Layout on iPhone viewports in WebKit, light and dark: nothing overflows sideways, Operate fits
// with its top bar, waterfall, filters, list and bottom bar, every control is at least 44 px,
// pushed screens start with a 44 pt back bar, and each screen is captured for the visual review.
// CI runs the light theme, at 375 x 667 unless the check depends on the screen size (ci() in
// layout-checks.ts); the review projects run both themes at both sizes and save the screenshots.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkLayout, ci, shot, smallTargets } from './layout-checks';
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

/**
 * Screens whose layout checks another test makes, kept for their screenshots: Operate and Operate
 * with an activation (the operate fits tests), and Settings scrolled to Optional features (the
 * same page as settings).
 */
const SCREENSHOT_ONLY = new Set(['operate', 'operate-running', 'settings-features']);

for (const theme of ['light', 'dark'] as const) {
  for (const s of SCREENS) {
    test(`${s.name} in ${theme}`, SCREENSHOT_ONLY.has(s.name) ? ci(theme) : ci(theme, 375), async ({ page }, info) => {
      await open(page, s.path, theme, s.seed, s.features, s.practice);
      await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeAttached();
      await checkLayout(page);
      await shot(page, info, SHOTS, `${theme}-${s.name}`);
    });
  }

  test(`pushed screens start with a 44 pt back bar and bar buttons follow iOS in ${theme}`, ci(theme, 375), async ({ page }) => {
    const titles: { path: string; top: number; fontSize: string }[] = [];
    for (const path of ['#/log', '#/spots', '#/settings', '#/settings/logging', '#/settings/logging/wavelog', '#/settings/radio', '#/settings/ft8', '#/settings/wspr', '#/settings/versions', '#/settings/colours', '#/settings/practice']) {
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
    test(`operate fits without scrolling, one bar at each end${running ? ' with an activation running' : ''} in ${theme}`, ci(theme, 375, 393), async ({ page }) => {
      await open(page, '#/operate', theme, running ? 'running' : undefined, running ? { activations: true } : undefined);
      if (running) await expect(page.getByRole('link', { name: /^Activation POTA VK-0921 \+1, 7 of 10\./ })).toBeVisible();
      const { vw, vh } = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
      const top = (await page.locator('.operate header.top').boundingBox())!;
      const wf = (await page.getByTestId('waterfall-area').boundingBox())!;
      const filters = (await page.getByRole('radiogroup', { name: 'Show decodes' }).boundingBox())!;
      const list = (await page.getByTestId('decode-list').boundingBox())!;
      const bar = (await page.getByRole('region', { name: 'Transmit' }).boundingBox())!;
      // The top bar is one 44 pt row; the waterfall with its ruler is 130 pt at 393 x 852 and 110 pt
      // at 375 x 667.
      expect([Math.round(top.y), Math.round(top.height)]).toEqual([0, 44]);
      expect(wf.height).toBeCloseTo(38 + 0.108 * vh, 0);
      expect(filters.height).toBeLessThanOrEqual(44);
      expect(list.y + list.height).toBeLessThanOrEqual(bar.y + 0.5);
      // The bottom bar sits at the bottom, with Halt in it; no tab bar.
      expect(bar.y + bar.height).toBeCloseTo(vh, 0);
      // Status line, step row and buttons: one height in every state (operate.spec.ts).
      expect(bar.height).toBeCloseTo(86, 0);
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
      const halt = (await page.getByRole('button', { name: 'Halt' }).boundingBox())!;
      expect(halt.height).toBeGreaterThanOrEqual(43.5);
      expect(halt.x + halt.width).toBeLessThanOrEqual(vw);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(vh);
      await checkLayout(page);
    });
  }

  for (const practice of [false, true]) {
    // The test sets its own widths, so CI runs it in one project.
    test(`the top bar fits its buttons with Spots shown${practice ? ' and practice on' : ''} in ${theme}`, ci(theme, 393), async ({ page }) => {
      await open(page, '#/operate', theme, undefined, { activations: true }, practice);
      const height = page.viewportSize()!.height;
      // iOS fonts run wider than the test browser's, so the bar is checked down to 350 pt as well.
      for (const vw of [393, 375, 360, 350]) {
        await page.setViewportSize({ width: vw, height });
        const band = (await page.getByRole('button', { name: /^Change band/ }).boundingBox())!;
        const clock = (await page.getByRole('timer').boundingBox())!;
        const screens = page.getByRole('navigation', { name: 'Screens' }).getByRole('link');
        await expect(screens).toHaveCount(3);
        const icons = await Promise.all([0, 1, 2].map(async (i) => (await screens.nth(i).boundingBox())!));
        const at = `at ${vw} pt`;
        // Left to right with no overlaps, all inside the screen.
        expect(band.x + band.width, at).toBeLessThanOrEqual(clock.x + 0.5);
        expect(clock.x + clock.width, at).toBeLessThanOrEqual(icons[0].x + 0.5);
        for (let i = 1; i < 3; i++) expect(icons[i - 1].x + icons[i - 1].width, at).toBeLessThanOrEqual(icons[i].x + 0.5);
        expect(icons[2].x + icons[2].width, at).toBeLessThanOrEqual(vw + 0.5);
        for (const b of icons) expect(b.width, at).toBeGreaterThanOrEqual(43.5);
        // The dial shows whole inside the band button or not at all (wrapped below its one line).
        const dial = (await page.locator('header.top .dial').boundingBox())!;
        const inside = dial.x >= band.x - 0.5 && dial.x + dial.width <= band.x + band.width + 0.5 && dial.y + dial.height <= band.y + band.height + 0.5;
        const away = dial.y >= band.y + band.height - 0.5;
        expect(inside || away, `${at}: ${JSON.stringify({ band, dial })}`).toBe(true);
        if (!practice) continue;
        // The Practice badge sits whole between the band button and the clock.
        const tag = (await page.locator('header.top .practice').boundingBox())!;
        expect(tag.x, at).toBeGreaterThanOrEqual(band.x + band.width - 0.5);
        expect(tag.x + tag.width, at).toBeLessThanOrEqual(clock.x + 0.5);
        await expect(page.locator('header.top .practice')).toHaveText('Practice');
      }
    });
  }

  test(`practice scenarios in the ••• menu in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    await open(page, '#/operate', theme, undefined, undefined, true);
    const bar = page.getByRole('region', { name: 'Transmit' });
    await bar.getByRole('button', { name: 'More' }).click();
    const menu = page.getByRole('menu', { name: 'More' });
    const items = menu.getByRole('menuitemradio');
    await expect(items).toHaveCount(11);
    await expect(items.first()).toHaveText('Practice: Random band');
    await expect(items.first()).toHaveAttribute('aria-checked', 'true');
    expect(await smallTargets(page, '[role=menu]')).toEqual([]);
    // Taller than a small screen: the menu stays above the bar and scrolls to its last item.
    const halt = (await bar.getByRole('button', { name: 'Halt' }).boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(halt.y);
    await shot(page, info, SHOTS, `${theme}-practice-menu`, 200);
    await items.last().scrollIntoViewIfNeeded();
    const last = (await items.last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(m.y + m.height + 0.5);
    await shot(page, info, SHOTS, `${theme}-practice-menu-end`, 200);
  });

  test(`a drag on the waterfall never scrolls the screen in ${theme}`, ci(theme, 375), async ({ page }) => {
    await open(page, '#/operate', theme);
    // 0.9.1 left vertical pans to the browser (touch-action: pan-y) and only body hid its
    // overflow: on an iPhone a drag on the waterfall slid Operate up by 470 pt.
    const area = page.getByTestId('waterfall-area');
    expect(await area.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    const root = await page.evaluate(() => {
      const [h, b] = [getComputedStyle(document.documentElement), getComputedStyle(document.body)];
      return { html: [h.overflowY, h.overscrollBehaviorY], body: [b.overflowY, b.position] };
    });
    expect(root).toEqual({ html: ['hidden', 'none'], body: ['hidden', 'fixed'] });
    // A drag with a vertical part, then a scroll asked for outright: the document stays put.
    const b = (await area.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.3, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height + 300, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(() => window.scrollTo(0, 470));
    expect(await page.evaluate(() => ({ y: window.scrollY, fits: document.scrollingElement!.scrollHeight <= window.innerHeight }))).toEqual({ y: 0, fits: true });
  });

  test(`band sheet in ${theme}`, ci(theme, 375), async ({ page }, info) => {
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
    await shot(page, info, SHOTS, `${theme}-band`, 200);
  });

  for (const c of LOG_SHEETS) {
    test(`${c.name} sheet in ${theme}`, ci(theme, 375), async ({ page }, info) => {
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
      await shot(page, info, SHOTS, `${theme}-sheet-${c.name}`, 200);
    });
  }

  test(`logged notice sits inside the screen in ${theme}`, ci(theme, 375), async ({ page }, info) => {
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
    await shot(page, info, SHOTS, `${theme}-logged-notice`);
  });

  test(`logged notice floats above Operate's buttons without moving them in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    await open(page, '#/operate', theme);
    const bar = page.getByRole('region', { name: 'Transmit' });
    const before = (await bar.boundingBox())!;
    await page.goto('./#/log');
    await page.getByRole('button', { name: 'Add QSO' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add QSO' });
    await sheet.getByRole('textbox', { name: 'Callsign' }).fill('JA1KXM');
    await sheet.getByRole('button', { name: 'Add QSO' }).click();
    await page.getByRole('link', { name: 'Operate' }).click();
    const notice = page.getByTestId('log-notice');
    await expect(notice).toBeVisible();
    // In 0.10.1 the notice sat under the bar and pushed it up by the notice's height.
    expect((await bar.boundingBox())!).toEqual(before);
    const n = (await notice.boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(before.y);
    await shot(page, info, SHOTS, `${theme}-logged-notice-operate`);
  });

  test(`tune sheet in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    await open(page, '#/settings/radio', theme);
    await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Tuning' });
    await expect(sheet).toBeVisible();
    expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await shot(page, info, SHOTS, `${theme}-tune`, 200);
    await sheet.getByRole('button', { name: 'Halt' }).click();
    await expect(sheet).toBeHidden();
  });

  test(`bottom bar controls in one row in ${theme}`, ci(theme, 375), async ({ page }, info) => {
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
    // 36 pt faces in the 44 pt targets.
    const faces = await bar.locator('.face').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(new Set(faces)).toEqual(new Set([36]));
    await expect(buttons[2]).toHaveText('Hunt');
    // Room for one more button beside Hunt: every target stays 44 pt wide.
    await bar.locator('[data-id=hunt]').evaluate((el) => {
      const extra = el.cloneNode(true) as HTMLElement;
      extra.dataset.id = 'extra';
      extra.querySelector('.face')!.textContent = 'Spot';
      el.after(extra);
    });
    const six = await Promise.all((await bar.getByRole('button').all()).map(async (b) => (await b.boundingBox())!));
    expect(six).toHaveLength(6);
    for (const b of six) expect(b.width).toBeGreaterThanOrEqual(43.5);
    for (let i = 1; i < six.length; i++) expect(six[i].x).toBeGreaterThanOrEqual(six[i - 1].x + six[i - 1].width - 0.5);
    await bar.locator('[data-id=extra]').evaluate((el) => el.remove());

    await bar.getByRole('button', { name: 'More' }).click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu).toBeVisible();
    expect(await smallTargets(page, '[role=menu]')).toEqual([]);
    const m = (await menu.boundingBox())!;
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(halt.y);
    expect(m.x + m.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    await shot(page, info, SHOTS, `${theme}-menu`, 200);
  });
}
