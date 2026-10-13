// The transmit dock plays a silent clip through a media element inside each tap that can lead
// to a transmission, so iOS does not mute output on the silent switch. Halt and the taps that
// turn things off play nothing.
import { expect, test } from '@playwright/test';

test('Call CQ, Enable Tx and Run each play the silent clip inside the tap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __clips: number };
    w.__clips = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__clips++;
      return play.call(this);
    };
  });
  const clips = () => page.evaluate(() => (window as unknown as { __clips: number }).__clips);
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Operate' }).click();
  const dock = page.getByRole('region', { name: 'Transmit' });
  await dock.getByRole('button', { name: 'Confirm band' }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByRole('button', { name: 'Use 20m FT8' }).click();
  expect(await clips()).toBe(0);

  await dock.getByRole('button', { name: 'Call CQ' }).click();
  expect(await clips()).toBe(1);
  const enable = dock.getByRole('button', { name: 'Enable Tx' });
  await expect(enable).toHaveAttribute('aria-pressed', 'true');
  await enable.click();
  await expect(enable).toHaveAttribute('aria-pressed', 'false');
  expect(await clips()).toBe(1);
  await enable.click();
  await expect(enable).toHaveAttribute('aria-pressed', 'true');
  expect(await clips()).toBe(2);
  await dock.getByRole('button', { name: 'Halt' }).click();
  expect(await clips()).toBe(2);

  await dock.getByRole('button', { name: 'Run', exact: true }).click();
  expect(await clips()).toBe(3);
  await dock.getByRole('button', { name: 'Run', exact: true }).click();
  expect(await clips()).toBe(3);
});
