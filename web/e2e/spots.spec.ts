// Spots with POTA spots on: the list from the POTA stand-in, the log's badges, Go to a spot, and
// the chased station's reference in Operate's decode list. No request leaves for the real sources
// (spot-sources.ts).
import { expect, test, type Page } from '@playwright/test';
import { emptySeed, seed, withFeatures } from './log-data';
import { stubSpotSources } from './spot-sources';
import { FIXED_TIME } from './time';

const spotRow = (page: Page, call: string) => page.locator('li.spot').filter({ has: page.locator('.call', { hasText: new RegExp(`^${call.replace('/', '\\/')}$`) }) });

test('POTA spots: the list, Go to a spot on 80m, and the station marked in the decode list', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('./');
  await seed(page, withFeatures(emptySeed(), { potaSpots: true }));
  const stand = await stubSpotSources(page);
  await page.goto('./#/spots');

  // FT8 and FT4 activation spots, newest first; an empty log makes every park new; QRT stays QRT.
  await expect(page.locator('li.spot .call')).toHaveText(['JE1QEV', 'KC5JEC', 'JL1VNI/P']);
  await expect(spotRow(page, 'KC5JEC').locator('.badge')).toHaveText('New park');
  await expect(spotRow(page, 'JL1VNI/P').locator('.badge')).toHaveText('QRT');
  await expect(spotRow(page, 'KC5JEC').locator('.age')).toHaveText('4 min');
  await expect(page.getByText(/^Updated 13:14 UTC$/)).toBeVisible();
  expect(stand.requests).toEqual({ pota: 1, hamqth: 0 });

  // 70 cm has no FT8 dial in RR73: its spot opens without Go.
  await spotRow(page, 'JE1QEV').locator('button.pick').click();
  await expect(spotRow(page, 'JE1QEV').locator('.by')).toContainText('Spotted by');
  await expect(page.getByRole('button', { name: /^Go to / })).toHaveCount(0);

  await spotRow(page, 'KC5JEC').locator('button.pick').click();
  await page.getByRole('button', { name: 'Go to KC5JEC' }).click();
  await expect(page).toHaveURL(/#\/operate$/);
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: '80m' })).toBeChecked();
  await expect(sheet.getByRole('radio', { name: 'FT8' })).toBeChecked();
  await expect(sheet.getByTestId('ft-dial')).toHaveValue('3.573');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^Change band/ })).toContainText('80m');

  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate(() => {
    const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
    window.__rr73!.decoded(slot, [
      { text: 'CQ POTA KC5JEC DM56', freq_hz: 1418, dt_s: 0.1, snr_db: -12 },
      { text: 'CQ JA1XYZ PM95', freq_hz: 900, dt_s: 0.1, snr_db: -9 },
    ]);
  });
  const chased = page.locator('button.dr', { hasText: 'CQ POTA KC5JEC DM56' });
  await expect(chased.getByTestId('chase-tag')).toHaveText('US-11782');
  await expect(chased).toHaveAccessibleName(/spotted, POTA US-11782/);
  await expect(page.locator('button.dr', { hasText: 'CQ JA1XYZ PM95' }).getByTestId('chase-tag')).toHaveCount(0);
});
