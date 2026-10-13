// Moving Tx and Rx on the waterfall by direct manipulation: a sideways drag moves Tx with a live
// label and sets it on release, a tap sets Tx where it lands, a drag that starts on the green
// line moves Rx, and a vertical movement or a cancelled pointer changes nothing. The sliders set
// both without a pointer. The choice, and the hint that goes after the first drag, survive a reload.
import { expect, test, type Page } from '@playwright/test';

const slider = (page: Page, which: 'Transmit' | 'Receive') => page.getByRole('slider', { name: `${which} frequency, Hz` });
const area = async (page: Page) => (await page.getByTestId('waterfall-area').boundingBox())!;
type Box = { x: number; y: number; width: number; height: number };
/** A whole pixel near `hz`, and the frequency the app sets there: 5 Hz steps inside 200 to 2800 Hz. */
const at = (b: Box, hz: number) => {
  const x = Math.round(b.x + (b.width * hz) / 3000);
  return { x, hz: Math.min(2800, Math.max(200, Math.round(Math.round(((x - b.x) / b.width) * 3000) / 5) * 5)) };
};

async function drag(page: Page, b: Box, fromHz: number, toHz: number, release = true) {
  const y = Math.round(b.y + b.height / 2);
  await page.mouse.move(at(b, fromHz).x, y);
  await page.mouse.down();
  await page.mouse.move(at(b, toHz).x, y, { steps: 6 });
  if (release) await page.mouse.up();
  return at(b, toHz).hz;
}

test('a drag moves Tx with a live label, sets it on release, and the hint goes for good', async ({ page }) => {
  await page.goto('./#/operate');
  const hint = page.getByTestId('drag-hint');
  await expect(hint).toBeVisible();
  const b = await area(page);
  // The hint is a small pill at the bottom left, above the frequency labels.
  const h = (await hint.boundingBox())!;
  expect(h.x - b.x).toBeLessThanOrEqual(8);
  expect(b.y + b.height - (h.y + h.height)).toBeGreaterThanOrEqual(14);
  expect(h.y).toBeGreaterThan(b.y + b.height / 2);

  const mid = await drag(page, b, 600, 1200, false);
  await expect(page.getByTestId('drag-label')).toHaveText(`Tx ${mid} Hz`);
  // Nothing is set until the finger lifts.
  await expect(slider(page, 'Transmit')).toHaveValue('1500');
  const end = at(b, 1850);
  await page.mouse.move(end.x, Math.round(b.y + b.height / 2), { steps: 6 });
  await expect(page.getByTestId('drag-label')).toHaveText(`Tx ${end.hz} Hz`);
  await page.mouse.up();
  await expect(page.getByTestId('drag-label')).toBeHidden();
  await expect(slider(page, 'Transmit')).toHaveValue(String(end.hz));
  await expect(slider(page, 'Receive')).toHaveValue('1500');
  await expect(hint).toBeHidden();
  // The marker's first line sits on the lowest tone; the second 50 Hz above it.
  const tx = (await page.getByTestId('tx-marker').boundingBox())!;
  expect(Math.abs(tx.x + 1 - (b.x + (b.width * end.hz) / 3000))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(tx.x + tx.width - 1 - (b.x + (b.width * (end.hz + 50)) / 3000))).toBeLessThanOrEqual(1.5);

  // Settings are written to IndexedDB after the change; give the write a moment.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(slider(page, 'Transmit')).toHaveValue(String(end.hz));
  await expect(page.getByTestId('waterfall-area')).toBeVisible();
  await expect(hint).toBeHidden();
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(`Tx stays on ${end.hz} Hz when you call a station`)).toBeVisible();
});

test('a tap sets Tx where it lands, and a drag from the green line moves Rx', async ({ page }) => {
  await page.goto('./#/operate');
  const b = await area(page);
  const tap = at(b, 2210);
  await page.mouse.click(tap.x, Math.round(b.y + b.height / 2));
  await expect(slider(page, 'Transmit')).toHaveValue(String(tap.hz));
  await expect(slider(page, 'Receive')).toHaveValue('1500');

  // The press lands on the Rx line at 1500 Hz.
  const y = Math.round(b.y + b.height / 2);
  await page.mouse.move(Math.round(b.x + (b.width * 1500) / 3000) + 3, y);
  await page.mouse.down();
  const to = at(b, 900);
  await page.mouse.move(to.x, y, { steps: 6 });
  await expect(page.getByTestId('drag-label')).toHaveText(`Rx ${to.hz} Hz`);
  await page.mouse.up();
  await expect(slider(page, 'Receive')).toHaveValue(String(to.hz));
  await expect(slider(page, 'Transmit')).toHaveValue(String(tap.hz));
  const rx = (await page.getByTestId('rx-marker').boundingBox())!;
  expect(Math.abs(rx.x + 1 - (b.x + (b.width * to.hz) / 3000))).toBeLessThanOrEqual(1.5);
});

test('a vertical movement and a cancelled drag change nothing', async ({ page }) => {
  await page.goto('./#/operate');
  const b = await area(page);
  // Up and down: the page's scroll gets it.
  const x = at(b, 1000).x;
  await page.mouse.move(x, Math.round(b.y + 20));
  await page.mouse.down();
  await page.mouse.move(x + 3, Math.round(b.y + 70), { steps: 5 });
  await page.mouse.up();
  await expect(slider(page, 'Transmit')).toHaveValue('1500');

  // The system takes the pointer mid-drag (pointercancel): the drag ends where it began.
  await drag(page, b, 600, 1200, false);
  await expect(page.getByTestId('drag-label')).toBeVisible();
  await page.getByTestId('waterfall-area').dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await expect(page.getByTestId('drag-label')).toBeHidden();
  await page.mouse.up();
  await expect(slider(page, 'Transmit')).toHaveValue('1500');
  await expect(page.getByTestId('drag-hint')).toBeVisible();
});

test('without a pointer, the sliders set Tx and Rx in 5 Hz steps', async ({ page }) => {
  await page.goto('./#/operate');
  const tx = slider(page, 'Transmit');
  await tx.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tx).toHaveValue('1510');
  await expect(tx).toHaveAttribute('aria-valuetext', '1510 Hz');
  await expect(page.getByText('Transmit 1510 Hz.')).toBeAttached();
  const rx = slider(page, 'Receive');
  await rx.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(rx).toHaveValue('1495');
  // FT8 keeps to 200 to 2800 Hz.
  await expect(tx).toHaveAttribute('min', '200');
  await expect(tx).toHaveAttribute('max', '2800');
});

test('Find clear Tx in the ••• menu says when there is not enough audio', async ({ page }) => {
  await page.goto('./#/operate');
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Find clear Tx' }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(bar.getByRole('status')).toHaveText('Finding a clear Tx frequency needs 2 slots of audio.');
  await expect(slider(page, 'Transmit')).toHaveValue('1500');
});
