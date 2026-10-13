// Shared steps for the transmit tests: callsign and grid, the band confirmed, audio started.
import { expect, test, type Page } from '@playwright/test';
import { captured, installTap, slotOf, SLOT_MS, type Captured } from './tap';
import { loadWasm } from './wasm';


declare global {
  interface Window {
    __haltAt: number;
  }
}

export async function prepare(page: Page) {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  await installTap(page);
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')?.textContent?.trim() === 'Halt') window.__haltAt = Date.now();
    }, true);
  });
  await page.goto('./#/settings');
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
  return dock;
}

/** Taps Start audio 0.2 s before a slot boundary, so the script's slots line up with UTC slots. */
export async function startAudioAtBoundary(page: Page) {
  const wait = (14800 - (Date.now() % SLOT_MS) + SLOT_MS) % SLOT_MS;
  await page.waitForTimeout(wait);
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 10_000 });
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

