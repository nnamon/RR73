// decode.spec.ts tells a slot that lost audio from one that had all of it (slot-record.ts). Here
// the fake microphone plays fixtures/ft8-loop.wav with 1 s of silence (.fixtures/ft8-loop-hole.wav,
// written by global-setup.ts), and the record of the next full slot must show at least that much
// lost. The app counts those zeros as audio, as it does when the browser's audio thread falls
// behind, so the check reads the recorded audio. It checks the test's own measure, which CI does
// not need: there decode.spec fails on any missed message, starved slot or not. It runs with
// RR73_REVIEW=1 (docs/testing.md).
import { expect, test } from '@playwright/test';
import { HOLE_S } from './global-setup';
import { complete, slotRecords } from './slot-record';

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
