// Operate on iPhone viewports in WebKit, with the status bar and home indicator insets of the
// device: the bottom bar keeps one height, and the decode list keeps its row targets (13 receiving
// at 393 x 852, 10 at 375 x 667; 9 and 8 while calling or in a QSO), from receiving through CQ,
// calling a station and a QSO. Decodes come through the screen-review hooks
// (src/lib/testing/e2e-hooks.ts), and every state is entered within one slot: nothing waits for a
// transmission. states.spec.ts walks the same states on the air for the visual review.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ci, smallTargets } from './layout-checks';

const SLOT = 15_000;

/** Status bar and home indicator insets, pt: iPhone 15 and 16 (393 x 852), iPhone SE (375 x 667). */
const INSETS: Record<number, { top: number; bottom: number }> = { 393: { top: 59, bottom: 34 }, 375: { top: 20, bottom: 0 } };
/** Decode rows that must show, by viewport width. */
const TARGET: Record<number, { receiving: number; qso: number }> = { 393: { receiving: 13, qso: 9 }, 375: { receiving: 10, qso: 8 } };

interface D {
  text: string;
  snr_db: number;
  freq_hz: number;
  dt_s: number;
}
const d = (text: string, snr_db: number, freq_hz: number, dt_s = 0.1): D => ({ text, snr_db, freq_hz, dt_s });

/** Two busy 20m slots, as heard from Singapore, with a station calling us in the newer one. */
const OLDER: D[] = [
  d('9V1NE JA1KXM PM95', -14, 2397),
  d('BH1LKO VK4SHG 73', 4, 1641, 0.2),
  d('PV5N 6K2MAS PM37', -10, 622),
  d('CQ VJ6X OF78', 1, 506),
  d('JA8HCE VK2AXN RR73', -8, 1169),
  d('CQ DX ZL1TQK RF73', -18, 2210, 0.2),
  d('CQ XV9Q OK30', -12, 1310, 0.3),
  d('YB0AZK DU1XYZ PK04', 2, 1222),
  d('BV2AA JA3QRS -05', -6, 1780),
  d('CQ HL2ZZZ PM37', -21, 2412),
];
const NEWER: D[] = [
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
  d('9V1NE K1ABC -12', -9, 2341),
];

async function inject(page: Page, slotStartMs: number, decodes: D[]) {
  await page.evaluate(([s, ds]) => window.__rr73!.decoded(s as number, ds as D[]), [slotStartMs, decodes] as const);
}

/** Waits until the current slot is between `fromS` and `toS` seconds old; returns its start. */
async function phase(page: Page, fromS: number, toS: number): Promise<number> {
  for (;;) {
    const now = Date.now();
    const at = now % SLOT;
    if (at >= fromS * 1000 && at <= toS * 1000) return now - at;
    await page.waitForTimeout(250);
  }
}

function rowOf(page: Page, text: string): Locator {
  return page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();
}

/** Decode rows wholly inside the list's box. */
function rowsOnScreen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid=decode-list]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid=decode-list] button.dr')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= list.top - 0.5 && r.bottom <= list.bottom + 0.5;
    }).length;
  });
}

/** A double-tap with both taps in one task, so a loaded machine cannot stretch them apart. */
const doubleTap = (row: Locator) =>
  row.evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });

test('Operate keeps one bar height and its row targets while receiving, calling CQ, calling a station and in a QSO', ci('light', 375, 393), async ({ page }) => {
  const width = page.viewportSize()!.width;
  const bar = page.getByRole('region', { name: 'Transmit' });
  const heights: Record<string, number> = {};
  /** Records the bar height in `state`, and checks the list, the targets and that nothing scrolls. */
  const check = async (state: string, rows?: number) => {
    await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    heights[state] = Math.round((await bar.boundingBox())!.height * 2) / 2;
    if (rows !== undefined) expect(await rowsOnScreen(page), `rows on screen, ${state}`).toBeGreaterThanOrEqual(rows);
    expect(await smallTargets(page, 'main .pane:not([hidden])'), state).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBeLessThanOrEqual(0);
    // The document never scrolls in any state: only the list does.
    expect(await page.evaluate(() => ({ y: window.scrollY, fits: document.scrollingElement!.scrollHeight <= window.innerHeight })), state).toEqual({ y: 0, fits: true });
  };
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[width]);
  await page.emulateMedia({ colorScheme: 'light' });

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

  // Receiving: audio on, nothing decoded yet.
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
  await check('receiving');

  // Two slots of decodes, injected once the decoder has had the slot that just ended, so its own
  // result does not replace them, and early enough that every state below fits before the next
  // slot's result adds a header to the list.
  const now = await phase(page, 2, 7);
  await inject(page, now - 2 * SLOT, OLDER);
  await inject(page, now - SLOT, NEWER);
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toBeVisible();
  await check('decodes', TARGET[width].receiving);

  // CQ, planned for a later slot: its own steps in the bar.
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/CQ.*Report.*R-report.*RR73.*Logged/);
  await check('cq');
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();

  // Calling a station: a double-tap on its CQ.
  await doubleTap(rowOf(page, 'CQ VJ6X OF78'));
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/Grid.*Report.*R-report.*RR73.*73/);
  await check('calling', TARGET[width].qso);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();

  // In a QSO: a double-tap on a station that called us with a report answers with an R-report.
  await doubleTap(rowOf(page, '9V1NE K1ABC -12'));
  await expect(bar.getByText(/^Tx3 · K1ABC 9V1NE R-09/)).toBeVisible();
  await check('in a QSO', TARGET[width].qso);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();

  // One bottom bar height in every state.
  expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1);
});
