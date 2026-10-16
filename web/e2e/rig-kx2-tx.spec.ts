// The KX2's transmissions end to end in Chromium (docs/design/cat.md, Elecraft KX2), with
// navigator.serial replaced by a fake KX2 behind a Digirig (fake-kx2.ts) and the app's output
// recorded in the page (tap.ts): TX and RX around a CQ with Key the radio with CAT off and on, and
// Halt. It runs in the tx-cq project, after the rest of the suite, as rig-tx.spec does.
//
// TX and RX are timed against the audio on the audio clock: the fake radio notes
// AudioContext.currentTime as each write arrives, and the tap notes the frames of the first and the
// last sound. On a starved host the audio clock falls behind real time; the test measures it from
// TX to RX and skips with the measurement when it fell behind, as rig-tx.spec does, and fails on
// GitHub Actions.
import { expect, test, type Page } from '@playwright/test';
import { chooseOutput, rigOn } from './fake-ic705';
import { connectKx2, installFakeKx2, kx2Ptt, type Kx2Write } from './fake-kx2';
import { prepare, waitForTransmissions } from './txhelp';
import { SLOT_MS } from './tap';

test.describe.configure({ retries: 0 });

const STRICT_AUDIO = process.env.GITHUB_ACTIONS === 'true';
/** How far the audio clock may fall behind the page's clock during one keying, s. */
const MAX_LAG_S = 0.25;

function requireRealTimeAudio(on: Kx2Write, off: Kx2Write) {
  const spanS = (off.at - on.at) / 1000;
  const lagS = spanS - (off.ctxS! - on.ctxS!);
  test.info().annotations.push({ type: 'audio-clock', description: `${lagS.toFixed(3)} s behind in ${spanS.toFixed(1)} s` });
  const message = `Host overloaded: the audio clock fell ${lagS.toFixed(2)} s behind in ${spanS.toFixed(1)} s. rig-kx2-tx.spec needs real-time audio.`;
  test.skip(!STRICT_AUDIO && lagS > MAX_LAG_S, message);
  expect(lagS, message).toBeLessThanOrEqual(MAX_LAG_S);
}

async function startAudio(page: Page) {
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

/** Waits for an odd FT8 slot 3 to 12 s old: a CQ tapped then goes out at the next, even, slot on time. */
async function waitForOddSlot(page: Page) {
  for (;;) {
    const now = Date.now();
    const odd = Math.floor(now / SLOT_MS) % 2 === 1;
    const phase = now % SLOT_MS;
    if (odd && phase >= 3000 && phase <= 12_000) return;
    await page.waitForTimeout(odd && phase < 3000 ? 3000 - phase : 500);
  }
}

test('a CQ sends no TX with Key the radio with CAT off; on, TX goes before the audio and RX after it, and Halt sends RX at once', async ({ page }) => {
  test.setTimeout(180_000);
  await installFakeKx2(page);
  const dock = await prepare(page);
  await connectKx2(page);
  // DATA A, as the band sheet sets it.
  await page.evaluate(() => {
    window.__kx2.mode = 6;
    window.__kx2.sub = 0;
  });
  await startAudio(page);

  // Off: the audio plays and nothing keys the radio by CAT.
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  const [first] = await waitForTransmissions(page, 1, 30_000);
  expect(first.endS - first.startS).toBeGreaterThan(12);
  expect(await kx2Ptt(page)).toEqual([]);
  await dock.getByRole('button', { name: 'Halt' }).click();
  expect(await kx2Ptt(page)).toEqual([]);

  // On: a CQ tapped in the slot before sends TX at the pre-roll, 0.5 s before its audio, which
  // still starts at slot + 0.5 s once TQ1 confirms it, and RX after the audio ends.
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  const keying = page.getByRole('switch', { name: /^Key the radio with CAT/ });
  await keying.click();
  await expect(keying).toBeChecked();
  await expect(page.getByTestId('rig-output')).toHaveText('Key the radio with CAT needs the Tx audio on the radio. Choose the Digirig’s sound card in Settings › Radio and audio › Output. Until then each transmission is refused.');
  // A new output halts, and Halt sends RX while CAT keys the radio: chosen with the switch off.
  await keying.click();
  await chooseOutput(page);
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await rigOn(page);
  await keying.click();
  await expect(keying).toBeChecked();
  await expect(page.getByTestId('rig-output')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/'));
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  const [, second] = await waitForTransmissions(page, 2, 30_000);
  await expect.poll(async () => (await kx2Ptt(page)).length, { timeout: 2000 }).toBe(2);
  const [on, off] = await kx2Ptt(page);
  requireRealTimeAudio(on, off);
  const onBeforeS = second.startS - on.ctxS!;
  const offAfterS = off.ctxS! - second.endS;
  const slot = Math.round((second.startUtc - 500) / SLOT_MS) * SLOT_MS;
  test.info().annotations.push({ type: 'ptt', description: JSON.stringify({ startErrorMs: Math.round(second.startUtc - (slot + 500)), txBeforeAudioMs: Math.round(onBeforeS * 1000), rxAfterAudioMs: Math.round(offAfterS * 1000) }) });
  expect(Math.abs(second.startUtc - (slot + 500))).toBeLessThanOrEqual(150);
  expect(on.text).toBe('TX;TQ;');
  expect(onBeforeS).toBeGreaterThanOrEqual(0.3);
  expect(onBeforeS).toBeLessThanOrEqual(0.7);
  expect(off.text).toBe('RX;TQ;');
  expect(offAfterS).toBeGreaterThanOrEqual(0.05);
  expect(offAfterS).toBeLessThanOrEqual(0.6);
  expect(await page.evaluate(() => window.__kx2.transmit)).toBe(false);

  // The repeated CQ keys at once; Halt 2 s into it sends RX at once.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  expect((await kx2Ptt(page)).map((w) => w.text)).toEqual(['TX;TQ;', 'RX;TQ;', 'TX;TQ;']);
  await dock.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await kx2Ptt(page)).length).toBeGreaterThan(3);
  const haltAt = await page.evaluate(() => window.__haltAt);
  const halted = (await kx2Ptt(page)).slice(3);
  expect(halted.every((w) => w.text === 'RX;TQ;')).toBe(true);
  expect(halted[0].at - haltAt).toBeLessThan(50);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__kx2.transmit)).toBe(false);
  // No VFO A, mode or sub-mode set went out while the radio transmitted.
  expect((await page.evaluate(() => window.__kx2.log)).filter((w) => /^(FA\d|MD\d|DT\d)/.test(w.text))).toEqual([]);
});
