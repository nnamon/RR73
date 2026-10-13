// The start chime: Start audio plays a clip through a media element inside the tap, which stops iOS
// muting output on the silent switch, and the keying check compares receive audio before and
// during the chime. Chromium's fake microphone does not drop when the chime plays, so the check
// reports a failure here, in plain words.
import { expect, test, type Page } from '@playwright/test';

interface Clip {
  seconds: number;
  at: number;
}

/** Records every media element play() with the clip length decoded from its WAV data URI. */
async function recordClips(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __clips: { seconds: number; at: number }[] };
    w.__clips = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.getAttribute('src') ?? '';
      const bytes = Math.floor((src.length - src.indexOf(',') - 1) * 0.75);
      w.__clips.push({ seconds: (bytes - 44) / 2 / 12000, at: performance.now() });
      return play.call(this);
    };
  });
}

const clips = (page: Page) => page.evaluate(() => (window as unknown as { __clips: Clip[] }).__clips);

test('Start audio plays the start chime inside the tap and reports the keying check', async ({ page }) => {
  await recordClips(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start audio' }).click();
  const played = await clips(page);
  expect(played).toHaveLength(1);
  // 1.5 s lead, 0.45 s chime, 0.2 s tail.
  expect(played[0].seconds).toBeCloseTo(2.15, 2);
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(page.getByText(/Failed at \d\d:\d\d: receive audio did not drop\./)).toBeVisible({ timeout: 10_000 });
});

test('with the start chime off, Start audio plays only silence and runs no keying check', async ({ page }) => {
  await recordClips(page);
  await page.goto('./#/settings/radio');
  const toggle = page.getByRole('checkbox', { name: /Start chime/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.evaluate(() => (location.hash = '#/'));
  await page.getByRole('button', { name: 'Start audio' }).click();
  const played = await clips(page);
  expect(played).toHaveLength(1);
  expect(played[0].seconds).toBeCloseTo(0.1, 2);
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  await expect(page.getByText(/Not checked yet/)).toBeVisible();
});
