// Rig control's transmissions end to end in Chromium (docs/design/cat.md), with navigator.serial
// replaced by a fake IC-705 (fake-ic705.ts) and the app's output recorded in the page (tap.ts): PTT
// around a CQ with Key the radio with CAT off and on, Halt, Tune, RTTY, audio stopping, a lost
// port, and the dial shift of Keep Tx audio centred around a CQ and Tune. They run in the tx-cq
// project, after the rest of the suite, as the other transmit tests do.
//
// PTT is timed against the audio on the audio clock: the fake radio notes AudioContext.currentTime
// as each frame arrives, and the tap notes the frames of the first and the last sound. Only the
// start of a transmission, mapped as it happens, is checked against UTC.
//
// On a starved host Chromium's fake audio device falls behind real time (measured beside the rest
// of the suite: 12.8 s of audio clock in 14.9 s). The audio then starts late against UTC, and a
// keying's limit, timed by the page's clock, ends PTT and the audio before the audio's end. Each test
// measures the audio clock against the page's clock from PTT on to PTT off, and skips with the
// measurement when it fell behind, as decode.spec does; on GitHub Actions it fails. With that check
// the tests need no retries.
import { expect, test, type Page } from '@playwright/test';
import { connect, installFakeIc705, ptt, rigFrames, rigLog, setKeying } from './fake-ic705';
import { prepare, waitForTransmissions } from './txhelp';
import { decodeCaptured, installTap, SLOT_MS } from './tap';
import { loadWasm } from './wasm';

test.describe.configure({ retries: 0 });

const STRICT_AUDIO = process.env.GITHUB_ACTIONS === 'true';
/** How far the audio clock may fall behind the page's clock during one keying, s. */
const MAX_LAG_S = 0.25;

type Frame = ReturnType<typeof rigFrames>[number];

/**
 * Skips, or fails on GitHub Actions, when the audio clock fell more than MAX_LAG_S behind the page's
 * clock between PTT on and PTT off.
 */
function requireRealTimeAudio(on: Frame, off: Frame) {
  const spanS = (off.at - on.at) / 1000;
  const lagS = spanS - (off.ctxS! - on.ctxS!);
  test.info().annotations.push({ type: 'audio-clock', description: `${lagS.toFixed(3)} s behind in ${spanS.toFixed(1)} s` });
  const message = `Host overloaded: the audio clock fell ${lagS.toFixed(2)} s behind in ${spanS.toFixed(1)} s. rig-tx.spec needs real-time audio.`;
  test.skip(!STRICT_AUDIO && lagS > MAX_LAG_S, message);
  expect(lagS, message).toBeLessThanOrEqual(MAX_LAG_S);
}

/** Starts audio on Operate. */
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

test('a CQ keys no PTT with Key the radio with CAT off; on, PTT goes on before the audio and off after it, and Halt unkeys at once', async ({ page }) => {
  test.setTimeout(180_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await startAudio(page);

  // Off: the audio plays and no PTT goes to the radio.
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  const [first] = await waitForTransmissions(page, 1, 30_000);
  expect(first.endS - first.startS).toBeGreaterThan(12);
  expect(await ptt(page)).toEqual([]);
  await dock.getByRole('button', { name: 'Halt' }).click();
  expect(await ptt(page)).toEqual([]);

  // On: a CQ tapped in the slot before keys the radio at the pre-roll, 0.5 s before its audio,
  // which still starts at slot + 0.5 s, and unkeys after the audio ends.
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  const [, second] = await waitForTransmissions(page, 2, 30_000);
  await expect.poll(async () => (await ptt(page)).length, { timeout: 2000 }).toBe(2);
  const [on, off] = await ptt(page);
  requireRealTimeAudio(on, off);
  const onBeforeS = second.startS - on.ctxS!;
  const offAfterS = off.ctxS! - second.endS;
  const slot = Math.round((second.startUtc - 500) / SLOT_MS) * SLOT_MS;
  test.info().annotations.push({ type: 'ptt', description: JSON.stringify({ startErrorMs: Math.round(second.startUtc - (slot + 500)), onBeforeAudioMs: Math.round(onBeforeS * 1000), offAfterAudioMs: Math.round(offAfterS * 1000) }) });
  // tx-cq.spec holds the start to 50 ms with no radio; here the tap's start wanders further.
  expect(Math.abs(second.startUtc - (slot + 500))).toBeLessThanOrEqual(150);
  // Keyed at the pre-roll; the audio starts 0.1 s or more after the radio's OK, which the fake
  // radio sends 5 ms after PTT on.
  expect(on.body).toBe('1C 00 01');
  expect(onBeforeS).toBeGreaterThanOrEqual(0.3);
  expect(onBeforeS).toBeLessThanOrEqual(0.7);
  // PTT goes off the output latency and 0.1 s after the audio ends.
  expect(off.body).toBe('1C 00 00');
  expect(offAfterS).toBeGreaterThanOrEqual(0.05);
  expect(offAfterS).toBeLessThanOrEqual(0.6);

  // The CQ repeated in the next cycle is decided on the last slot's decodes, after its slot has
  // begun, and keys at once. Halt 2 s into it sends PTT off at once.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  expect((await ptt(page)).map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00', '1C 00 01']);
  await dock.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await ptt(page)).length).toBeGreaterThan(3);
  const haltAt = await page.evaluate(() => window.__haltAt);
  // The transmission's release and Halt's own PTT off may both go out: PTT off only.
  const halted = (await ptt(page)).slice(3);
  expect(halted.every((f) => f.body === '1C 00 00')).toBe(true);
  expect(halted[0].at - haltAt).toBeLessThan(50);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('a lost port during a transmission stops the audio and turns Tx off', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await startAudio(page);
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const pulledS = await page.evaluate(() => {
    window.__rig.unplug();
    return window.__rig.ctx!.currentTime;
  });
  const [cut] = await waitForTransmissions(page, 1, 5000);
  // The audio stopped within a few render quanta of the port going, on the audio clock.
  expect(cut.endS - pulledS).toBeLessThan(0.15);
  expect(cut.endS - cut.startS).toBeLessThan(5);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await expect(dock.getByText('Radio disconnected · Tx off')).toBeVisible();
  // Tx stays off while Key the radio with CAT waits for the radio: a CQ is refused.
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('Radio not connected')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-status')).toHaveText('Port closed');
  await expect(page.getByTestId('rig-help')).toContainText('Tx went off');
});

test('Tune keys no PTT with Key the radio with CAT off; on, it keys the radio before the tone and releases it when the tone ends, and Halt releases it at once', async ({ page }) => {
  test.setTimeout(90_000);
  await installFakeIc705(page);
  await installTap(page);
  // The page's own time of the tap on Halt.
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')?.textContent?.trim() === 'Halt') window.__haltAt = Date.now();
    }, true);
  });
  await page.goto('./');
  await connect(page);
  // Off: the tone plays and no PTT goes to the radio.
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1000);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();
  await waitForTransmissions(page, 1, 5000);
  expect(await ptt(page)).toEqual([]);
  // On: PTT, the radio's OK, the tone 0.1 s later; PTT off the output latency and 0.1 s after it.
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await ptt(page)).map((f) => f.body)).toEqual(['1C 00 01']);
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  const [, tone] = await waitForTransmissions(page, 2, 5000);
  await expect.poll(async () => (await ptt(page)).map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00']);
  const [on, off] = await ptt(page);
  requireRealTimeAudio(on, off);
  test.info().annotations.push({ type: 'tune-ptt', description: JSON.stringify({ onBeforeToneMs: Math.round((tone.startS - on.ctxS!) * 1000), offAfterToneMs: Math.round((off.ctxS! - tone.endS) * 1000) }) });
  expect(tone.endS - tone.startS).toBeGreaterThan(9.9);
  expect(tone.startS - on.ctxS!).toBeGreaterThanOrEqual(0.05);
  expect(tone.startS - on.ctxS!).toBeLessThan(0.5);
  expect(off.ctxS! - tone.endS).toBeGreaterThanOrEqual(0.05);
  expect(off.ctxS! - tone.endS).toBeLessThan(0.6);
  // Again, with Halt 1 s in.
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1000);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await ptt(page)).length).toBe(4);
  const halted = await page.evaluate(() => window.__haltAt);
  const last = (await ptt(page))[3];
  expect(last.body).toBe('1C 00 00');
  expect(last.at - halted).toBeLessThan(100);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('an RTTY transmission keys the radio before the stream and releases it when the stream drains', async ({ page }) => {
  test.setTimeout(90_000);
  await installFakeIc705(page);
  await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await sheet.getByText('RTTY', { exact: true }).click();
  // Choosing RTTY sets the radio to the band's RTTY dial in USB-D.
  await expect.poll(() => page.evaluate(() => [window.__rig.hz, window.__rig.data])).toEqual([14_083_000, 1]);
  // Esc closes the sheet, and as Halt it sends PTT off.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await startAudio(page);
  const n = (await ptt(page)).length;
  const bar = page.getByRole('region', { name: 'Transmit' });
  const field = page.getByTestId('send-field');
  await field.fill('CQ DE 9V1NE K');
  await field.press('Enter');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible({ timeout: 30_000 });
  const [t] = await waitForTransmissions(page, 1, 5000);
  await expect.poll(async () => (await ptt(page)).length).toBe(n + 2);
  const [on, off] = (await ptt(page)).slice(n);
  requireRealTimeAudio(on, off);
  const onBeforeS = t.startS - on.ctxS!;
  const offAfterS = off.ctxS! - t.endS;
  test.info().annotations.push({ type: 'rtty-ptt', description: JSON.stringify({ onBeforeAudioMs: Math.round(onBeforeS * 1000), offAfterAudioMs: Math.round(offAfterS * 1000) }) });
  // The stream starts 0.1 s after the radio's OK.
  expect(on.body).toBe('1C 00 01');
  expect(onBeforeS).toBeGreaterThanOrEqual(0.05);
  expect(onBeforeS).toBeLessThan(0.6);
  // PTT goes off the output latency and 0.1 s after the stream drains.
  expect(off.body).toBe('1C 00 00');
  expect(offAfterS).toBeGreaterThanOrEqual(0.05);
  expect(offAfterS).toBeLessThan(0.6);
});

test('audio stopping during a transmission sends PTT off at once and turns Tx off', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await startAudio(page);
  await waitForOddSlot(page);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const n = (await ptt(page)).length;
  const stoppedAt = await page.evaluate(async () => {
    const at = Date.now();
    await window.__rr73!.suspendAudio();
    return at;
  });
  await expect.poll(async () => (await ptt(page)).length).toBeGreaterThan(n);
  const off = (await ptt(page))[n];
  expect(off.body).toBe('1C 00 00');
  expect(off.at - stoppedAt).toBeLessThan(150);
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

/** Turns Keep Tx audio centred on in Settings › Rig control; Key the radio with CAT must be on. */
async function setShift(page: Page) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  const sw = page.getByRole('switch', { name: /Keep Tx audio centred/ });
  await sw.click();
  await expect(sw).toBeChecked();
}

/** Sets the Tx frequency on Operate's waterfall, Hz. */
async function setTxHz(page: Page, hz: number) {
  await page.evaluate(() => (location.hash = '#/'));
  const slider = page.getByRole('slider', { name: 'Transmit frequency, Hz' });
  await slider.fill(String(hz));
  await expect(slider).toHaveValue(String(hz));
}

/** The dial sets and PTT frames from `from` on. */
const dialAndPtt = async (page: Page, from: number) => rigFrames(await rigLog(page), from).filter((f) => f.body.startsWith('05 ') || f.body === '1C 00 01' || f.body === '1C 00 00');

/** The frequency of a steady tone from its zero crossings, Hz, over its sounding frames (the tap keeps 0.5 s of silence after them). */
function toneHz(t: { samples: Float32Array; frames: number; sampleRate: number }): number {
  let crossings = 0;
  for (let i = 1; i < t.frames; i++) if (t.samples[i - 1] < 0 !== t.samples[i] < 0) crossings++;
  return crossings / 2 / (t.frames / t.sampleRate);
}

const TX_DIAL = '05 00 50 07 14 00';
const RX_DIAL = '05 00 40 07 14 00';

test('with Keep Tx audio centred, a CQ at 2800 Hz sets the dial 1000 Hz up, keys, plays at 1800 Hz on time, unkeys and sets the receive dial back', async ({ page }) => {
  test.setTimeout(150_000);
  await installFakeIc705(page);
  const dock = await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await setShift(page);
  // The fake radio also reports each dial set by transceive: RR73 must keep showing the receive dial.
  await page.evaluate(() => (window.__rig.transceiveSets = true));
  await startAudio(page);
  await setTxHz(page, 2800);
  await waitForOddSlot(page);
  const from = (await rigLog(page)).length;
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  // Mid-transmission the radio is on the Tx dial, and Operate shows the receive dial.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => [window.__rig.hz, window.__rig.transmit])).toEqual([14_075_000, true]);
  await expect(page.getByRole('button', { name: /^Change band/ })).toContainText('14.074');
  const [t] = await waitForTransmissions(page, 1, 20_000);
  await expect.poll(async () => (await dialAndPtt(page, from)).length, { timeout: 3000 }).toBeGreaterThanOrEqual(4);
  const [dial, on, off, back] = await dialAndPtt(page, from);
  expect([dial.body, on.body, off.body, back.body]).toEqual([TX_DIAL, '1C 00 01', '1C 00 00', RX_DIAL]);
  requireRealTimeAudio(on, off);
  const slot = Math.round((t.startUtc - 500) / SLOT_MS) * SLOT_MS;
  const timing = {
    startErrorMs: Math.round(t.startUtc - (slot + 500)),
    dialAfterSlotMs: Math.round(dial.at - slot),
    dialBeforePttMs: Math.round((on.ctxS! - dial.ctxS!) * 1000),
    pttBeforeAudioMs: Math.round((t.startS - on.ctxS!) * 1000),
    offAfterAudioMs: Math.round((off.ctxS! - t.endS) * 1000),
    rxDialAfterOffMs: Math.round((back.ctxS! - off.ctxS!) * 1000),
  };
  test.info().annotations.push({ type: 'shift', description: JSON.stringify(timing) });
  // The dial goes out at the pre-roll, at the slot edge, and PTT on after its OK; the audio still
  // starts at slot + 0.5 s on the audio clock, as without the shift.
  expect(Math.abs(t.startUtc - (slot + 500))).toBeLessThanOrEqual(150);
  expect(dial.ctxS!).toBeLessThan(on.ctxS!);
  expect(timing.dialBeforePttMs).toBeLessThan(100);
  expect(timing.pttBeforeAudioMs).toBeGreaterThanOrEqual(300);
  expect(timing.pttBeforeAudioMs).toBeLessThanOrEqual(700);
  expect(timing.offAfterAudioMs).toBeGreaterThanOrEqual(50);
  expect(timing.offAfterAudioMs).toBeLessThanOrEqual(600);
  // The receive dial goes back after PTT off is confirmed, long before the next slot.
  expect(back.ctxS!).toBeGreaterThan(off.ctxS!);
  expect(timing.rxDialAfterOffMs).toBeLessThan(200);
  // The audio is the CQ at 1800 Hz: on the Tx dial, the same RF as 2800 Hz on the receive dial.
  const decodes = decodeCaptured((await loadWasm())!, t);
  expect(decodes.map((d) => d.text)).toEqual(['CQ 9V1NE OJ11']);
  expect(Math.abs(decodes[0].freq_hz - 1800)).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => [window.__rig.hz, window.__rig.transmit])).toEqual([14_074_000, false]);
  await expect(page.getByRole('button', { name: /^Change band/ })).toContainText('14.074');
  // Halt during the repeated CQ: PTT off at once, then the receive dial.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  const n = (await dialAndPtt(page, from)).length;
  await dock.getByRole('button', { name: 'Halt' }).click();
  // The transmission's release and Halt's own PTT off may both go out, then the receive dial.
  await expect.poll(async () => (await dialAndPtt(page, from)).at(-1)!.body).toBe(RX_DIAL);
  const halted = (await dialAndPtt(page, from)).slice(n);
  expect(halted.slice(0, -1).map((f) => f.body)).toContain('1C 00 00');
  expect(halted.slice(0, -1).every((f) => f.body === '1C 00 00')).toBe(true);
  const haltAt = await page.evaluate(() => window.__haltAt);
  expect(halted[0].at - haltAt).toBeLessThan(50);
  expect(await page.evaluate(() => [window.__rig.hz, window.__rig.transmit])).toEqual([14_074_000, false]);
});

test('with Keep Tx audio centred, Tune at a Tx frequency of 2800 Hz plays 1800 Hz on the dial 1000 Hz up, and Halt unkeys and sets the receive dial back', async ({ page }) => {
  test.setTimeout(90_000);
  await installFakeIc705(page);
  await prepare(page);
  await connect(page);
  await setKeying(page, true);
  await setShift(page);
  await setTxHz(page, 2800);
  const from = (await rigLog(page)).length;
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await dialAndPtt(page, from)).map((f) => f.body)).toEqual([TX_DIAL, '1C 00 01']);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__rig.hz)).toBe(14_075_000);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect.poll(async () => (await dialAndPtt(page, from)).at(-1)!.body).toBe(RX_DIAL);
  const frames = (await dialAndPtt(page, from)).map((f) => f.body);
  expect(frames.slice(0, 3)).toEqual([TX_DIAL, '1C 00 01', '1C 00 00']);
  expect(frames.slice(2, -1).every((b) => b === '1C 00 00')).toBe(true);
  const [tone] = await waitForTransmissions(page, 1, 5000);
  expect(Math.abs(toneHz(tone) - 1800)).toBeLessThan(5);
  expect(await page.evaluate(() => [window.__rig.hz, window.__rig.transmit])).toEqual([14_074_000, false]);
});
