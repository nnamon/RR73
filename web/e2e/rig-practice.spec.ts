// The practice band with a radio connected and Key the radio with CAT on (docs/design/cat.md,
// Safety paths): a practice CQ and Tune send no PTT to the fake IC-705 (fake-ic705.ts), and Test
// keying is off while the practice band is on. Runs in the practice project: the band is made in
// the page and decoded in real time.
import { expect, test } from '@playwright/test';
import { connect, ptt, rigFrames, rigLog, setKeying, installFakeIc705 } from './fake-ic705';
import { loadWasm } from './wasm';

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  // No test reaches a real server.
  const origin = new URL(baseURL!).origin;
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

test('the practice band keys no PTT for a CQ or Tune with Key the radio with CAT on, and Test keying is off', async ({ page }) => {
  test.setTimeout(120_000);
  await installFakeIc705(page);
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await connect(page);
  await setKeying(page, true);
  await expect(page.getByTestId('rig-practice')).toHaveText('The practice band never keys the radio by CAT.');

  await page.evaluate(() => (location.hash = '#/settings/practice'));
  await expect(page.getByTestId('practice-cat')).toHaveText('The practice band never keys the radio by CAT.');
  await expect(page.getByTestId('practice-vox')).toHaveText('Practice transmissions play through the Tx output. A radio there with VOX on transmits them.');
  const on = page.getByRole('switch', { name: /^Practice band/ });
  await on.check();
  await expect(on).toBeChecked();
  // Turning it on stops output first; from here on no PTT frame reaches the radio.
  await page.waitForTimeout(500);
  const from = (await rigLog(page)).length;

  await page.evaluate(() => (location.hash = '#/settings/rig'));
  const test1 = page.getByRole('button', { name: /^Test keying/ });
  await expect(test1).toBeDisabled();
  await expect(page.getByTestId('rig-test-practice')).toHaveText('Off with the practice band on');

  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.locator('header.top .practice')).toHaveText('Practice');
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'CQ' }).click();
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
  // Well into the transmission, after the pre-roll where CAT keying would have sent PTT on.
  await page.waitForTimeout(3000);
  expect(rigFrames(await rigLog(page), from).filter((f) => f.body.startsWith('1C 00 0'))).toEqual([]);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
  await page.getByRole('button', { name: /^Halt/ }).first().click();

  // Tune plays through the Tx output with no PTT.
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  const before = (await rigLog(page)).length;
  await page.getByRole('button', { name: /^Tune for 10 s/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Tuning' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1000);
  expect(rigFrames(await rigLog(page), before).filter((f) => f.body === '1C 00 01')).toEqual([]);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
  await sheet.getByRole('button', { name: 'Halt' }).click();
  await expect(sheet).toBeHidden();

  // Nothing in the whole test keyed the radio.
  expect((await ptt(page)).filter((f) => f.body === '1C 00 01')).toEqual([]);
});
