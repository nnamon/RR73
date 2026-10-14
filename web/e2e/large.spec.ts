// Large screens (docs/decisions/0008-large-screens.md): regular width on an iPad upright
// (820 x 1180) and on its side (1180 x 820) and on a desktop (1440 x 900), and compact height on
// a phone on its side (852 x 393), with decodes injected through the screen-review hooks.
// CI runs, in light, one geometry test per size class (@ci-regular in WebKit at 1180 x 820, which
// turns the iPad upright as well; @ci-compact-height in WebKit at 852 x 393) and the keyboard
// shortcuts in Chromium at 1440 x 900 (@ci-keys). The review projects run every test in both
// themes and save the screens to test-results/screens/large for the side-by-side review with the
// approved mockup.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mockupLog, seed, withFeatures } from './log-data';
import { SLOT, d, inject, phase, rowOf, type D } from './operate-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/large', import.meta.url));

const reviewing = (info: TestInfo) => info.project.name.startsWith('review-');

/**
 * Saves `<size>-<theme>-<name>.png` in the review projects; in Chromium also runs axe-core
 * (WCAG 2.0 to 2.2, A and AA) on the screen, as a11y.spec.ts does on the phone.
 */
async function shot(page: Page, info: TestInfo, theme: string, name: string, settleMs = 300) {
  if (!reviewing(info)) return;
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${SHOTS}/${info.project.name.replace(/^review-/, '')}-${theme}-${name}.png` });
  if (!info.project.name.endsWith('chromium')) return;
  // Rows unrelated to a QSO dim on purpose (lib/decode/focus.ts), below text contrast.
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.dr.dim').analyze();
  const found = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect.soft(found, `axe on ${name}`).toEqual([]);
}

/** The band of the approved mockup, heard from 9V1NE in OJ11 on 20m: three slots, oldest first. */
const S00: D[] = [
  d('CQ JA1QXD PM95', -8, 1961),
  d('YB0AZK JH1RRT PM95', 1, 1521),
  d('JA7KTT 9M2TRX OJ02', -15, 1140),
  d('CQ VK3ZOI QF22', -14, 898),
  d('DU1IVT VK2ESN -06', -5, 1679),
  d('CQ BV2AL PL05', -11, 2301),
  d('CQ DX BD7PDP OL72', -10, 2548),
  d('CQ BG7DTK OL63', -19, 2401),
  d('ZL2AB JA1KXM R-12', -9, 451),
  d('CQ DU1IVT PK04', -12, 1100),
];
const S15: D[] = [
  d('CQ VK5PAS PF95', -6, 1310),
  d('JH1RRT YB0AZK -08', -11, 1519),
  d('CQ E27CJS NK97', -13, 2245),
  d('9M2TRX JA7KTT -14', -9, 1143),
  d('CQ RZ0AF NO66', -17, 610),
  d('VK2ESN DU1IVT R-04', -5, 1682),
  d('BG7DTK VR2XAN OL72', -18, 2398),
  d('CQ YB0MWM OI33', -1, 1800),
  d('JA1KXM ZL2AB RR73', -13, 452),
  d('LB7YK JR1NHD PM95', -20, 2784),
];
const S30: D[] = [
  d('CQ JA1QXD PM95', -7, 1959),
  d('CQ VK3ZOI QF22', -12, 897),
  d('JA7KTT 9M2TRX R-09', -14, 1141),
  d('CQ DX BD7PDP OL72', -9, 2547),
  d('YB0AZK JH1RRT R-11', 2, 1522),
  d('CQ UN3P MN83', -16, 2800),
  d('DU1IVT VK2ESN RR73', -4, 1680),
  d('CQ HS0ZIB OK03', -18, 738),
  d('VR2XAN BG7DTK -15', -20, 2402),
  d('CQ 4X1RF KM72', -19, 2120),
  d('ZL2AB JA1KXM 73', -10, 450),
];
/** VK3ZOI answers with a report, among the rest of the band. */
const Q00: D[] = [
  d('CQ JA1QXD PM95', -6, 1958),
  d('JA7KTT 9M2TRX RR73', -13, 1142),
  d('CQ UN3P MN83', -15, 2799),
  d('9V1NE VK3ZOI -12', -12, 902),
  d('YB0AZK JH1RRT 73', 1, 1522),
  d('CQ DX BD7PDP OL72', -9, 2547),
  d('VR2XAN BG7DTK RR73', -19, 2401),
  d('CQ 4X1RF KM72', -18, 2121),
  d('CQ VK2ESN QF56', -5, 1680),
];

/** Operate as 9V1NE in OJ11, in `theme`, with the mockup's log and optional `features`; audio on unless `audio` is false. */
async function start(page: Page, theme: 'light' | 'dark', opts: { audio?: boolean; features?: Parameters<typeof withFeatures>[1]; running?: boolean } = {}) {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('./');
  const log = mockupLog({ running: opts.running });
  await seed(page, opts.features ? withFeatures(log, opts.features) : log);
  await page.goto('./#/settings/station');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.goto('./#/operate');
  await expect(page.getByRole('heading', { name: 'Operate' })).toBeAttached();
  if (opts.audio === false) return;
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
}

/** Rx at 1520 Hz, as in the mockup, through the waterfall's slider. */
async function rxAt(page: Page, hz: number) {
  await page.getByRole('slider', { name: 'Receive frequency, Hz' }).evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, hz);
}

/**
 * The mockup's three slots, injected early in a slot, ending three slots back so a QSO can follow
 * in the slots after them; returns the current slot's start.
 */
async function band(page: Page): Promise<number> {
  const now = await phase(page, 1, 4);
  await inject(page, now - 5 * SLOT, S00);
  await inject(page, now - 4 * SLOT, S15);
  await inject(page, now - 3 * SLOT, S30);
  await expect(rowOf(page, 'CQ VK3ZOI QF22')).toBeVisible();
  return now;
}

/** Widths and heights of a locator, rounded to 0.5 px. */
async function box(page: Page, selector: string) {
  const b = (await page.locator(selector).first().boundingBox())!;
  const r = (v: number) => Math.round(v * 2) / 2;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height), right: r(b.x + b.width), bottom: r(b.y + b.height) };
}

/** Buttons and links under `scope` smaller than 44 x 44 px; decode, spot and message rows are dense rows of 32 and 34 pt. */
function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    const sel = scope
      .split(',')
      .map((p) => `${p.trim()} :is(button, a[href], select, input:not([type=checkbox], [type=radio], [type=range]), label:has(input))`)
      .join(', ');
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('[hidden], dialog:not([open])') || el.classList.contains('visually-hidden') || el.matches('button.dr, button.sr, button.m')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

/**
 * Controls under `scope` wider than their own content: buttons and links at their max-content
 * width, or 44 pt. Rows that run the width of their list, and Halt, are wide on purpose.
 */
function stretched(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    const wide = 'button.dr, button.sr, button.m, .row, .lr-main, a.it, [data-id=halt], .halt, .newpill, .btn.wide';
    const sel = scope
      .split(',')
      .map((p) => `${p.trim()} :is(button, a[href])`)
      .join(', ');
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.matches(wide) || el.closest('[hidden], dialog:not([open]), .visually-hidden')) continue;
      const w = el.getBoundingClientRect().width;
      if (!w) continue;
      const css = el.style.cssText;
      el.style.cssText += ';width:max-content;flex:none;';
      const natural = el.getBoundingClientRect().width;
      el.style.cssText = css;
      if (w > Math.max(natural, 44) + 1) out.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(w)} > ${Math.round(natural)}`);
    }
    return out;
  }, scope);
}

/** Nothing scrolls sideways, in the page or in any element of the screen. */
async function noSideways(page: Page) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push('document');
    for (const el of document.querySelectorAll<HTMLElement>('main *, .app > .top *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5) && getComputedStyle(el).position !== 'fixed' && !el.closest('.visually-hidden, [hidden]')) out.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return out;
  });
  expect(wide).toEqual([]);
}

const SCREEN = 'main .pane:not([hidden]), .app > .top';

test('regular width: RTTY, whose pane marks no parts, takes the whole width under the waterfall', { tag: '@ci-regular' }, async ({ page }, info) => {
  test.skip(info.project.name.includes('852x393'), 'Regular width only: on its side a phone keeps the waterfall on the right');
  await page.goto('./');
  const settings = { callsign: '9V1NE', grid: 'OJ11', band: '20m', mode: 'RTTY', freqPicked: true, schema: 8 };
  await seed(page, { qsos: [], ledger: [], activations: [], destinations: [], kv: [{ key: 'settings', value: settings }] });
  await page.goto('./#/operate');
  const width = page.viewportSize()!.width;
  for (const el of [page.getByTestId('rx-text'), page.getByRole('region', { name: 'Transmit' })]) {
    const b = (await el.boundingBox())!;
    expect(b.x + b.width).toBeGreaterThan(width - 40);
  }
});

test('regular width: tabs, the two panes, the transmit panel and Halt, then upright with a bottom bar', { tag: '@ci-regular' }, async ({ page }) => {
  const { width: W, height: H } = page.viewportSize()!;
  test.skip(W < 1000 || H < 500 || H > W, 'Regular width on its side');
  await start(page, 'light');
  await band(page);
  await expect(page.locator('html')).toHaveAttribute('data-size', 'regular');

  // Tabs in the top bar; Band activity and Rx frequency side by side; the transmit panel on the right.
  await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link')).toHaveText(['Operate', 'Log', 'Settings']);
  const bandPane = await box(page, 'section.pane.band');
  const rxPane = await box(page, 'section.pane.rx');
  const panel = await box(page, 'section.bar.panel');
  expect(bandPane.right).toBeLessThanOrEqual(rxPane.x + 0.5);
  expect(rxPane.right).toBeLessThanOrEqual(panel.x + 0.5);
  expect(panel.width).toBe(336);
  expect(panel.right).toBe(W);
  await expect(page.getByRole('region', { name: 'Transmit' }).getByRole('radio')).toHaveCount(6);
  // The waterfall: across the window, a third of its height at most.
  const wf = await box(page, '[data-testid=waterfall-area]');
  expect(wf.width).toBe(W);
  expect(wf.height).toBeLessThanOrEqual(H / 3 + 1);
  expect(wf.height).toBeGreaterThanOrEqual(H / 4 - 1);

  // Halt: 304 x 64 pt, the largest control, at the foot of the panel.
  const halt = await box(page, 'section.bar.panel [data-id=halt]');
  expect([halt.width, halt.height]).toEqual([304, 64]);
  expect(halt.right).toBe(W - 16);
  expect(halt.bottom).toBe(H - 16);
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);
  expect(await stretched(page, SCREEN)).toEqual([]);

  // Log and Settings: list and detail side by side.
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await page.getByRole('button', { name: /^VK2ESN/ }).first().click();
  await expect(page.getByRole('button', { name: 'Save QSO' })).toBeDisabled();
  expect((await box(page, '.list-col')).right).toBeLessThanOrEqual((await box(page, '.detail-col')).x + 0.5);
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);

  // Upright: the bottom bar, with Halt 240 x 64 pt at its end, and two panes of one width.
  await page.getByRole('link', { name: 'Operate', exact: true }).click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('html')).toHaveAttribute('data-upright', '');
  await expect(page.locator('section.bar.bottom')).toBeVisible();
  const up = await box(page, 'section.bar.bottom [data-id=halt]');
  expect([up.width, up.height]).toEqual([240, 64]);
  expect(up.right).toBe(820 - 16);
  const b2 = await box(page, 'section.pane.band');
  const r2 = await box(page, 'section.pane.rx');
  expect(Math.abs(b2.width - r2.width)).toBeLessThanOrEqual(1);
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);
  expect(await stretched(page, SCREEN)).toEqual([]);
});

test('compact height: the decodes on the left, the waterfall above the controls on the right', { tag: '@ci-compact-height' }, async ({ page }) => {
  test.skip(page.viewportSize()!.height >= 500, 'A phone on its side');
  await start(page, 'light');
  await band(page);
  await expect(page.locator('html')).toHaveAttribute('data-size', 'compact-height');
  const list = await box(page, '[data-testid=decode-list]');
  const wf = await box(page, '[data-testid=waterfall-area]');
  const bar = await box(page, 'section.bar.side');
  // The list runs from under the top bar to the bottom; the column on the right holds the waterfall, then the controls.
  expect(list.right).toBeLessThanOrEqual(wf.x + 0.5);
  expect(list.bottom).toBe(393);
  expect(wf.right).toBe(852);
  expect(wf.width).toBe(334);
  expect(bar.y).toBeGreaterThanOrEqual(wf.bottom - 0.5);
  expect(bar.bottom).toBe(393);
  // Halt across the column, 54 pt high.
  const halt = await box(page, 'section.bar.side [data-id=halt]');
  expect([halt.width, halt.height]).toEqual([334 - 24, 54]);
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);
  expect(await stretched(page, SCREEN)).toEqual([]);

  // Log: list and detail side by side under one bar back to Operate.
  await page.getByRole('link', { name: 'Log' }).click();
  await expect(page.getByRole('link', { name: 'Operate' })).toBeVisible();
  await page.getByRole('button', { name: /^VK2ESN/ }).first().click();
  await expect(page.getByRole('button', { name: 'Save QSO' })).toBeVisible();
  await noSideways(page);
  expect(await smallTargets(page, SCREEN)).toEqual([]);
});

test('keyboard: Esc halts, Return calls, the arrows select, ⌥ keys, B, ? and the tabs', { tag: '@ci-keys' }, async ({ page }, info) => {
  test.skip(!info.project.name.includes('1440x900'), 'A desktop window with a keyboard and a mouse');
  await start(page, 'light', { audio: false });
  const now = await phase(page, 1, 5);
  await inject(page, now - SLOT, S30);
  const bar = page.getByRole('region', { name: 'Transmit' });
  const selected = page.getByTestId('decode-list').locator('button.dr[aria-pressed=true] .c-msg');

  // The arrows move the selection through Band activity, newest first; the status line says how to call.
  await page.keyboard.press('ArrowDown');
  await expect(selected).toHaveText('CQ JA1QXD PM95');
  await page.keyboard.press('ArrowDown');
  await expect(selected).toHaveText('CQ VK3ZOI QF22');
  await expect(bar.getByRole('status')).toContainText('Double-click to call');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toHaveText('CQ VK3ZOI QF22');

  // Return calls the selected station; Esc halts.
  await page.keyboard.press('Enter');
  await expect(bar.getByRole('button', { name: 'Tx on' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('radio', { name: /^Tx1: VK3ZOI 9V1NE OJ11/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toHaveAttribute('aria-pressed', 'false');

  // ⌥C calls CQ, ⌥H hunts, ⌥T turns Tx on; Esc halts each. A key without ⌥ starts nothing.
  await page.keyboard.press('c');
  await page.keyboard.press('t');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await page.keyboard.press('Alt+KeyC');
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Alt+KeyH');
  await expect(bar.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Alt+KeyT');
  await expect(bar.getByRole('button', { name: 'Tx on' })).toBeVisible();

  // On Log, while Tx is on, the top bar carries Halt; Esc halts there too.
  await page.keyboard.press('Alt+Digit2');
  await expect(page).toHaveURL(/#\/log$/);
  const top = page.locator('.app > .top');
  await expect(top.getByRole('status')).toHaveText('Tx on');
  await expect(top.getByRole('button', { name: 'Halt' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(top.getByRole('button', { name: 'Halt' })).toHaveCount(0);

  // B opens the band sheet, Esc closes it; ? opens the shortcuts, Esc closes them.
  await page.keyboard.press('b');
  await expect(page.getByRole('dialog', { name: 'Change band' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Change band' })).toBeHidden();
  await page.keyboard.press('?');
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(keys).toBeVisible();
  await expect(keys.getByRole('listitem')).toHaveCount(9);
  // Shortcuts wait while a sheet is open, but Esc still halts and closes it.
  await page.keyboard.press('Alt+Digit3');
  await expect(page).toHaveURL(/#\/log$/);
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();

  // ⌥3 and ⌥1: Settings and Operate. Typing in a field keeps its keys; Esc still halts.
  await page.keyboard.press('Alt+Digit3');
  await expect(page).toHaveURL(/#\/settings$/);
  await page.getByRole('textbox', { name: 'Callsign' }).focus();
  await page.keyboard.press('Alt+KeyT');
  await page.keyboard.press('b');
  await expect(page.getByRole('dialog', { name: 'Change band' })).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Digit1');
  await expect(page).toHaveURL(/#\/settings$/);
  await page.getByRole('textbox', { name: 'Callsign' }).blur();
  await page.keyboard.press('Alt+Digit1');
  await expect(page).toHaveURL(/#\/operate$/);
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`every screen in ${theme}, for the review`, async ({ page }, info) => {
    test.skip(!reviewing(info), 'Screenshots for the visual review only');
    test.setTimeout(180_000);
    const size = info.project.name;
    const regular = !size.endsWith('852x393');
    await start(page, theme);
    const now = await band(page);
    await rxAt(page, 1520);
    const bar = page.getByRole('region', { name: 'Transmit' });

    // Receiving, VK3ZOI selected.
    await rowOf(page, 'CQ VK3ZOI QF22').click();
    await expect(bar.getByRole('status')).toContainText('VK3ZOI');
    await page.mouse.move(0, 0);
    await shot(page, info, theme, 'operate');

    // In a QSO with VK3ZOI: Tx1 went in the slot after their CQ, they answered with a report, and
    // Tx3 is on air now (shown through the hooks).
    await page.evaluate((s) => window.__rr73!.sent(s, 'VK3ZOI 9V1NE OJ11'), now - 2 * SLOT);
    await inject(page, now - SLOT, Q00);
    await rowOf(page, '9V1NE VK3ZOI -12').evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    await expect(bar.getByText(/^Tx3 · VK3ZOI 9V1NE R-12/)).toBeVisible();
    await page.evaluate((s) => window.__rr73!.ftOnAir(s, 'VK3ZOI 9V1NE R-12', 3), now);
    await page.mouse.move(0, 0);
    await shot(page, info, theme, 'operate-qso');

    // Log with VK2ESN open while on air: On air and Halt in the top bar (regular width).
    await page.goto('./#/log');
    await page.getByRole('button', { name: /^VK2ESN/ }).first().click();
    await shot(page, info, theme, 'log');
    await page.evaluate(() => window.__rr73!.ftOnAir(0, null, 3));

    // Settings: the sections, Station, then Radio and audio.
    await page.goto('./#/settings');
    await shot(page, info, theme, 'settings');
    await page.getByRole('link', { name: /^Radio and audio/ }).click();
    await shot(page, info, theme, 'settings-radio');

    // Back on Operate: the station's details, the band sheet and the shortcuts.
    await page.goto('./#/operate');
    await page.getByRole('button', { name: 'Halt' }).first().click();
    await rowOf(page, 'CQ 4X1RF KM72').scrollIntoViewIfNeeded();
    if (size.endsWith('chromium') || size === 'review-1440x900') await rowOf(page, 'CQ 4X1RF KM72').click({ button: 'right' });
    else {
      const r = (await rowOf(page, 'CQ 4X1RF KM72').boundingBox())!;
      await page.mouse.move(r.x + 40, r.y + r.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
    }
    await expect(page.getByRole('dialog', { name: '4X1RF' })).toBeVisible();
    await shot(page, info, theme, 'station', 500);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Change band/ }).click();
    await shot(page, info, theme, 'band', 500);
    await page.keyboard.press('Escape');
    if (regular) {
      await page.keyboard.press('?');
      await shot(page, info, theme, 'shortcuts', 500);
      await page.keyboard.press('Escape');
    }

    // WSPR: the mode's own middle and controls in the frame.
    await page.getByRole('button', { name: /^Change band/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Change band' });
    await sheet.getByText('WSPR', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const slot = Math.floor(Date.now() / 120_000) * 120_000;
    const spots = [
      ['ZL2BRG RE78 23', 1452, -27],
      ['4X1RF KM72 37', 1478, -22],
      ['VK3ZPF QF22 37', 1489, -19],
      ['JA7KTT QM07 37', 1521, -24],
      ['VK6XLR OF78 37', 1533, -13],
      ['VR2XAN OL72 33', 1547, -20],
      ['DU1IVT PK04 37', 1561, -10],
      ['YB0MWM OI33 30', 1574, -15],
    ] as const;
    await page.evaluate(
      ([s, ds]) => window.__rr73!.wsprDecoded(s as number, ds as never),
      [slot - 120_000, spots.map(([text, f, snr]) => ({ text, freq_hz: f, dt_s: 0.2, drift_hz_per_s: 0, snr_db: snr }))] as const,
    );
    await expect(page.getByTestId('spot-list').locator('button.sr')).toHaveCount(8);
    await shot(page, info, theme, 'wspr');
    await page.getByRole('button', { name: /^Change band/ }).click();
    await sheet.getByText('FT8', { exact: true }).click();
    await page.keyboard.press('Escape');
  });

  test(`Spots with an activation running in ${theme}, for the review`, async ({ page }, info) => {
    test.skip(!reviewing(info), 'Screenshots for the visual review only');
    await start(page, theme, { audio: false, features: { activations: true }, running: true });
    await page.goto('./#/spots');
    await expect(page.getByRole('heading', { name: 'Spots' })).toBeAttached();
    await shot(page, info, theme, 'spots');
  });
}
