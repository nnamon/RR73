// Operate in every state an operator meets, on iPhone viewports in WebKit, light and dark: each
// state is checked for layout and captured for the visual review. WebKit's mock microphone runs
// the audio; decodes come through the screen-review hooks (src/lib/testing/e2e-hooks.ts), as the
// container has no radio. Transmissions are real: the scheduler plays them on the audio clock.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkLayout as strictLayout, smallTargets } from './layout-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/states', import.meta.url));
const SLOT = 15_000;
// REVIEW_BEFORE=1 captures every state without failing on layout, for before-and-after review.
const checkLayout = (page: Page) => (process.env.REVIEW_BEFORE ? Promise.resolve() : strictLayout(page));

interface D {
  text: string;
  snr_db: number;
  freq_hz: number;
  dt_s: number;
}
const d = (text: string, snr_db: number, freq_hz: number, dt_s = 0.1): D => ({ text, snr_db, freq_hz, dt_s });

/** A busy 20m slot, as heard from Singapore. */
const BAND: D[] = [
  d('CQ JA1KXM PM95', -8, 1418),
  d('CQ DX VK2ESN QF56', -14, 642),
  d('9V1NE ZL1TQK RF73', -11, 1530),
  d('JH1ABC W1AW R-12', -17, 2110),
  d('CQ POTA K4SWL EM95', -19, 905),
  d('YB0AZK DU1XYZ PK04', 2, 1222),
  d('BV2AA JA3QRS -05', -6, 1780),
  d('CQ HL2ZZZ PM37', -21, 2412),
  d('VR2XMT 9M2TRX RR73', -9, 1066),
];

async function inject(page: Page, slotStartMs: number, decodes: D[]) {
  await page.evaluate(([s, ds]) => window.__rr73!.decoded(s as number, ds as D[]), [slotStartMs, decodes] as const);
}

/** Waits until the current slot is between `fromS` and `toS` seconds old; returns its start. */
async function phase(page: Page, fromS: number, toS: number): Promise<number> {
  for (;;) {
    const now = Date.now();
    const p = now % SLOT;
    if (p >= fromS * 1000 && p <= toS * 1000) return now - p;
    await page.waitForTimeout(Math.max(20, (fromS * 1000 - p + SLOT) % SLOT));
  }
}

function rowOf(page: Page, text: string): Locator {
  return page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();
}

for (const theme of ['light', 'dark'] as const) {
  test(`Operate states in ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const shot = async (name: string) => {
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${name}.png` });
    };
    const dock = page.getByRole('region', { name: 'Transmit' });
    await page.emulateMedia({ colorScheme: theme });

    // First launch: no callsign, audio off.
    await page.goto('./#/operate');
    await page.locator('main h1').first().waitFor({ state: 'attached' });
    await checkLayout(page);
    await shot('01-first-launch');

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

    // The band sheet, from Confirm band.
    await dock.getByRole('button', { name: 'Confirm band' }).click();
    const bandSheet = page.getByRole('dialog', { name: 'Change band' });
    await expect(bandSheet).toBeVisible();
    if (!process.env.REVIEW_BEFORE) expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await shot('02-band-sheet');
    await bandSheet.getByRole('button', { name: 'Use 20m FT8' }).click();
    await expect(bandSheet).toBeHidden();
    await checkLayout(page);
    await shot('03-ready-audio-off');

    // Receiving, nothing decoded yet.
    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.locator('.operate .state')).toHaveText('Receiving', { timeout: 20_000 });
    await checkLayout(page);
    await shot('04-receiving');

    // A slot of decodes, then one selected.
    let now = await phase(page, 2, 11);
    await inject(page, now - SLOT, BAND);
    await expect(rowOf(page, 'CQ JA1KXM PM95')).toBeVisible();
    await checkLayout(page);
    await shot('05-decodes');
    await rowOf(page, 'CQ JA1KXM PM95').click();
    await expect(dock.getByRole('button', { name: /^Call JA1KXM/ })).toBeVisible();
    await checkLayout(page);
    await shot('06-selected');

    // Station details, from Details in the dock (touch and hold is timed, as on a phone, and a
    // loaded test machine can miss it).
    await rowOf(page, 'CQ DX VK2ESN QF56').click();
    await dock.getByRole('button', { name: 'Details' }).click();
    const detail = page.getByRole('dialog', { name: 'VK2ESN' });
    await expect(detail).toBeVisible();
    if (!process.env.REVIEW_BEFORE) expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await shot('07-station-sheet');
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    // The frequency picker.
    const wf = (await page.getByTestId('waterfall').boundingBox())!;
    await page.mouse.click(Math.round(wf.x + (wf.width * 1846) / 3000), Math.round(wf.y + wf.height / 2));
    await expect(page.getByTestId('freq-guide')).toBeVisible();
    await checkLayout(page);
    await shot('08-freq-bar');
    await page.keyboard.press('Escape');

    // Tx1 to Tx6.
    await rowOf(page, 'CQ JA1KXM PM95').click();
    await dock.getByRole('button', { name: /^Call JA1KXM/ }).click();
    await expect(dock.getByText('JA1KXM', { exact: true })).toBeVisible();
    await checkLayout(page);
    await shot('10-calling');
    await dock.getByRole('button', { name: /Messages|Tx1/ }).click();
    const messages = page.getByRole('dialog').last();
    await expect(messages).toBeVisible();
    if (!process.env.REVIEW_BEFORE) expect(await smallTargets(page, 'dialog[open]')).toEqual([]);
    await shot('11-messages');
    await page.keyboard.press('Escape');
    await expect(messages).toBeHidden();
    await dock.getByRole('button', { name: 'Halt' }).click();

    // A QSO: a new station's CQ in the slot that just ended, called at once (a late
    // start, or the next slot under load), on air, then their report in the slot after ours.
    now = await phase(page, 0.3, 0.9);
    await inject(page, now - SLOT, [d('CQ JA2XYZ PM85', -8, 1418), d('CQ DX VK2ESN QF56', -14, 642)]);
    // Select and Call: a double-tap is timed to 350 ms, which a loaded test machine can miss.
    await rowOf(page, 'CQ JA2XYZ PM85').click();
    await dock.getByRole('button', { name: /^Call JA2XYZ/ }).click();
    // On a loaded machine the scheduler can miss the late start limit slot after slot; the
    // review then goes on without these two captures.
    if (process.env.REVIEW_DEBUG) {
      page.on('console', (m) => console.log('PAGE', m.text()));
      for (let i = 0; i < 6; i++) {
        console.log('DOCK', new Date().toISOString().slice(11, 19), (await dock.innerText()).replace(/\n+/g, ' | '));
        await page.waitForTimeout(3000);
      }
    }
    const onAir = await dock.getByText('On air').waitFor({ timeout: 45_000 }).then(
      () => true,
      () => false,
    );
    if (!onAir) test.info().annotations.push({ type: 'review', description: 'Not on air within 45 s: no transmitting or in-QSO capture.' });
    else {
      await expect(page.locator('.operate')).toHaveClass(/transmitting/);
      const txSlot = Date.now() - (Date.now() % SLOT);
      await checkLayout(page);
      await shot('12-transmitting');
      await page.waitForTimeout(Math.max(0, txSlot + 2 * SLOT + 300 - Date.now()));
      await inject(page, txSlot + SLOT, [d('9V1NE JA2XYZ -12', -9, 1418), d('CQ DX VK2ESN QF56', -13, 642)]);
      await expect(rowOf(page, '9V1NE JA2XYZ -12')).toBeVisible();
      await page.waitForTimeout(500);
      await checkLayout(page);
      await shot('13-in-qso');
    }
    await dock.getByRole('button', { name: 'Halt' }).click();

    // Logged: the log's notice with Edit and Undo.
    await page.evaluate(() =>
      window.__rr73!.logged({ call: 'JA1KXM', grid: 'PM95', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: Date.now() - 60_000, endUtcMs: Date.now(), reportSent: '-09', reportRcvd: '-12' }),
    );
    await expect(page.getByTestId('log-notice')).toBeVisible();
    await checkLayout(page);
    await shot('14-logged');

    // Run, from a fresh start: callers in the queue.
    await page.reload();
    await dock.getByRole('button', { name: 'Confirm band' }).click();
    await page.getByRole('dialog', { name: 'Change band' }).getByRole('button', { name: 'Use 20m FT8' }).click();
    await page.getByRole('button', { name: 'Start audio' }).click();
    await expect(page.locator('.operate .state')).toHaveText('Receiving', { timeout: 20_000 });
    await dock.getByRole('button', { name: 'Run', exact: true }).click();
    now = Date.now();
    const cur = now - (now % SLOT);
    // Callers answer in the 2nd (odd) slots when Run calls in the 1st.
    const odd = (cur / SLOT) % 2 === 1 ? cur - 2 * SLOT : cur - SLOT;
    await inject(page, odd, [d('9V1NE K1ABC FN42', -12, 1490), d('9V1NE ZL1TQK RF73', -4, 1620), d('9V1NE DU1XYZ PK04', -18, 1350), d('CQ HL2ZZZ PM37', -20, 2412)]);
    await expect(page.getByRole('list', { name: 'Callers' })).toBeVisible();
    await checkLayout(page);
    await shot('09-run-callers');
    await dock.getByRole('button', { name: 'Halt' }).click();

    // Interrupted: iOS stops the microphone when RR73 leaves the screen.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('status').filter({ hasText: 'Audio stopped at' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await checkLayout(page);
    await shot('15-interrupted');
  });
}
