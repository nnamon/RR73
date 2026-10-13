// Operate in the states an operator meets, on iPhone viewports in WebKit, light and dark: each
// state is captured for the visual review, the decode rows on screen are counted against the
// targets (13 receiving at 393 x 852, 10 at 375 x 667), and the bottom bar keeps one height. The
// status bar and home indicator insets of the device are applied, as the app runs from the Home
// Screen. WebKit's mock microphone runs the audio; decodes come through the screen-review hooks
// (src/lib/testing/e2e-hooks.ts). Transmissions are real: the scheduler plays them.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { smallTargets } from './layout-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/states', import.meta.url));
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

/** Two busy 20m slots, as heard from Singapore. */
const SLOT_A: D[] = [
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
const SLOT_B: D[] = [
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
/** Stations answering a CQ in Run. */
const CALLERS: D[] = [d('9V1NE K1ABC FN42', -12, 2341, 0.2), d('9V1NE ZL1TQK RF73', -4, 2430), d('9V1NE DU1XYZ PK04', -18, 842, 0.3), ...SLOT_A.slice(0, 6)];

async function inject(page: Page, slotStartMs: number, decodes: D[]) {
  await page.evaluate(([s, ds]) => window.__rr73!.decoded(s as number, ds as D[]), [slotStartMs, decodes] as const);
}

/** Waits until the current slot is between `fromS` and `toS` seconds old and has the parity asked for; returns its start. */
async function phase(page: Page, fromS: number, toS: number, parity?: 'even' | 'odd'): Promise<number> {
  for (;;) {
    const now = Date.now();
    const start = now - (now % SLOT);
    const p = (start / SLOT) % 2 === 0 ? 'even' : 'odd';
    const at = now - start;
    if (at >= fromS * 1000 && at <= toS * 1000 && (!parity || p === parity)) return start;
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

for (const theme of ['light', 'dark'] as const) {
  test(`Operate states in ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const width = page.viewportSize()!.width;
    const inset = INSETS[width];
    const counts: Record<string, number> = {};
    const bars: Record<string, number> = {};
    mkdirSync(SHOTS, { recursive: true });
    const shot = async (name: string) => {
      // As after a tap on the new decodes pill: the newest slot at the top.
      await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
      await page.waitForTimeout(400);
      counts[name] = await rowsOnScreen(page);
      bars[name] = Math.round((await page.getByRole('region', { name: 'Transmit' }).boundingBox())!.height * 2) / 2;
      expect(await smallTargets(page, 'main .pane:not([hidden])')).toEqual([]);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wide).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${name}.png` });
    };
    await page.addInitScript((i) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
        document.head.append(s);
      });
    }, inset);
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

    // Receiving: audio on, nothing decoded yet.
    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
    await shot('1-receiving');

    // Two slots of decodes.
    let now = await phase(page, 2, 11);
    await inject(page, now - 2 * SLOT, SLOT_B);
    await inject(page, now - SLOT, SLOT_A);
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toBeVisible();
    await shot('2-decodes');
    expect(counts['2-decodes']).toBeGreaterThanOrEqual(TARGET[width].receiving);

    // CQ: planned at once, with a countdown at the top of the list, then on air with a progress line.
    // Clicked early in an odd slot, so the even slot it goes out in is 9 to 14 s away.
    await phase(page, 1, 6, 'odd');
    await bar.getByRole('button', { name: 'CQ', exact: true }).click();
    // Tx on is a light tint, set apart from the solid CQ button.
    await expect(bar.locator('[data-id=tx]')).toHaveClass(/soft/);
    await expect(bar.locator('[data-id=cq]')).toHaveClass(/selected/);
    const next = page.getByTestId('next-row');
    await expect(next).toBeVisible();
    await expect(next.locator('.c-tag')).toHaveText(/^Next · :[0-5]\d$/);
    await expect(next.locator('.c-when')).toHaveText(/^in \d+ s$/);
    await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/CQ.*Report.*R-report.*RR73.*Logged/);
    await shot('3-cq-next');
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 35_000 });
    await expect(bar.locator('[data-id=tx]')).toHaveClass(/air/);
    const cqSlot = await page.evaluate(() => Date.now() - (Date.now() % 15_000));
    const sending = page.getByTestId('decode-list').locator('button.dr.sending');
    await expect(sending.locator('.c-tag')).toHaveText('Sending');
    await expect(next).toHaveCount(0);
    await page.waitForTimeout(2000);
    await shot('4-cq-sending');
    expect(await sending.locator('.prog').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0);
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
    await expect(page.getByTestId('decode-list').locator('button.dr.sent .c-tag').first()).toHaveText('Sent');

    // Calling: fresh decodes in the slot after the CQ; a double-tap on a CQ calls with Tx on, and
    // the next slot of the other parity goes out.
    // The slot heard in has ended and was decoded, so the decoder's own result does not replace it.
    let after = await phase(page, 2, 5);
    while (after - SLOT <= cqSlot) {
      await page.waitForTimeout(SLOT - 4000);
      after = await phase(page, 2, 5);
    }
    await inject(page, after - SLOT, SLOT_B);
    // Both taps in one task, so a loaded machine cannot stretch them past the double-tap time.
    await rowOf(page, 'CQ VJ6X OF78').evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    await expect(bar.getByRole('button', { name: 'Tx on' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
    // The slot RR73 transmits in, read as soon as it is on air: the screenshot below can run past
    // the slot boundary on a loaded machine.
    const ours = await page.evaluate(() => Date.now() - (Date.now() % 15_000));
    await shot('5-calling');
    expect(counts['5-calling']).toBeGreaterThanOrEqual(TARGET[width].qso);

    // The radio hands RR73's own signal back in the slot it transmits in, at +45 dB: that slot is
    // not decoded or shown, and the amber row says what was sent.
    await inject(page, ours, [d('VJ6X 9V1NE OJ11', 45, 1500, -0.7)]);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: /^VJ6X 9V1NE OJ11$/ }) })).toHaveCount(1);
    await expect(rowOf(page, 'VJ6X 9V1NE OJ11')).toHaveClass(/k-sent/);

    // In a QSO: VJ6X answers with a report in the slot after ours, decoded as it starts so the
    // next transmission is planned and not yet on air.
    await page.waitForTimeout(Math.max(0, ours + SLOT + 500 - Date.now()));
    await inject(page, ours + SLOT, [d('9V1NE VJ6X -12', -9, 506), ...SLOT_A.slice(0, 7)]);
    await expect(bar.getByRole('list', { name: 'QSO progress' })).toBeVisible();
    await expect(bar.getByText(/^Tx3 · VJ6X 9V1NE R-09/)).toBeVisible();
    await shot('6-in-qso');
    expect(counts['6-in-qso']).toBeGreaterThanOrEqual(TARGET[width].qso);

    // Run: End QSO from the menu, Run, then three callers; the ••• menu open.
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'End QSO' }).click();
    await bar.getByRole('button', { name: 'Run' }).click();
    // The callers answer in an odd slot that starts after the QSO ended, so RR73 sent nothing in it.
    const ended = Date.now();
    now = await phase(page, 2, 11, 'even');
    while (now - SLOT < ended) {
      await page.waitForTimeout(SLOT - 11_000);
      now = await phase(page, 2, 11, 'even');
    }
    await inject(page, now - SLOT, CALLERS);
    await expect(page.getByTestId('decode-list').getByText('Working')).toBeVisible();
    await bar.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    await shot('7-run');
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();

    // One bottom bar height in every state: idle, CQ, calling, in a QSO and Run.
    expect(new Set(Object.values(bars)).size, JSON.stringify(bars)).toBe(1);
    writeFileSync(`${SHOTS}/${info.project.name}-${theme}-rows.json`, JSON.stringify({ counts, bars }));
    console.log(`${info.project.name} ${theme} rows ${JSON.stringify(counts)} bar ${JSON.stringify(bars)}`);
  });
}
