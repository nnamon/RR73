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
  // The bar animates its width over 80 ms, so poll it.
  const bar = meter.locator('b');
  await expect.poll(async () => (await bar.boundingBox())?.width ?? 0).toBeGreaterThan(5);

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

  // Save slot: the first slot is kept at the next slot boundary. Audio that started just before
  // a boundary leaves that slot too short to measure ("started late, 3 % recorded"), so wait,
  // while the sheet lists slots as they are kept, for one with at least 10 % recorded, and save
  // the slot with the most audio.
  const save = page.getByRole('button', { name: 'Save slot' });
  await expect(save).toBeEnabled({ timeout: 25_000 });
  await save.click();
  const sheet = page.getByRole('dialog', { name: 'Save a slot' });
  await expect(sheet).toBeVisible();
  const slotButtons = sheet.getByRole('button', { name: /^Save the slot at/ });
  const recorded = (label: string) => (/complete$/.test(label) ? 100 : Number(/(\d+) % recorded$/.exec(label)?.[1] ?? 0));
  let labels: string[] = [];
  await expect
    .poll(
      async () => {
        labels = await slotButtons.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? ''));
        return Math.max(0, ...labels.map(recorded));
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(10);
  const fullest = labels.reduce((a, b) => (recorded(b) > recorded(a) ? b : a));
  test.info().annotations.push({ type: 'slots', description: JSON.stringify({ listed: labels, saved: fullest }) });
  await sheet.getByRole('button', { name: fullest, exact: true }).click();
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

  // The saved audio holds the tones at their true frequencies and levels after resampling to
  // 12 kHz. A loaded container can drop audio for a moment (the slot then has a zero-filled
  // stretch), so each tone is measured in the cleanest 0.5 s window of the recorded part.
  const filled = sidecar.capture.filled_samples as number;
  expect(filled).toBeGreaterThan(12000);
  const windows: number[] = [];
  for (let at = 180000 - filled + 600; at + 6000 <= 180000; at += 3000) windows.push(at);
  const best = (hz: number) => Math.max(...windows.map((at) => amplitudeAt(wav.samples, 12000, hz, at, 6000)));
  const levels = TONES_HZ.map((hz) => Math.round(20 * Math.log10(best(hz) / 0.05) * 100) / 100);
  const alias = best(ALIAS_AT_HZ);
  test.info().annotations.push({ type: 'wav', description: JSON.stringify({ file: wavDownload.suggestedFilename(), filled, tonesDbRe50mFS: levels, aliasAmplitude: alias }) });
  levels.forEach((db, i) => expect(Math.abs(db), `${TONES_HZ[i]} Hz in the WAV, dB from its input level`).toBeLessThan(1));
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

test('a decoder gone from the server says a new version is ready, waits for audio to stop, then reloads at the next change of screen', async ({ page }) => {
  // A newer build replaced this one on the server: its decoder worker is gone, and index.html names another main script.
  await page.route('**/assets/decoder.worker-*.js', (route) => route.fulfill({ status: 404, body: 'File not found' }));
  await page.route('**/index.html', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-N3wBu1ld.js') });
  });
  await page.goto('./');
  await page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByText('Receiving')).toBeVisible({ timeout: 15_000 });
  const notice = page.getByTestId('status-notice');
  await expect(notice).toContainText('A new version of RR73 is ready. It loads when audio stops.');

  // Audio runs: a change of screen does not reload.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('decoder-status')).toHaveText('Did not load');
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(true);

  // Audio stops when the page is hidden; the next change of screen reloads.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice).toHaveText(/^A new version of RR73 is ready\.\s*Reload$/);
  await Promise.all([page.waitForEvent('load'), nav.getByRole('link', { name: 'Log' }).click()]);
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker ?? false)).toBe(false);
});
