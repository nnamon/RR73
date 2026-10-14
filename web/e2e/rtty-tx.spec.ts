// RTTY's transmit stream in Chromium, with the test tones as the microphone. The keyboard worker
// renders 0.1 s blocks straight to the stream worklet, 0.3 s ahead, while the operator types and
// Operate redraws. The app's output is recorded in the page (tap.ts) and decoded in Node with
// rr73-rtty's own receiver: the text must come back whole and the audio must have no gap. Halt
// must silence the output at once.
import { expect, test, type Page } from '@playwright/test';
import { Resampler } from '../src/lib/audio/resampler';
import { captured, type Captured } from './tap';
import { loadWasm, type Wasm } from './wasm';
import { prepare, waitForTransmissions } from './txhelp';

test.describe.configure({ mode: 'serial' });

/** The received characters of a captured transmission, from rr73-rtty's receiver at the default pair. */
function decodeRtty(wasm: Wasm, t: Captured, markHz: number): string {
  const at12 = new Resampler(t.sampleRate, 12000).process(t.samples);
  const rx = new wasm.RttyReceiver(JSON.stringify({ mark_hz: markHz, squelch_db: null, afc: { track: false } }));
  const events = [...(JSON.parse(rx.push(at12)) as { type: string; ch?: string }[]), ...(JSON.parse(rx.flush()) as { type: string; ch?: string }[])];
  rx.free();
  return events
    .filter((e) => e.type === 'char')
    .map((e) => e.ch)
    .join('');
}

/** The longest run of samples at or near zero inside a transmission, s: a gap in the keying. */
function longestGapS(t: Captured): number {
  let run = 0;
  let longest = 0;
  for (const x of t.samples) {
    if (Math.abs(x) <= 1e-4) run++;
    else {
      longest = Math.max(longest, run);
      run = 0;
    }
  }
  // The run still open at the end is the 0.5 s of silence that closes a capture: not a gap.
  return longest / t.sampleRate;
}

async function toRtty(page: Page) {
  await page.getByRole('button', { name: /^Change band/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await sheet.getByText('RTTY', { exact: true }).click();
  await expect(sheet.getByTestId('rtty-dial')).toHaveValue('14.0830');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

test('RTTY streams typed text to the output without a gap, and Halt stops it at once', async ({ page }) => {
  test.setTimeout(120_000);
  const wasm = await loadWasm();
  await prepare(page);
  await toRtty(page);
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  const bar = page.getByRole('region', { name: 'Transmit' });
  const field = page.getByTestId('send-field');

  // A line typed ahead goes out with Return; more typed on air follows as it is typed.
  await field.fill('CQ CQ DE 9V1NE 9V1NE K');
  await field.press('Enter');
  await expect(bar.getByRole('button', { name: /^Rx in \d+ s$/ })).toBeVisible({ timeout: 5000 });
  await bar.getByRole('button', { name: /^Rx in/ }).click();
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible();
  await field.pressSequentially('RYRY THE QUICK BROWN FOX 0123456789', { delay: 120 });
  await field.press('Enter');
  await bar.getByRole('button', { name: 'On air' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible({ timeout: 30_000 });
  const [first] = await waitForTransmissions(page, 1, 5000);
  const stats = await page.evaluate(() => window.__rr73!.rttyState().lastTx);
  const text = wasm ? decodeRtty(wasm, first, 1585) : '';
  const gapS = longestGapS(first);
  test.info().annotations.push({ type: 'rtty', description: JSON.stringify({ text, seconds: first.frames / first.sampleRate, gapMs: Math.round(gapS * 1000), stats, rate: first.sampleRate }) });
  expect(text.replace(/\r/g, '')).toContain('CQ CQ DE 9V1NE 9V1NE K\nRYRY THE QUICK BROWN FOX 0123456789\n');
  expect(gapS).toBeLessThan(0.002);
  expect(stats?.underrunFrames).toBe(0);
  expect(await page.evaluate(() => window.__tx.length)).toBe(1);

  // Halt 1.5 s into a transmission: silent within 100 ms, the text not yet sent stays.
  await field.fill('TNX FER CALL UR RST 599 599 NAME AMON AMON QTH SINGAPORE SINGAPORE');
  await bar.getByRole('button', { name: 'Tx off' }).click();
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible();
  await page.waitForTimeout(1500);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  const all = await waitForTransmissions(page, 2, 5000);
  const second = all[1];
  const haltAt = await page.evaluate(() => window.__haltAt);
  const stopMs = second.endUtc - haltAt;
  const sentMs = (second.frames / second.sampleRate) * 1000;
  test.info().annotations.push({ type: 'halt', description: JSON.stringify({ heardEndAfterTapMs: Math.round(stopMs), sentMs: Math.round(sentMs) }) });
  expect(stopMs).toBeLessThan(100);
  expect(sentMs).toBeLessThan(2500);
  const left = await page.evaluate(() => window.__rr73!.rttyState().field);
  expect(left.length).toBeGreaterThan(30);
  expect('TNX FER CALL UR RST 599 599 NAME AMON AMON QTH SINGAPORE SINGAPORE'.endsWith(left)).toBe(true);
  await page.waitForTimeout(800);
  expect((await captured(page)).length).toBe(2);
});
