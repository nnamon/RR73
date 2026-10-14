// Calling CQ end to end in Chromium, with the test tones as the microphone so nobody answers.
// The app's output is recorded in the page (tap.ts) and decoded in Node with the app's own decoder.
import { expect, test } from '@playwright/test';
import { decodeCaptured, slotOf, SLOT_MS } from './tap';
import { loadWasm } from './wasm';
import { prepare, startError, waitForSlotPhase, waitForTransmissions } from './txhelp';

test.describe.configure({ mode: 'serial' });

test('Call CQ sends CQ 9V1NE OJ11 at slot + 0.5 s on the Tx frequency, and Halt stops a transmission at once', async ({ page }) => {
  test.setTimeout(150_000);
  const dock = await prepare(page);
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  // Tx near 1846 Hz, set by a tap on the waterfall.
  const wf = (await page.getByTestId('waterfall').boundingBox())!;
  await page.mouse.click(Math.round(wf.x + (wf.width * 1846) / 3000), Math.round(wf.y + wf.height / 2));
  const txHz = Number(await page.getByRole('slider', { name: 'Transmit frequency, Hz' }).inputValue());
  expect(Math.abs(txHz - 1846)).toBeLessThanOrEqual(10);
  // Tapped in the first 4.3 s of an even slot, CQ would start late in it; this test wants a CQ
  // on time, so it taps 5 to 12 s into a slot.
  await waitForSlotPhase(page, 5, 12);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();

  const [first] = await waitForTransmissions(page, 1, 50_000);
  const wasm = (await loadWasm())!;
  const decodes = decodeCaptured(wasm, first);
  const err = startError(first);
  // Length on the audio clock: the UTC times at the two ends carry this container's clock drift.
  const length = (first.frames / first.sampleRate) * 1000;
  test.info().annotations.push({ type: 'cq', description: JSON.stringify({ text: decodes.map((d) => d.text), startErrorMs: Math.round(err * 10) / 10, lengthMs: Math.round(length), rate: first.sampleRate }) });
  expect(decodes.map((d) => d.text)).toEqual(['CQ 9V1NE OJ11']);
  expect(Math.abs(err)).toBeLessThanOrEqual(50);
  expect(Math.abs(length - 12_640)).toBeLessThanOrEqual(20);
  // CQ goes out in the 1st (even) slots by default.
  expect(slotOf(first) % (2 * SLOT_MS)).toBe(0);
  expect(Math.abs(decodes[0].freq_hz - txHz)).toBeLessThanOrEqual(3);

  // The next CQ, 30 s later: Halt 2 s into it.
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  await dock.getByRole('button', { name: 'Halt' }).click();
  const [, second] = await waitForTransmissions(page, 2, 5000);
  const haltAt = await page.evaluate(() => window.__haltAt);
  const stopMs = second.endUtc - haltAt;
  const sentMs = (second.frames / second.sampleRate) * 1000;
  test.info().annotations.push({ type: 'halt', description: JSON.stringify({ heardEndAfterTapMs: Math.round(stopMs), sentMs: Math.round(sentMs) }) });
  expect(sentMs).toBeLessThan(4000);
  expect(stopMs).toBeLessThan(100);
  // Halt ends the CQ and turns Tx off; nothing else went out.
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await page.evaluate(() => window.__tx.length)).toBe(2);
});

