// Settings › Radio and audio › Timing, with Chromium's fake microphone. Decodes arrive through the
// test hooks (src/lib/testing/e2e-hooks.ts), so the median DT, the input offset and the heard-back
// DT are known.
import { expect, test } from '@playwright/test';

// Playwright's Desktop Chrome reports Windows already; the clock advice names Windows Settings there.
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

test('Timing shows the clock, the median DT, the input offset and your Tx heard back, and copies a report', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./#/settings/radio');
  await expect(page.getByTestId('timing-source')).toHaveText('Unknown until audio starts');
  await expect(page.getByTestId('timing-median')).toHaveText('Waiting for strong decodes');
  await expect(page.getByTestId('timing-clock')).toHaveText('Waiting for strong decodes');
  await expect(page.getByTestId('timing-heard')).toHaveText('Shows after you transmit');
  await expect(page.getByTestId('timing-decode')).toHaveText('Shows after the first slot');
  await expect(page.getByTestId('timing-skipped')).toHaveText('None since the app opened');

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
  // DTs 0.8 s early: the clock runs 0.8 s slow, short of the warning.
  await expect(page.getByTestId('timing-clock')).toHaveText('0.8 s slow by the decodes');
  await expect(page.getByTestId('timing-clock-foot')).toHaveCount(0);
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
  await page.evaluate(() => window.__rr73!.suspendAudio());
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
  expect(report).toContain('Computer clock by the decodes: 0.800 s slow');
  expect(report).toContain('13:35:30 CQ N0CALL EM12: DT −0.70 s, SNR 24 dB');
  expect(report).toMatch(/\nDecode time per slot:\n( {2}none yet| {2}FT8: last \d+ ms, 95th percentile \d+ ms over \d+ slots?)\n/);
  expect(report).toMatch(/\nSlots not decoded, the decoder busy: \d+\n/);
  expect(report).toMatch(/Clock readings \(contextTime s, performanceTime ms, perfNow ms, dateNow ms, currentTime s\):\n {2}\d+\.\d{6} \d+\.\d{3}/);
});

test.describe('on Windows', () => {
  test.use({ userAgent: WINDOWS_UA });

  test('a clock 1 s or more off brings a Clock badge and a notice, and Timing says to sync it in Windows Settings', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => !!window.__rr73);
    // 10 strong decodes 1.3 s early: the computer's clock runs 1.3 s slow.
    await page.evaluate(() => {
      const slot = Math.floor(Date.now() / 15000) * 15000 - 15000;
      window.__rr73!.decoded(
        slot,
        Array.from({ length: 10 }, (_, i) => ({ text: `CQ K${i}ABC FN42`, freq_hz: 500 + i * 100, dt_s: -1.3 + ((i % 3) - 1) * 0.05, snr_db: -5 })),
      );
    });
    await expect(page.getByRole('region', { name: 'Transmit' }).getByRole('status')).toHaveText('Computer clock 1.3 s slow');
    const badge = page.getByRole('link', { name: 'Computer clock 1.3 s slow. Open Timing' });
    await expect(badge).toHaveText('Clock');
    const box = (await badge.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);

    await badge.click();
    await expect(page).toHaveURL(/#\/settings\/radio\/timing$/);
    await expect(page.getByRole('heading', { name: 'Timing' })).toBeInViewport();
    await expect(page.getByTestId('timing-clock')).toHaveText('1.3 s slow by the decodes');
    await expect(page.getByTestId('timing-clock-foot')).toHaveText(
      'The computer’s clock runs 1.3 s slow by the decodes, so other stations hear you 1.3 s late. In Windows Settings › Time & language › Date & time, turn on Set time automatically and select Sync now. It needs a network.',
    );

    // Decodes on time again: the warning goes once the clock reads under 0.8 s off.
    await page.evaluate(() => {
      const slot = Math.floor(Date.now() / 15000) * 15000;
      window.__rr73!.decoded(slot, Array.from({ length: 30 }, (_, i) => ({ text: `CQ K${i}XYZ FN42`, freq_hz: 400 + i * 50, dt_s: 0.1, snr_db: -5 })));
    });
    await expect(page.getByTestId('timing-clock')).toHaveText(/^0\.\d s (slow|fast) by the decodes$|^On time by the decodes$/);
    await expect(page.getByTestId('timing-clock-foot')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('region', { name: 'Transmit' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Computer clock/ })).toHaveCount(0);
  });
});
