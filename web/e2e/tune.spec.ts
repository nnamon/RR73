// Transmit safety: nothing reaches the output except Tune, Tune starts on the first tap and
// counts down, and Halt stops the tone at once. Web Audio is instrumented in the page to record what reaches the
// destination.
import { expect, test, type Page } from '@playwright/test';

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
  test.setTimeout(30_000);
  await instrument(page);
  await page.goto('./#/settings/radio');
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toBeHidden({ timeout: 13_000 });
  await expect(page.getByText(/Not checked at \d\d:\d\d: receive audio was off during Tune/)).toBeVisible();
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
  await expect(page.getByRole('button', { name: /^Tune for 10 s/ })).toContainText(`Transmits at ${hz} Hz for 10 s`);
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toContainText(`${hz} Hz on 14.074 MHz`);
  expect(await log(page)).toContain(`start ${hz} Hz`);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();
});
