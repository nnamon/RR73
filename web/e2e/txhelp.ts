// Shared steps for the transmit tests: callsign and grid, the band confirmed, audio started.
import { expect, test, type Page } from '@playwright/test';
import { captured, installTap, slotOf, SLOT_MS, type Captured } from './tap';
import { loadWasm } from './wasm';


declare global {
  interface Window {
    __haltAt: number;
  }
}

/**
 * Sets the callsign and grid and confirms 20m FT8. `setup` runs first on a loaded page, for
 * seeding the log; it may reload, as the tap is installed for every page load. `tap: false`
 * leaves the output tap out, for WebKit: a WebKit page with the tap stopped responding.
 */
export async function prepare(page: Page, setup?: (page: Page) => Promise<void>, opts: { tap?: boolean } = {}) {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  if (opts.tap ?? true) await installTap(page);
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')?.textContent?.trim() === 'Halt') window.__haltAt = Date.now();
    }, true);
  });
  if (setup) {
    await page.goto('./');
    await setup(page);
  }
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
  return page.getByRole('region', { name: 'Transmit' });
}

/** Taps Start audio 0.2 s before a slot boundary, so the script's slots line up with UTC slots. */
export async function startAudioAtBoundary(page: Page) {
  const wait = (14800 - (Date.now() % SLOT_MS) + SLOT_MS) % SLOT_MS;
  await page.waitForTimeout(wait);
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

/** Waits until the current slot is between `fromS` and `toS` seconds old. */
export async function waitForSlotPhase(page: Page, fromS: number, toS: number) {
  const phase = Date.now() % SLOT_MS;
  if (phase >= fromS * 1000 && phase <= toS * 1000) return;
  await page.waitForTimeout((fromS * 1000 - phase + SLOT_MS) % SLOT_MS);
}

export async function waitForTransmissions(page: Page, n: number, timeout: number): Promise<Captured[]> {
  await expect.poll(() => page.evaluate(() => window.__tx.length), { timeout, intervals: [500] }).toBeGreaterThanOrEqual(n);
  return captured(page);
}

/** Start error against slot + 0.5 s, ms. */
export const startError = (t: Captured) => t.startUtc - (slotOf(t) + 500);

