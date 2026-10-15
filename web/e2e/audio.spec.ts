// Audio from a tap to a saved slot, with Chromium's fake microphone playing e2e/.fixtures/tones.wav,
// and the waterfall's colours: the palette chosen in Settings › Radio and audio redraws the
// waterfall at once, rows drawn before included, and stays chosen after a reload.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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
  // No slot is kept before audio starts.
  await expect(page.getByRole('button', { name: 'Save slot' })).toBeDisabled();

  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });

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
  // The newest 6 s of rows: audio has run for all of them. With the colour map steepened in 0.9.2,
  // noise peaks show navy to cyan, brighter still here at 1 px per 7.6 Hz, where each pixel takes
  // the strongest of its 2 or 3 bins; the tones are checked for near white as well.
  const rows = Math.max(4, Math.floor((px.height * 6) / 45));
  const col = (hz: number) => Math.round((hz / 3000) * px.width);
  const at = (hz: number) => brightness(px, col(hz) - 1, col(hz) + 1, 2, rows);
  const quiet = [450, 1000, 1600, 2250].map((hz) => brightness(px, col(hz) - 1, col(hz) + 1, 2, rows));
  const background = Math.max(...quiet);
  const report = { background, tones: TONES_HZ.map((hz) => [hz, Math.round(at(hz))]), alias: Math.round(at(ALIAS_AT_HZ)), level };
  test.info().annotations.push({ type: 'waterfall', description: JSON.stringify(report) });
  await page.screenshot({ path: `${SHOTS}/mic-chromium-light-operate-running.png` });
  for (const hz of TONES_HZ) {
    expect(at(hz), `${hz} Hz`).toBeGreaterThan(background * 1.5);
    expect(at(hz), `${hz} Hz`).toBeGreaterThan(600);
  }
  expect(at(ALIAS_AT_HZ)).toBeLessThan(at(TONES_HZ[1]) / 1.5);

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

  // The sheet passes axe (WCAG 2.2 AA) in both themes, with its slots and download links.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate((t) => window.__rr73!.theme(t), colorScheme);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${colorScheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
});

test('a hidden page stops audio, says when, and a tap resumes it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
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
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });
  const notice = page.getByTestId('status-notice');
  await expect(notice).toContainText('A new version of RR73 is ready. It loads when audio stops.');

  // Audio runs: a change of screen does not reload.
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Radio and audio/ }).click();
  await expect(page.getByTestId('decoder-status')).toHaveText('Did not load');
  await page.getByRole('link', { name: 'Settings' }).click();
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(true);

  // Audio stops when the page is hidden; the next change of screen reloads.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(notice).toHaveText(/^A new version of RR73 is ready\.\s*Reload$/);
  await Promise.all([page.waitForEvent('load'), page.getByRole('link', { name: 'Operate' }).click()]);
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker ?? false)).toBe(false);
});

/**
 * Mean red, green and blue over the top 40 % of the picture from 2100 to 2450 Hz, clear of the
 * test tones, the Tx and Rx markers and the labels; the largest difference between two channels of
 * one pixel there; and the share of pixels drawn from audio.
 */
async function picture(page: Page) {
  const px = await elementPixels(page, page.getByTestId('waterfall'));
  const [x0, x1] = [2100, 2450].map((hz) => Math.round((hz / 3000) * px.width));
  const rows = Math.round(px.height * 0.4);
  const sum = [0, 0, 0];
  let spread = 0;
  let n = 0;
  for (let y = 2; y < rows; y++)
    for (let x = x0; x <= x1; x++) {
      const o = (y * px.width + x) * 4;
      const c = [px.data[o], px.data[o + 1], px.data[o + 2]];
      // Rows from before audio started are blank, in the background colour of every palette.
      if (c[0] === 4 && c[1] === 6 && c[2] === 10) continue;
      c.forEach((v, k) => (sum[k] += v));
      spread = Math.max(spread, Math.max(...c) - Math.min(...c));
      n++;
    }
  const [r, g, b] = sum.map((v) => v / n);
  return { r, g, b, spread, drawn: n / ((rows - 2) * (x1 - x0 + 1)) };
}

async function choose(page: Page, label: string) {
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  const group = page.getByRole('radiogroup', { name: 'Waterfall colours' });
  await group.getByText(label, { exact: true }).click();
  await expect(group.getByRole('radio', { name: label })).toBeChecked();
  await page.evaluate(() => (location.hash = '#/operate'));
  await expect(page.getByTestId('waterfall')).toBeVisible();
}

test('the waterfall takes the colours chosen in Settings at once, rows drawn before included', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(6000);

  // RR73: navy noise with cyan peaks, more green than red.
  const rr73 = await picture(page);
  expect(rr73.drawn).toBeGreaterThan(0.1);
  expect(rr73.g).toBeGreaterThan(rr73.r + 8);
  expect(rr73.b).toBeGreaterThan(rr73.r + 20);

  // Grey: every pixel neutral, rows from before the change included.
  await choose(page, 'Grey');
  const grey = await picture(page);
  expect(grey.spread).toBeLessThanOrEqual(3);
  expect(grey.r).toBeGreaterThan(10);

  // Fire: violet noise, more red than green.
  await choose(page, 'Fire');
  const fire = await picture(page);
  expect(fire.r).toBeGreaterThan(fire.g + 15);
  expect(fire.r).toBeGreaterThan(rr73.r + 15);

  // The choice is stored.
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(page.getByRole('radiogroup', { name: 'Waterfall colours' }).getByRole('radio', { name: 'Fire' })).toBeChecked();
});
