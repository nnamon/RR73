// Audio from a tap to a saved slot, with Chromium's fake microphone playing e2e/.fixtures/tones.wav.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeWav16 } from '../src/lib/slots/wav';
import { ALIAS_AT_HZ, TONES_HZ } from './global-setup';
import { brightness, elementPixels } from './pixels';

test.describe.configure({ mode: 'serial' });

const SHOTS = fileURLToPath(new URL('../test-results/screens', import.meta.url));

/** Peak amplitude of a sine at `hz` in x (Hann-windowed single-bin DFT). */
function amplitudeAt(x: Float32Array, rate: number, hz: number, start: number, length: number): number {
  let re = 0;
  let im = 0;
  let w = 0;
  for (let i = 0; i < length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / length);
    const a = (2 * Math.PI * hz * i) / rate;
    re += h * x[start + i] * Math.cos(a);
    im -= h * x[start + i] * Math.sin(a);
    w += h;
  }
  return (2 * Math.hypot(re, im)) / w;
}

test('audio starts from a tap, the meter moves, the waterfall shows the tones, and a slot saves', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  const meter = page.getByRole('meter', { name: 'Input level' });
  await expect(meter).toHaveAttribute('aria-valuetext', 'No audio');
  await expect(page.getByText('Audio is off')).toBeVisible();

  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 15_000 });

  // The level meter moves off "No audio" and shows a level in dBFS.
  await expect(meter).toHaveAttribute('aria-valuetext', /^−\d+ dBFS$/, { timeout: 10_000 });
  const level = Number(await meter.getAttribute('aria-valuenow'));
  expect(level).toBeGreaterThan(-40);
  expect(level).toBeLessThan(0);
  const bar = meter.locator('b');
  expect((await bar.boundingBox())!.width).toBeGreaterThan(5);

  // The waterfall shows energy at the tone frequencies, and none where the 13 kHz probe would alias.
  await page.waitForTimeout(8000);
  const wf = page.getByTestId('waterfall');
  const px = await elementPixels(page, wf);
  const rows = Math.min(px.height, 60);
  const col = (hz: number) => Math.round((hz / 3000) * px.width);
  const at = (hz: number) => brightness(px, col(hz) - 1, col(hz) + 1, 2, rows);
  const quiet = [450, 1000, 1600, 2250].map((hz) => brightness(px, col(hz) - 1, col(hz) + 1, 2, rows));
  const background = Math.max(...quiet);
  const report = { background, tones: TONES_HZ.map((hz) => [hz, Math.round(at(hz))]), alias: Math.round(at(ALIAS_AT_HZ)), level };
  test.info().annotations.push({ type: 'waterfall', description: JSON.stringify(report) });
  for (const hz of TONES_HZ) expect(at(hz), `${hz} Hz`).toBeGreaterThan(background * 2.5);
  expect(at(ALIAS_AT_HZ)).toBeLessThan(at(TONES_HZ[1]) / 2.5);
  await page.screenshot({ path: `${SHOTS}/mic-chromium-light-operate-running.png` });

  // Save slot: the first slot is kept at the next slot boundary.
  const save = page.getByRole('button', { name: 'Save slot' });
  await expect(save).toBeEnabled({ timeout: 25_000 });
  await save.click();
  const sheet = page.getByRole('dialog', { name: 'Save a slot' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /^Save the slot at/ }).first().click();
  await expect(sheet.getByText('This browser cannot share files. Download both files below.')).toBeVisible();

  const wavLink = sheet.getByRole('link', { name: /^Download \d{6}_\d{6}\.wav$/ });
  const [wavDownload] = await Promise.all([page.waitForEvent('download'), wavLink.click()]);
  expect(wavDownload.suggestedFilename()).toMatch(/^\d{6}_\d{6}\.wav$/);
  const wav = decodeWav16(readFileSync((await wavDownload.path())!));
  expect(wav).toMatchObject({ sampleRate: 12000, channels: 1, bitsPerSample: 16, frames: 180000 });

  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('link', { name: /\.json$/ }).click()]);
  const sidecar = JSON.parse(readFileSync((await jsonDownload.path())!, 'utf8'));
  expect(sidecar).toMatchObject({ format: 'rr73-slot/1', mode: 'FT8', sample_rate: 12000, dial_hz: 14074000, source: { kind: 'kx2' }, timing: { reference: 'phone' } });
  expect(jsonDownload.suggestedFilename()).toBe(wavDownload.suggestedFilename().replace('.wav', '.json'));
  expect(sidecar.start_utc).toMatch(/:(00|15|30|45)Z$/);

  // The saved audio holds the tones at their true frequencies after resampling to 12 kHz.
  const filled = sidecar.capture.filled_samples as number;
  expect(filled).toBeGreaterThan(12000);
  const start = 180000 - filled + 600;
  const len = Math.min(12000, filled - 1200);
  for (const hz of TONES_HZ) {
    const a = amplitudeAt(wav.samples, 12000, hz, start, len);
    expect(20 * Math.log10(a / 0.05), `${hz} Hz in the WAV`).toBeGreaterThan(-3);
  }
  const levels = TONES_HZ.map((hz) => Math.round(20 * Math.log10(amplitudeAt(wav.samples, 12000, hz, start, len) / 0.05) * 10) / 10);
  const alias = amplitudeAt(wav.samples, 12000, ALIAS_AT_HZ, start, len);
  test.info().annotations.push({ type: 'wav', description: JSON.stringify({ file: wavDownload.suggestedFilename(), filled, tonesDbRe50mFS: levels, aliasAmplitude: alias }) });
  expect(alias).toBeLessThan(0.05 / 100);
  await page.screenshot({ path: `${SHOTS}/mic-chromium-light-save-slot.png` });
});

test('a hidden page stops audio, says when, and a tap resumes it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  // iOS stops the microphone in the background; RR73 stops capture when the page is hidden.
  const before = await page.evaluate(() => Date.now());
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const banner = page.getByRole('status').filter({ hasText: 'Audio stopped at' });
  await expect(banner).toBeVisible();
  const text = (await banner.locator('.t').textContent())!;
  const m = /^Audio stopped at (\d\d):(\d\d):(\d\d)$/.exec(text);
  expect(m).not.toBeNull();
  const d = new Date(before);
  const stopped = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m![1]), Number(m![2]), Number(m![3]));
  expect(Math.abs(stopped - before)).toBeLessThan(2000);
  await expect(banner).toContainText('RR73 left the screen');
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', 'No audio');
  await expect(page.getByText(/^No audio since \d\d:\d\d:\d\d$/)).toBeVisible();

  // Visible again: still stopped until a tap.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1000);
  await expect(banner).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mic-chromium-light-audio-stopped.png` });

  await banner.getByRole('button', { name: 'Resume audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('meter', { name: 'Input level' })).toHaveAttribute('aria-valuetext', /dBFS$/, { timeout: 10_000 });
});
