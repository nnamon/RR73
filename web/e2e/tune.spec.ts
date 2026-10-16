// Transmit safety: nothing reaches the output except Tune, Tune starts on the first tap and
// counts down, and Halt stops the tone at once. Web Audio is instrumented in the page to record what reaches the
// destination.
import { expect, test, type Page } from '@playwright/test';
import { connect, installFakeIc705 } from './fake-ic705';

declare global {
  interface Window {
    __audioLog: { t: number; what: string }[];
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__audioLog = [];
    const log = (what: string) => window.__audioLog.push({ t: performance.now(), what });
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, dest: AudioNode | AudioParam, ...rest: number[]) {
      if (dest instanceof AudioDestinationNode) log(`connect ${this.constructor.name} -> destination`);
      else if (dest instanceof AudioNode) log(`connect ${this.constructor.name} -> ${dest.constructor.name}`);
      return (connect as (...a: unknown[]) => AudioNode).call(this, dest, ...rest);
    } as typeof AudioNode.prototype.connect;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, when?: number) {
      log(`start ${this.frequency.value} Hz`);
      return start.call(this, when);
    };
    const stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.stop = function (this: OscillatorNode, when?: number) {
      log(`stop in ${Math.round(((when ?? this.context.currentTime) - this.context.currentTime) * 1000)} ms`);
      return stop.call(this, when);
    };
  });
}

const log = (page: Page) => page.evaluate(() => window.__audioLog.map((e) => e.what));

/**
 * True for a stop scheduled at most 5 ms ahead. A negative delay means the time was already past
 * when read back, as the audio clock moves between reads: the oscillator stops at once.
 */
function stopsAtOnce(entry: string | undefined): boolean {
  const m = /^stop in (-?\d+) ms$/.exec(entry ?? '');
  return !!m && Number(m[1]) <= 5;
}

test('Tune starts on the first tap, counts down, and Halt stops the tone at once', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  // Nothing plays before the tap.
  expect(await log(page)).toEqual([]);
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toContainText('1500 Hz on 14.074 MHz');
  await expect(sheet.getByRole('timer')).toHaveText(/^(10|9) s$/);
  expect(await log(page)).toEqual([
    'connect OscillatorNode -> GainNode',
    'connect GainNode -> destination',
    'start 1500 Hz',
    // Scheduled 10 s after the start; the audio clock may move a few ms while the tone is set up.
    expect.stringMatching(/^stop in (99[5-9]\d|100\d\d) ms$/),
  ]);

  // Halt is the largest control on the sheet.
  const halt = sheet.getByRole('button', { name: 'Halt' });
  const haltBox = (await halt.boundingBox())!;
  for (const b of await sheet.getByRole('button').all()) {
    const box = (await b.boundingBox())!;
    expect(haltBox.width * haltBox.height).toBeGreaterThanOrEqual(box.width * box.height);
  }

  await page.waitForTimeout(1200);
  await expect(sheet.getByRole('timer')).toHaveText(/^(9|8) s$/);
  await halt.click();
  const after = await log(page);
  expect(stopsAtOnce(after.at(-1)), after.at(-1)).toBe(true);
  await expect(sheet).toBeHidden();
  // No other node ever reached the output.
  expect(after.filter((w) => w.includes('-> destination'))).toEqual(['connect GainNode -> destination']);
});

test('a tap outside the Tune sheet closes it and halts', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect(page.getByRole('dialog', { name: 'Tuning' })).toBeVisible();
  await page.mouse.click(200, 20);
  expect(stopsAtOnce((await log(page)).at(-1)), (await log(page)).at(-1)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Tuning' })).toBeHidden();
});

test('Tune stops by itself after 10 s', async ({ page }) => {
  // The page clock runs the wall-clock stop, 10 s and 320 ms after the start
  // (lib/audio/output.ts), without waiting for it.
  await page.clock.install();
  await instrument(page);
  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await page.clock.runFor(9_500);
  await expect(sheet).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/Not checked at \d\d:\d\d: receive audio was off\./)).toBeVisible();
});

test('Escape closes the Tune sheet and halts', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  await expect(page.getByRole('dialog', { name: 'Tuning' })).toBeVisible();
  await page.keyboard.press('Escape');
  // The halt happens in the same task as the key press.
  expect(stopsAtOnce((await log(page)).at(-1)), (await log(page)).at(-1)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Tuning' })).toBeHidden();
});

test('Tune transmits at the Tx frequency set on the waterfall', async ({ page }) => {
  await instrument(page);
  await page.goto('./#/operate');
  const wf = (await page.getByTestId('waterfall').boundingBox())!;
  await page.mouse.click(Math.round(wf.x + (wf.width * 1846) / 3000), Math.round(wf.y + wf.height / 2));
  const hz = Number(await page.getByRole('slider', { name: 'Transmit frequency, Hz' }).inputValue());
  expect(Math.abs(hz - 1846)).toBeLessThanOrEqual(10);
  await page.waitForTimeout(300);

  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toContainText(`${hz} Hz on 14.074 MHz`);
  expect(await log(page)).toContain(`start ${hz} Hz`);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();
});

test('Tune names the dial the radio reports while rig control reads one, on any band', async ({ page }) => {
  await installFakeIc705(page, { hz: 14_076_000 });
  await page.goto('./');
  await connect(page);
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  const tune = page.getByRole('button', { name: /^Tune for 10 s/ });
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await tune.click();
  await expect(sheet).toContainText('1500 Hz on 14.076 MHz');
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();

  // 4m is outside RR73's bands: the band stays 20m, and Tune goes out on the radio's dial.
  await page.evaluate(() => window.__rig.turnDial(70_100_000));
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-dial')).toContainText('70.100');
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await tune.click();
  await expect(sheet).toContainText('1500 Hz on 70.100 MHz');
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();
});
