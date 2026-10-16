// The practice band with a radio connected and Key the radio with CAT on (docs/design/cat.md,
// Transmit): with Play Tx audio on, the switch that lets practice key a connected radio, a practice
// CQ keys the fake IC-705 (fake-ic705.ts) as a real one does, PTT before its audio and off after
// it; with it off, a practice CQ plays no audio and sends no PTT. The output is recorded in the page
// (tap.ts). Runs in the practice project: the band is made in the page and decoded in real time.
import { expect, test, type Page } from '@playwright/test';
import { chooseOutput, connect, installFakeIc705, rigFrames, rigLog, setKeying } from './fake-ic705';
import { prepare, waitForTransmissions } from './txhelp';

// Fake media devices: Key the radio with CAT transmits only to a chosen output.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

test.beforeEach(async ({ page, baseURL }) => {
  // No test reaches a real server.
  const origin = new URL(baseURL!).origin;
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

/** The fake IC-705 connected, a Tx output chosen, Key the radio with CAT on, and the practice band on with Play Tx audio as given. */
async function practiceWithRadio(page: Page, playTx: boolean) {
  await installFakeIc705(page);
  await prepare(page);
  await connect(page);
  await chooseOutput(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/settings/practice'));
  await expect(page.getByTestId('practice-keys')).toHaveText('With Play Tx audio on, practice transmissions key a connected radio, by CAT or VOX.');
  const play = page.getByRole('switch', { name: /^Play Tx audio/ });
  await expect(play).toHaveAccessibleName(/Can key a connected radio/);
  await play.setChecked(playTx);
  const on = page.getByRole('switch', { name: /^Practice band/ });
  await on.check();
  await expect(on).toBeChecked();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('header.top .practice')).toHaveText('Practice');
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

/** The PTT frames the fake radio received from index `from` on. */
async function pttSince(page: Page, from: number) {
  return rigFrames(await rigLog(page), from).filter((f) => f.body === '1C 00 01' || f.body === '1C 00 00');
}

/**
 * The index of the fake radio's log once no PTT frame has come for 1.5 s. Turning the practice band
 * on runs Halt, which sends PTT off while Key the radio with CAT is on, and a loaded machine can
 * delay its OK past 100 ms, so PTT off may go out again 100 ms apart, 4 times at most.
 */
async function settled(page: Page): Promise<number> {
  await expect
    .poll(
      async () => {
        const log = rigFrames(await rigLog(page));
        const last = log.filter((f) => f.body.startsWith('1C 00 0')).at(-1);
        return !last || Date.now() - last.at > 1500;
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toBe(true);
  return (await rigLog(page)).length;
}

test('with Play Tx audio on, a practice CQ keys the radio by CAT: PTT on before its audio and off after it', async ({ page }) => {
  test.setTimeout(150_000);
  await practiceWithRadio(page, true);
  const from = await settled(page);
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  const [tx] = await waitForTransmissions(page, 1, 45_000);
  await expect.poll(async () => (await pttSince(page, from)).length, { timeout: 2000 }).toBeGreaterThanOrEqual(2);
  const [on, off] = await pttSince(page, from);
  expect([on.body, off.body]).toEqual(['1C 00 01', '1C 00 00']);
  // On the audio clock: PTT on before the first sample, off after the last.
  expect(on.ctxS!).toBeLessThan(tx.startS);
  expect(off.ctxS!).toBeGreaterThan(tx.endS);
  expect(tx.endS - tx.startS).toBeGreaterThan(12);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(() => page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('with Play Tx audio off, a practice CQ plays no audio and sends no PTT', async ({ page }) => {
  test.setTimeout(150_000);
  await practiceWithRadio(page, false);
  const from = await settled(page);
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
  // Past the end of the transmission: 12.6 s of FT8 and the tail.
  await page.waitForTimeout(14_000);
  expect(await pttSince(page, from)).toEqual([]);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
  expect(await page.evaluate(() => window.__tx.length)).toBe(0);
  await bar.getByRole('button', { name: 'Halt' }).click();
});
