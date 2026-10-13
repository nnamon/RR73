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
  // Run off is above the caller queue while Run is on.
  await page.getByRole('button', { name: 'Run', exact: true, pressed: true }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true, pressed: true })).toBeHidden();
  expect(await clips()).toBe(3);
});

test('the gesture hint stays until a decode is tapped and double-tapped; End QSO goes back to idle', async ({ page }) => {
  const confirm = async () => {
    await dock.getByRole('button', { name: 'Confirm band' }).click();
    await page.getByRole('dialog', { name: 'Change band' }).getByRole('button', { name: 'Use 20m FT8' }).click();
  };
  const dock = page.getByRole('region', { name: 'Transmit' });
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
  await confirm();
  const hint = dock.getByText('Tap a decode to select it, double-tap to call. Touch and hold for details.');
  await expect(hint).toBeVisible();

  const slot = Date.now() - (Date.now() % 15_000) - 15_000;
  await page.evaluate((s) => {
    const d = (text: string, freq_hz: number) => ({ text, snr_db: -8, freq_hz, dt_s: 0.1 });
    window.__rr73!.decoded(s, [d('CQ JA1KXM PM95', 1418), d('CQ DX VK2ESN QF56', 642)]);
  }, slot);
  const row = (text: string) => page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) }).first();

  // A tap selects; a tap on the selected row clears the selection. The hint stays for the double-tap.
  await row('CQ JA1KXM PM95').click();
  await expect(dock.getByRole('button', { name: /^Call JA1KXM/ })).toBeVisible();
  await page.waitForTimeout(500);
  await row('CQ JA1KXM PM95').click();
  await expect(dock.getByRole('button', { name: /^Call JA1KXM/ })).toBeHidden();
  await expect(hint).toBeVisible();

  // A double-tap calls. Halt keeps the QSO; End QSO goes back to idle, now without the hint.
  await row('CQ DX VK2ESN QF56').dblclick();
  await expect(dock.getByText('VK2ESN', { exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'Halt' }).click();
  await expect(dock.getByText('VK2ESN', { exact: true })).toBeVisible();
  await dock.getByRole('button', { name: 'End QSO' }).click();
  await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
  await expect(dock.getByText('VK2ESN', { exact: true })).toBeHidden();
  await expect(dock.getByRole('button', { name: 'End QSO' })).toBeHidden();
  await expect(hint).toBeHidden();

  // Settings keep it: the hint stays gone after a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await confirm();
  await expect(dock.getByRole('button', { name: 'Call CQ' })).toBeVisible();
  await expect(hint).toBeHidden();
});
