// Layout on iPhone viewports in WebKit, light and dark: nothing overflows sideways, the tab bar
// sits at the bottom, every control is at least 44 px, and each screen is captured.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { LOG_SHEETS, SCREENS, open } from './screens';

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
      await open(page, s.path, theme, s.seed);
      await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeAttached();
      await checkLayout(page);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${s.name}.png` });
    });
  }

  test(`tab roots put the large title in one place and bar buttons follow iOS in ${theme}`, async ({ page }) => {
    const titles: { path: string; top: number; left: number; fontSize: string }[] = [];
    for (const path of ['#/log', '#/spots', '#/settings']) {
      await open(page, path, theme);
      const pane = page.locator('main .pane:not([hidden])');
      const h1 = (await pane.locator('h1').boundingBox())!;
      const fontSize = await pane.locator('h1').evaluate((el) => getComputedStyle(el).fontSize);
      titles.push({ path, top: Math.round(h1.y), left: Math.round(h1.x), fontSize });
      const bar = (await pane.getByTestId('navbar').boundingBox())!;
      expect(bar.y).toBeCloseTo(0, 0);
      expect(bar.height).toBeCloseTo(44, 0);
    }
    expect(new Set(titles.map((t) => `${t.top},${t.left},${t.fontSize}`)).size, JSON.stringify(titles)).toBe(1);
    expect(titles[0]).toMatchObject({ top: 44, left: 0, fontSize: '34px' });

    // Sub-screens: a 44 pt BackLink bar in the same place as the tab roots' navigation bar.
    for (const path of ['#/settings/logging', '#/settings/logging/wavelog', '#/settings/radio', '#/settings/versions']) {
      await open(page, path, theme);
      const back = (await page.locator('main .pane:not([hidden]) .bar').first().boundingBox())!;
      expect([Math.round(back.y), Math.round(back.height)], path).toEqual([0, 44]);
    }

    // The Log's bar buttons, Add QSO and Export ADIF (disabled: no QSOs yet).
    await open(page, '#/log', theme);
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const buttons = page.locator('main .pane:not([hidden]) .bar-button');
    await expect(buttons).toHaveCount(2);
    for (const box of [await buttons.nth(0).boundingBox(), await buttons.nth(1).boundingBox()]) {
      expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([44, 44]);
    }
    const inks = await barInks(page);
    expect(width - inks[1].right).toBeCloseTo(16, 0);
    const gap = inks[1].left - inks[0].right;
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(12);
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
    test(`operate fits without scrolling and keeps the decode list on screen${running ? ' with an activation running' : ''} in ${theme}`, async ({ page }) => {
      await open(page, '#/operate', theme, running ? 'running' : undefined);
      if (running) await expect(page.getByRole('link', { name: /^Activation POTA VK-0921 \+1, 7 of 10\./ })).toBeVisible();
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
  }

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

  for (const c of LOG_SHEETS) {
    test(`${c.name} sheet in ${theme}`, async ({ page }, info) => {
      await open(page, c.path, theme, c.seed);
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

  test(`logged notice sits above the tab bar in ${theme}`, async ({ page }, info) => {
    await open(page, '#/log', theme);
    await page.getByRole('button', { name: 'Add QSO' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add QSO' });
    await sheet.getByRole('textbox', { name: 'Callsign' }).fill('VK3/9V1NE/P');
    await sheet.getByRole('button', { name: 'Add QSO' }).click();
    const notice = page.getByTestId('log-notice');
    await expect(notice).toBeVisible();
    const n = (await notice.boundingBox())!;
    const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
    expect(n.y + n.height).toBeLessThanOrEqual(bar.y + 0.5);
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    expect(await smallTargets(page, '[data-testid=log-notice]')).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-logged-notice.png` });
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
