// decode.spec.ts tells a slot that lost audio from one that had all of it (slot-record.ts). Here
// the fake microphone plays fixtures/ft8-loop.wav with 1 s of silence (.fixtures/ft8-loop-hole.wav,
// written by global-setup.ts), and the record of the next full slot must show at least that much
// lost. The app counts those zeros as audio, as it does when the browser's audio thread falls
// behind, so the check reads the recorded audio.
import { expect, test } from '@playwright/test';
import { HOLE_S } from './global-setup';
import { audioLoss, complete, slotRecords } from './slot-record';

test('zero runs of 2 ms or more count as lost audio, and silence at the start as a late start', () => {
  const x = new Float32Array(12_000).fill(0.01);
  x.fill(0, 0, 600); // 0.05 s before audio began
  x.fill(0, 3000, 3023); // 23 samples: below 2 ms, not counted
  x.fill(0, 6000, 7200); // 0.1 s lost
  const loss = audioLoss(x);
  expect(loss.beforeStartS).toBeCloseTo(0.05, 6);
  expect(loss.lostS).toBeCloseTo(0.1, 6);
  expect(complete(loss)).toBe(false);
  expect(complete({ beforeStartS: 0.05, lostS: 0.099 })).toBe(true);
  expect(complete({ beforeStartS: 0.1, lostS: 0 })).toBe(false);
});

test('a slot played with 1 s of silence records at least 1 s of lost audio', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./');
  // Tap 0.2 s before a slot boundary, so the next slot is a full one with the silence inside.
  await page.waitForTimeout((14_800 - (Date.now() % 15_000) + 15_000) % 15_000);
  const next = Date.now() - (Date.now() % 15_000) + 15_000;
  await page.getByRole('button', { name: 'Start audio' }).click();
  const slot = new Date(next).toISOString().slice(11, 19);
  // The app keeps a slot when it ends; its header shows once it has been decoded.
  await expect(page.getByTestId('decode-list').locator('.slot-bar', { hasText: new RegExp(`^${slot} UTC`) })).toBeVisible({ timeout: 45_000 });
  const [record] = await slotRecords(page, [slot]);
  test.info().annotations.push({ type: 'record', description: JSON.stringify(record) });
  expect(record.lostS).toBeGreaterThanOrEqual(HOLE_S[1] - HOLE_S[0] - 0.05);
  expect(complete(record)).toBe(false);
});
