// RTTY on large screens (docs/decisions/0008-large-screens.md, approved 14 October 2026): in
// regular width the transmit panel on the right holds the status, the QSO form, their station and
// Halt; the received text, the text to send and the macros take the left. Upright, a bottom bar.
// On a phone on its side, the strip and the bar sit under the waterfall on the right.
import { expect, test, type Page } from '@playwright/test';
import { seed } from './log-data';
import { bigCtyFixture } from '../src/lib/reference/testing';

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);

/**
 * Operate in RTTY as 9V1NE, with JA1XYZ's reply received; audio started unless `audio` is false.
 * `insets` stands in for the screen's safe areas, pt.
 */
async function openRtty(page: Page, audio = true, insets: { left: number; right: number; bottom: number } | null = null) {
  const cty = JSON.stringify(bigCtyFixture());
  await page.route('**/data/cty.json', (route) => route.fulfill({ body: cty, contentType: 'application/json' }));
  if (insets) {
    await page.addInitScript((i) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `:root { --rr-safe-left: ${i.left}px; --rr-safe-right: ${i.right}px; --rr-safe-bottom: ${i.bottom}px; }`;
        document.head.append(s);
      });
    }, insets);
  }
  await page.clock.setFixedTime(at(14, 5, 0));
  await page.goto('./');
  const settings = { callsign: '9V1NE', grid: 'OJ11vi', myName: 'AMON', myQth: 'SINGAPORE', band: '20m', mode: 'RTTY', freqPicked: true, schema: 8 };
  await seed(page, { qsos: [], ledger: [], activations: [], destinations: [], kv: [{ key: 'settings', value: settings }] });
  await page.goto('./#/operate');
  if (audio) {
    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
    await page.evaluate(() => window.__rr73!.rttyDeaf());
  }
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate(() => {
    const text = '9V1NE DE JA1XYZ\nGE OM UR RST 579 579\nNAME TARO QTH YOKOHAMA\n';
    window.__rr73!.rttyText(text, 'r'.repeat(text.length));
  });
}

async function box(page: Page, selector: string) {
  const b = (await page.locator(selector).first().boundingBox())!;
  const r = (v: number) => Math.round(v * 2) / 2;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height), right: r(b.x + b.width), bottom: r(b.y + b.height) };
}

/** Nothing reaches past the window's edges. */
async function noSideways(page: Page) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main *, .app > .top *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5) && !el.closest('.visually-hidden, [hidden], [data-scroll-x]')) out.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return out;
  });
  expect(wide).toEqual([]);
}

const word = (page: Page, w: string) => page.getByTestId('rx-text').locator(`[data-w="${w}"]`);

test('regular width: the transmit panel with the QSO, their station and Halt; the text, the text to send and the macros on the left; upright, a bottom bar', { tag: '@ci-regular' }, async ({ page }) => {
  const { width: W, height: H } = page.viewportSize()!;
  test.skip(W < 1000 || H > W, 'Regular width on its side');
  await openRtty(page);
  await expect(page.locator('html')).toHaveAttribute('data-size', 'regular');

  const panel = await box(page, 'section.bar.panel');
  expect(panel.width).toBe(336);
  expect(panel.right).toBe(W);
  const halt = await box(page, 'section.bar.panel [data-id=halt]');
  expect([halt.width, halt.height]).toEqual([304, 64]);
  expect(halt.right).toBe(W - 16);
  expect(halt.bottom).toBe(H - 16);
  // The waterfall runs across at a quarter of the height.
  const wf = await box(page, '[data-testid=waterfall-area]');
  expect(wf.width).toBe(W);
  expect(Math.abs(wf.y + wf.height - (await box(page, '[data-testid=rx-text]')).y)).toBeLessThan(60);
  // The text, the text to send and the macros on the left of the panel.
  for (const sel of ['[data-testid=rx-text]', '[role=toolbar][aria-label=Macros]', 'input[aria-label="Text to send"], textarea[aria-label="Text to send"]']) {
    const b = await box(page, sel);
    expect(b.right).toBeLessThanOrEqual(panel.x + 0.5);
  }
  const macros = await box(page, '[role=toolbar][aria-label=Macros]');
  expect(macros.bottom).toBeLessThanOrEqual(H);

  // A tap on JA1XYZ fills the panel's form, and their station shows under it.
  await word(page, 'JA1XYZ').first().click();
  const form = page.locator('section.bar.panel').getByRole('group', { name: 'QSO' });
  await expect(form.getByTestId('strip-call')).toHaveValue('JA1XYZ');
  await expect(form.getByTestId('strip-name')).toHaveValue('TARO');
  await expect(page.getByTestId('kb-where')).toContainText('Japan', { timeout: 10_000 });
  await expect(page.getByTestId('kb-before')).toHaveText('Not yet');
  await noSideways(page);

  // Upright: the strip joins the left above the text to send; the bar runs along the bottom.
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('section.bar.bottom')).toBeVisible();
  const up = await box(page, 'section.bar.bottom [data-id=halt]');
  expect([up.width, up.height]).toEqual([240, 64]);
  expect(up.right).toBe(820 - 16);
  const strip = await box(page, '[role=group][aria-label=QSO]');
  const send = await box(page, '[role=toolbar][aria-label=Macros]');
  expect(strip.bottom).toBeLessThanOrEqual(send.y);
  await noSideways(page);
});

test('compact height: the text, the strip and the text to send on the left; the waterfall, the macros and the bar with Halt on the right', { tag: '@ci-compact-height' }, async ({ page }) => {
  test.skip(page.viewportSize()!.height >= 500, 'A phone on its side');
  // An iPhone 15 Pro on its side: 59 pt each side, 21 pt for the home indicator.
  await openRtty(page, true, { left: 59, right: 59, bottom: 21 });
  await expect(page.locator('html')).toHaveAttribute('data-size', 'compact-height');
  const text = await box(page, '[data-testid=rx-text]');
  const wf = await box(page, '[data-testid=waterfall-area]');
  const bar = await box(page, 'section.bar.side');
  expect(text.right).toBeLessThanOrEqual(wf.x + 0.5);
  expect(wf.width).toBe(334);
  expect(bar.y).toBeGreaterThanOrEqual(wf.bottom - 0.5);
  // Halt across the column, whole and above the home indicator.
  const halt = await box(page, 'section.bar.side [data-id=halt]');
  expect([halt.width, halt.height]).toEqual([334 - 24, 54]);
  expect(halt.x).toBe(wf.x + 12);
  expect(halt.bottom).toBeLessThanOrEqual(393 - 21);
  // The macros under the waterfall; the tuning row, the strip with its chevron and the text to send on the left.
  const macros = await box(page, '[role=toolbar][aria-label=Macros]');
  expect(macros.x).toBeGreaterThanOrEqual(wf.x - 0.5);
  expect(macros.bottom).toBeLessThanOrEqual(bar.y + 0.5);
  for (const sel of ['[role=toolbar][aria-label=Tuning] button', '[role=group][aria-label=QSO]', 'button[aria-label="Open the QSO sheet"]', '[aria-label="Text to send"]']) {
    const b = await box(page, sel);
    expect(b.x).toBeGreaterThanOrEqual(59);
    expect(b.right).toBeLessThanOrEqual(wf.x + 0.5);
  }
  await noSideways(page);
});

test('keyboard in RTTY: F1 sends the first macro and ⌥T is RTTY’s Tx; the macros show their keys; the sheet lists them', { tag: '@ci-keys' }, async ({ page }, info) => {
  test.skip(!info.project.name.includes('1440x900'), 'A desktop window with a keyboard and a mouse');
  // No audio: a transmission RTTY starts says Audio off, which shows the key reached RTTY.
  await openRtty(page, false);
  const status = page.getByTestId('kb-status');
  const macros = page.getByRole('toolbar', { name: 'Macros' });
  await expect(macros.getByRole('button').first()).toHaveAttribute('aria-keyshortcuts', 'F1');
  await expect(macros.locator('kbd').first()).toHaveText('F1');
  await expect(page.locator('section.bar.panel [data-id=halt] kbd')).toHaveText('esc');

  await page.keyboard.press('F1');
  await expect(status).toHaveText(/^Audio off/);
  await page.clock.setFixedTime(at(14, 6, 0));
  await expect(status).not.toHaveText(/^Audio off/);
  // ⌥T acted on FT8's sequencer in RTTY before.
  await page.keyboard.press('Alt+KeyT');
  await expect(status).toHaveText(/^Audio off/);

  // F1 also acts while the text to send has focus.
  await page.clock.setFixedTime(at(14, 7, 0));
  const field = page.getByRole('textbox', { name: 'Text to send' });
  await field.focus();
  await page.keyboard.press('F1');
  await expect(status).toHaveText(/^Audio off/);
  await field.blur();

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet.getByRole('listitem')).toHaveCount(7);
  await expect(sheet).toContainText('Send a macro, in its order');
  await expect(sheet).not.toContainText('Call CQ');
  await page.keyboard.press('Escape');
});
