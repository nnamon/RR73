// Hound mode's screens on iPhone viewports in WebKit, light and dark: the band sheet with the
// Hound switch, Operate's top bar and status line while calling the Fox and after its report,
// and the ••• menu. Nothing overflows sideways and every control is at least 44 px. Decodes come
// through the screen-review hooks (src/lib/testing/e2e-hooks.ts).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { smallTargets } from './layout-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/hound', import.meta.url));
const SLOT = 15_000;
const INSETS: Record<number, { top: number; bottom: number }> = { 393: { top: 59, bottom: 34 }, 375: { top: 20, bottom: 0 } };

const d = (text: string, snr_db: number, freq_hz: number) => ({ text, snr_db, freq_hz, dt_s: 0.1 });
/** The Fox's slot: CQ alone, then its streams. */
const FOX_CQ = [d('CQ VP8PJ GD18', -6, 300), d('CQ JA1XYZ PM95', -12, 1640), d('K1ABC W9XYZ R-11', -15, 2210)];
const FOX_WORKING = [d('W9XYZ VP8PJ -14', -14, 300), d('G4AAA RR73; 9V1NE <VP8PJ> -12', -15, 360), d('DL2ABC VP8PJ -08', -15, 420)];

async function inject(page: Page, slotStartMs: number, decodes: ReturnType<typeof d>[]) {
  await page.evaluate(([s, ds]) => window.__rr73!.decoded(s as number, ds as ReturnType<typeof d>[]), [slotStartMs, decodes] as const);
}

/** Waits for an odd slot between 2 and 6 s old; returns the start of the even slot before it. */
async function afterFoxSlot(page: Page): Promise<number> {
  for (;;) {
    const now = Date.now();
    const start = now - (now % SLOT);
    const at = now - start;
    if ((start / SLOT) % 2 === 1 && at >= 2000 && at <= 6000) return start - SLOT;
    await page.waitForTimeout(250);
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`Hound in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    const shot = async (name: string) => {
      await page.waitForTimeout(300);
      expect(await smallTargets(page, 'main .pane:not([hidden])')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${name}.png` });
    };
    await page.addInitScript((i) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
        document.head.append(s);
      });
    }, INSETS[page.viewportSize()!.width]);
    await page.emulateMedia({ colorScheme: theme });
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
    const bar = page.getByRole('region', { name: 'Transmit' });
    const top = page.locator('header.top');

    // Hound on in the band sheet.
    await top.getByRole('button', { name: /^Change band/ }).click();
    const hound = page.getByRole('switch', { name: 'Hound' });
    await hound.check();
    await expect(hound).toBeChecked();
    await shot('1-band-sheet');
    await page.keyboard.press('Escape');
    await expect(top.locator('.mode')).toHaveText('FT8 Hound');

    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
    // Transmitting waits for audio to run, which can come a moment after the banner goes.
    await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 20_000 });

    // Calling the Fox from its CQ: Tx1 waits for the next odd slot.
    const fox = await afterFoxSlot(page);
    await inject(page, fox, FOX_CQ);
    const cq = page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: /^CQ VP8PJ GD18$/ }) }).first();
    // A double-tap while the new rows settle can land as two taps: tap again until the call starts.
    await expect(async () => {
      await cq.dblclick();
      await expect(bar.getByRole('status')).toContainText('Calling the Fox · VP8PJ', { timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await shot('2-calling');

    // The Fox's report to us inside a multi-call message, among its other streams.
    await inject(page, fox, FOX_WORKING);
    await expect(bar.getByRole('status')).toContainText('Report received · −12 dB from VP8PJ');
    await expect(bar.getByRole('list', { name: 'QSO progress' })).toContainText('Logged');
    await shot('3-report');

    await bar.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: /^Hound/ })).toHaveAttribute('aria-checked', 'true');
    await shot('4-menu');
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  });
}
