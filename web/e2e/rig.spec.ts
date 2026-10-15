// Rig control end to end in Chromium (docs/design/cat.md), with navigator.serial replaced by a fake
// IC-705 (fake-ic705.ts): connecting, the dial read from the radio, a band change setting the radio,
// the radio's dial followed, opening again after a reload, and Test keying with a radio that answers
// and one that keeps transmitting. The transmissions, timed against the audio, are in rig-tx.spec.ts.
import { expect, test } from '@playwright/test';
import { connect, installFakeIc705, ptt, rigFrames, rigLog } from './fake-ic705';

test('connects, shows the dial the radio reports, and a band change sets the radio', async ({ page }) => {
  await installFakeIc705(page, { hz: 14_076_000 });
  await page.goto('./#/settings');
  await page.getByRole('link', { name: /Rig control/ }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Off');
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  await expect(page.getByTestId('rig-dial')).toHaveText('14.076 MHz USB');
  // DTR and RTS low, and connecting sent no PTT.
  expect(await page.evaluate(() => [window.__rig.dtr, window.__rig.rts])).toEqual([false, false]);
  expect(await ptt(page)).toEqual([]);
  await expect(page.getByRole('listitem').filter({ hasText: 'USB SEND' })).toContainText('OFF');
  await expect(page.getByRole('listitem').filter({ hasText: 'DATA MOD' })).toContainText('USB');
  await expect(page.getByRole('listitem').filter({ hasText: 'Time-Out Timer' })).toContainText('5 min');

  await page.evaluate(() => (location.hash = '#/'));
  const band = page.getByRole('button', { name: /^Change band/ });
  await expect(band).toContainText('14.076');
  await band.click();
  // Connecting changed nothing on the radio: it is still in USB.
  await expect(page.getByTestId('radio-line')).toHaveText('The IC-705 is on 14.076 MHz USB. Choose the band to set USB-D.');
  const sheet = page.getByRole('dialog', { name: 'Change band' });
  await expect(sheet.getByText('The dial comes from the IC-705. Saved slots and QSOs record it.')).toBeVisible();
  const before = (await rigLog(page)).length;
  await sheet.getByText('40m', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => [window.__rig.hz, window.__rig.mode, window.__rig.data])).toEqual([7_074_000, 1, 1]);
  const set = rigFrames(await rigLog(page), before).map((f) => f.body).filter((b) => !b.startsWith('03') && !b.startsWith('04') && b !== '1A 06' && b !== '1C 00');
  expect(set).toEqual(['05 00 40 07 07 00', '06 01 01', '1A 06 01 01']);
  await expect(band).toContainText('40m');
  await expect(band).toContainText('7.074');
  await band.click();
  await expect(page.getByTestId('radio-line')).toHaveText('The IC-705 is on 7.074 MHz USB-D.');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The operator turns the radio's dial into 15m: RR73 follows within about 1 s.
  await page.evaluate(() => window.__rig.turnDial(21_076_000));
  await expect(band).toContainText('15m', { timeout: 1500 });
  await expect(band).toContainText('21.076');

  // The port allowed before opens again by itself when the app opens.
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
  expect(await ptt(page)).toEqual([]);
});

test('Test keying keys the radio for 1 s and releases it, with Key the radio with CAT off', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  await expect(page.getByRole('switch', { name: /^Key the radio with CAT/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText(/^Keyed and released at \d\d:\d\d:\d\d UTC\.$/, { timeout: 5000 });
  const p = await ptt(page);
  expect(p.map((f) => f.body)).toEqual(['1C 00 01', '1C 00 00']);
  expect(p[1].at - p[0].at).toBeGreaterThanOrEqual(950);
  expect(p[1].at - p[0].at).toBeLessThan(1500);
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('a radio that keeps transmitting after PTT off: Test keying says to unkey it, and Rig control and Settings show it', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  await page.evaluate(() => (window.__rig.ignorePttOff = true));
  await page.getByRole('button', { name: 'Test keying' }).click();
  await expect(page.getByTestId('rig-test')).toHaveText('Keyed. PTT off was not confirmed.', { timeout: 5000 });
  await expect(page.getByTestId('rig-status')).toHaveText('PTT off not confirmed');
  await expect(page.getByTestId('rig-help')).toHaveText('The IC-705 did not confirm PTT off. If it still transmits, unkey it at the radio or turn it off.');
  // PTT off: once, then 3 more 100 ms apart, then read every second while the radio transmits.
  const offs = (await ptt(page)).filter((f) => f.body === '1C 00 00');
  expect(offs.length).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByRole('link', { name: /Rig control/ })).toContainText('PTT off not confirmed');
  // The radio takes PTT off again: the next read clears the error.
  await page.evaluate(() => (window.__rig.ignorePttOff = false));
  await expect(page.getByRole('link', { name: /Rig control/ })).toContainText('Connected', { timeout: 3000 });
  expect(await page.evaluate(() => window.__rig.transmit)).toBe(false);
});

test('Keep Tx audio centred is off by default and works only with Key the radio with CAT on', async ({ page }) => {
  await installFakeIc705(page);
  await page.goto('./');
  await connect(page);
  const keying = page.getByRole('switch', { name: /^Key the radio with CAT/ });
  const shift = page.getByRole('switch', { name: /^Keep Tx audio centred/ });
  await expect(shift).not.toBeChecked();
  await expect(shift).toBeDisabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Needs Key the radio with CAT');
  await keying.click();
  await expect(shift).toBeEnabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Off: the dial stays put');
  await shift.click();
  await expect(shift).toBeChecked();
  await expect(page.getByTestId('rig-shift')).toHaveText('Signal stays on your Tx frequency');
  // Kept across a reload; with keying off it stays on and does nothing.
  await page.waitForTimeout(500);
  await page.reload();
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await expect(shift).toBeChecked();
  await keying.click();
  await expect(shift).toBeDisabled();
  await expect(page.getByTestId('rig-shift')).toHaveText('Needs Key the radio with CAT');
  // Turning it on sends nothing to the radio.
  expect(rigFrames(await rigLog(page)).filter((f) => f.body.startsWith('05 '))).toEqual([]);
});
