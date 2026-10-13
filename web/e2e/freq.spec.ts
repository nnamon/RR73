// Setting the receive and transmit frequencies from the waterfall: a tap picks the frequency
// under the finger, the bar sets Rx, Tx or both, and the choice survives a reload.
import { expect, test, type Page } from '@playwright/test';

const HINT = 'Tap the waterfall to set the receive or transmit frequency.';

/** Taps the waterfall at `hz` and returns the frequency the app should pick there. */
async function tapAt(page: Page, hz: number): Promise<number> {
  const box = (await page.getByTestId('waterfall').boundingBox())!;
  const x = Math.round(box.x + (box.width * hz) / 3000);
  await page.mouse.click(x, Math.round(box.y + box.height / 2));
  return Math.round(((x - box.x) / box.width) * 3000);
}

const axisLabel = (page: Page) => page.getByRole('button', { name: /^Set frequencies/ });

test('a tap on the waterfall sets Rx and Tx, and they survive a reload', async ({ page }) => {
  await page.goto('./#/operate');
  await expect(page.getByText(HINT)).toBeVisible();
  await expect(axisLabel(page)).toHaveAccessibleName('Set frequencies. Receive 1500 Hz, transmit 1500 Hz.');

  const listTop = (await page.getByTestId('decode-list').boundingBox())!.y;
  const hz = await tapAt(page, 1846);
  expect(Math.abs(hz - 1846)).toBeLessThanOrEqual(8);
  const bar = page.getByRole('group', { name: 'Set the frequency' });
  await expect(bar).toBeVisible();
  // The bar sits under the axis and pushes the decodes down by its height; it covers nothing.
  const b = (await bar.boundingBox())!;
  const canvas = (await page.getByTestId('waterfall').boundingBox())!;
  const list = (await page.getByTestId('decode-list').boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  expect(list.y).toBeGreaterThanOrEqual(b.y + b.height);
  expect(list.y - listTop).toBeCloseTo(b.height, 0);
  await expect(bar.getByRole('textbox', { name: 'Frequency, Hz' })).toHaveValue(String(hz));
  await expect(page.getByTestId('freq-guide')).toBeVisible();
  await bar.getByRole('button', { name: `Both, receive and transmit at ${hz} Hz` }).click();
  await expect(bar).toBeHidden();
  await expect(page.getByTestId('freq-guide')).toBeHidden();
  await expect(axisLabel(page)).toHaveAccessibleName(`Set frequencies. Receive ${hz} Hz, transmit ${hz} Hz.`);
  await expect(page.getByText(HINT)).toBeHidden();

  // The brackets moved to the tapped frequency.
  const wf = (await page.getByTestId('waterfall').boundingBox())!;
  const rx = (await page.getByTestId('rx-bracket').boundingBox())!;
  const tx = (await page.getByTestId('tx-bracket').boundingBox())!;
  expect(Math.abs(rx.x - (wf.x + (wf.width * hz) / 3000))).toBeLessThanOrEqual(1);
  expect(Math.abs(tx.x - rx.x)).toBeLessThanOrEqual(1);

  // Receive here moves only Rx; Transmit here only Tx.
  const rxHz = await tapAt(page, 700);
  await bar.getByRole('button', { name: `Receive here, ${rxHz} Hz` }).click();
  await expect(axisLabel(page)).toHaveAccessibleName(`Set frequencies. Receive ${rxHz} Hz, transmit ${hz} Hz.`);
  const txHz = await tapAt(page, 2210);
  await bar.getByRole('button', { name: `Transmit here, ${txHz} Hz` }).click();
  await expect(axisLabel(page)).toHaveAccessibleName(`Set frequencies. Receive ${rxHz} Hz, transmit ${txHz} Hz.`);

  // Settings are written to IndexedDB after the change; give the write a moment.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(axisLabel(page)).toHaveAccessibleName(`Set frequencies. Receive ${rxHz} Hz, transmit ${txHz} Hz.`);
  await expect(page.getByText(HINT)).toBeHidden();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(`Tx stays on ${txHz} Hz when you call a station`)).toBeVisible();
});

test('the bar keeps to the FT8 limits, and closes with Escape or a tap elsewhere', async ({ page }) => {
  await page.goto('./#/operate');
  const bar = page.getByRole('group', { name: 'Set the frequency' });
  // The edges clamp to 200 and 2800 Hz.
  await tapAt(page, 30);
  await expect(bar.getByRole('textbox', { name: 'Frequency, Hz' })).toHaveValue('200');
  await tapAt(page, 2990);
  await expect(bar.getByRole('textbox', { name: 'Frequency, Hz' })).toHaveValue('2800');
  // A typed frequency outside them is refused.
  await bar.getByRole('textbox', { name: 'Frequency, Hz' }).fill('2950');
  await expect(bar.getByText('FT8 uses 200 to 2800 Hz.')).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Both/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await tapAt(page, 1200);
  await expect(bar).toBeVisible();
  await page.getByRole('timer', { name: 'UTC time and slot progress' }).click();
  await expect(bar).toBeHidden();
  // Clear frequency needs audio; with none it says so.
  await tapAt(page, 1200);
  await bar.getByRole('button', { name: 'Find clear Tx frequency' }).click();
  await expect(bar.getByText('Finding a clear frequency needs 2 slots of audio.')).toBeVisible();
});

test('without a pointer, Set frequencies opens the bar and takes a typed frequency', async ({ page }) => {
  await page.goto('./#/operate');
  const set = axisLabel(page);
  await set.focus();
  await expect(set).toBeVisible();
  await page.keyboard.press('Enter');
  const field = page.getByRole('group', { name: 'Set the frequency' }).getByRole('textbox', { name: 'Frequency, Hz' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('1500');
  await page.keyboard.type('1846');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Transmit here, 1846 Hz' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(set).toBeFocused();
  await expect(set).toHaveAccessibleName('Set frequencies. Receive 1500 Hz, transmit 1846 Hz.');
});
