// Operate on iPhone viewports, shared by states.spec.ts (the visual review, on the air) and
// operate.spec.ts (CI, decodes injected): the device's insets, two busy slots, and the checks on
// the decode list's rows. Decodes come through the screen-review hooks (src/lib/testing/e2e-hooks.ts).
import { expect, type Locator, type Page } from '@playwright/test';
import { useTheme } from './theme';

export const SLOT = 15_000;

/** Status bar and home indicator insets, pt: iPhone 15 and 16 (393 x 852), iPhone SE (375 x 667). */
export const INSETS: Record<number, { top: number; bottom: number }> = { 393: { top: 59, bottom: 34 }, 375: { top: 20, bottom: 0 } };
/** Decode rows that must show, by viewport width. */
export const TARGET: Record<number, { receiving: number; qso: number }> = { 393: { receiving: 13, qso: 9 }, 375: { receiving: 10, qso: 8 } };

export interface D {
  text: string;
  snr_db: number;
  freq_hz: number;
  dt_s: number;
}
export const d = (text: string, snr_db: number, freq_hz: number, dt_s = 0.1): D => ({ text, snr_db, freq_hz, dt_s });

/** Two busy 20m slots, as heard from Singapore. */
export const SLOT_A: D[] = [
  d('CQ BH1LKO OM89', -7, 1959, 0.2),
  d('CQ A41ZZ LL93', -4, 956, 0.2),
  d('BD7PDP 4I1LCT RR73', 5, 1084),
  d('JG1FVM E27CJS RRR', 3, 531),
  d('BG7DTK JK2VOC PM84', -13, 1803, 0.4),
  d('UN3P BA5CJ 73', -11, 2625, 0.3),
  d('LB7YK JR1NHD PM95', -20, 2784),
  d('M7IUN JA7XVZ QM09', -6, 875, 0.2),
  d('RA6LIS BA4IE OM86', -15, 1897, 0.3),
  d('VR2XMT 9M2TRX RR73', -9, 1066),
];
/** The message to you comes fifth from the decoder and leads the slot on screen. */
export const SLOT_B: D[] = [
  d('BH1LKO VK4SHG 73', 4, 1641, 0.2),
  d('PV5N 6K2MAS PM37', -10, 622),
  d('CQ VJ6X OF78', 1, 506),
  d('JA8HCE VK2AXN RR73', -8, 1169),
  d('9V1NE JA1KXM PM95', -14, 2397),
  d('CQ DX ZL1TQK RF73', -18, 2210, 0.2),
  d('CQ XV9Q OK30', -12, 1310, 0.3),
  d('YB0AZK DU1XYZ PK04', 2, 1222),
  d('BV2AA JA3QRS -05', -6, 1780),
  d('CQ HL2ZZZ PM37', -21, 2412),
];

export async function inject(page: Page, slotStartMs: number, decodes: D[]) {
  await page.evaluate(([s, ds]) => window.__rr73!.decoded(s as number, ds as D[]), [slotStartMs, decodes] as const);
}

/** Waits until the current slot is between `fromS` and `toS` seconds old and has the parity asked for; returns its start. */
export async function phase(page: Page, fromS: number, toS: number, parity?: 'even' | 'odd'): Promise<number> {
  for (;;) {
    const now = Date.now();
    const start = now - (now % SLOT);
    const p = (start / SLOT) % 2 === 0 ? 'even' : 'odd';
    const at = now - start;
    if (at >= fromS * 1000 && at <= toS * 1000 && (!parity || p === parity)) return start;
    await page.waitForTimeout(250);
  }
}

export function rowOf(page: Page, text: string): Locator {
  return page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();
}

/** "13:14:15" for a UTC time in ms. */
export const utc = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** The message of the first row under the bar of the slot starting at `slotMs`. */
export function firstInSlot(page: Page, slotMs: number): Promise<string | null> {
  return page.getByTestId('decode-list').evaluate((el, t) => {
    const bar = [...el.querySelectorAll('li.slot-bar:not(.quiet)')].find((b) => b.querySelector('.st')?.textContent === t);
    return bar?.nextElementSibling?.querySelector('.c-msg')?.textContent ?? null;
  }, utc(slotMs));
}

/** A message to you: the red edge in the transmit red, heavy text, full contrast. */
export async function expectToYou(row: Locator) {
  await expect(row).toHaveClass(/\bto-you\b/);
  await expect(row).toHaveCSS('opacity', '1');
  const look = await row.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--rr-tx)';
    document.body.append(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    return { edge: getComputedStyle(el, '::after').backgroundColor, red, weight: getComputedStyle(el.querySelector('.c-msg')!).fontWeight };
  });
  expect(look.edge).toBe(look.red);
  expect(look.weight).toBe('800');
}

/** Our own rows and every slot bar at full contrast. */
export async function expectOursClear(page: Page) {
  const opacities = await page
    .getByTestId('decode-list')
    .locator('.dr.out, li.slot-bar')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
  expect(opacities.length).toBeGreaterThan(0);
  expect(new Set(opacities)).toEqual(new Set(['1']));
}

/** No decode row dims: receiving, calling CQ with nobody answering, after a QSO and with Tx off. */
export async function expectNoneDim(page: Page) {
  await expect(page.getByTestId('decode-list').locator('button.dr.dim')).toHaveCount(0);
}

/** Decode rows wholly inside the list's box. */
export function rowsOnScreen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid=decode-list]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid=decode-list] button.dr')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5;
    }).length;
  });
}

/** Operate with the device's insets, in `theme`, with callsign and grid set and audio on. */
export async function openOperate(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[page.viewportSize()!.width]);
  await useTheme(page, theme);

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
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
}
