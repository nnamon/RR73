// Settings › Radio and audio › Timing, with Chromium's fake microphone. Decodes arrive through the
// test hooks (src/lib/testing/e2e-hooks.ts), so the median DT, the input offset and the heard-back
// DT are known.
import { expect, test } from '@playwright/test';

test('Timing shows the clock, the median DT, the input offset and your Tx heard back, and copies a report', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./#/settings/radio');
  await expect(page.getByTestId('timing-source')).toHaveText('Unknown until audio starts');
  await expect(page.getByTestId('timing-median')).toHaveText('Waiting for strong decodes');
  await expect(page.getByTestId('timing-heard')).toHaveText('Shows after you transmit');

  await page.getByRole('button', { name: 'Start audio' }).click();
  // Chromium gives usable output timestamps.
  await expect(page.getByTestId('timing-source')).toHaveText('Output timestamps', { timeout: 15_000 });
  await expect(page.getByTestId('timing-lag')).toHaveText(/^\d+ ms$/);
  const lagMs = Number((await page.getByTestId('timing-lag').textContent())!.replace(' ms', ''));
  expect(lagMs).toBeLessThan(50);
  await expect(page.getByTestId('timing-drift')).toHaveText('Measured after 1 minute of audio');
  await expect(page.getByTestId('timing-gaps')).toHaveText(/^(None since audio started|\d+ gaps?, \d+ ms in total)$/);

  // 10 decodes at −5 dB read DT −0.80 s; 2 at −15 dB read +1.5 s and do not count.
  await page.evaluate(() => {
    const slot = Math.floor(Date.now() / 15000) * 15000 - 15000;
    const d = (dt_s: number, snr_db: number, i: number) => ({ text: `CQ K${i}ABC FN42`, freq_hz: 500 + i * 100, dt_s, snr_db });
    window.__rr73!.decoded(slot, [...Array.from({ length: 10 }, (_, i) => d(-0.8 + ((i % 3) - 1) * 0.05, -5, i)), d(1.5, -15, 11), d(1.5, -18, 12)]);
  });
  await expect(page.getByTestId('timing-median')).toHaveText('−0.80 s from 10 decodes');
  // Steps toward +0.80 s are the largest allowed, 0.08 s, one per decoded slot: a slot that ends
  // while the test runs takes a second one.
  await expect(page.getByTestId('timing-offset')).toHaveText(/^\+0\.(08|16) s on receive audio$/);

  // A transmission that did not come back, then one that did.
  const heard = page.getByTestId('timing-heard');
  await page.evaluate(() => window.__rr73!.heardBack(Date.UTC(2026, 9, 13, 13, 35, 0), 'CQ N0CALL EM12', 1200, []));
  await expect(heard).toHaveText('Not heard back in the last transmission');
  await page.evaluate(() =>
    window.__rr73!.heardBack(Date.UTC(2026, 9, 13, 13, 35, 30), 'CQ N0CALL EM12', 1200, [{ text: 'CQ N0CALL EM12', freq_hz: 1200, dt_s: -0.7, snr_db: 24 }]),
  );
  await expect(heard).toHaveText('DT −0.70 s at 13:35:30 UTC, 24 dB');

  // A stop and a fresh start leave a resume record with the mapping offset before and after. The
  // offset is negative when the audio clock's mapping runs early, as on a loaded host; the app
  // writes the minus as U+2212 (signed() in src/lib/clock/format.ts).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByTestId('timing-source')).toHaveText('Output timestamps', { timeout: 15_000 });
  await expect(page.getByTestId('timing')).toContainText(/\d\d:\d\d:\d\d to \d\d:\d\d:\d\d UTC: offset \u2212?\d+ ms before, \u2212?\d+ ms after/);

  await page.getByRole('button', { name: 'Copy timing report' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toMatch(/^RR73 \d+\.\d+\.\d+ \(\w+\) timing report, \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
  expect(report).toContain('Clock source: output timestamps');
  expect(report).toMatch(/\nAudio gaps bridged: \d+, \d+\.\d ms\n/);
  expect(report).toMatch(/Input offset: 0\.(080|160|240|320) s/);
  expect(report).toContain('Median DT: −0.800 s from 10 decodes at -10 dB or stronger');
  expect(report).toContain('13:35:30 CQ N0CALL EM12: DT −0.70 s, SNR 24 dB');
  expect(report).toMatch(/Clock readings \(contextTime s, performanceTime ms, perfNow ms, dateNow ms, currentTime s\):\n {2}\d+\.\d{6} \d+\.\d{3}/);
});
