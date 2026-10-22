// A QSO in an exchange format end to end in Chromium, with Contest exchange set in Settings ›
// FT8 and FT4. The other station's CQ FD and its exchange arrive through the test hooks
// (src/lib/testing/e2e-hooks.ts); the app's output is recorded in the page (tap.ts) and decoded
// in Node with the app's own decoder. The QSO lands in the Log with both exchanges and goes to a
// mock Wavelog (route interception; no real server) with STX_STRING and SRX_STRING.
import { expect, test } from '@playwright/test';
import { decodeCaptured, slotOf, SLOT_MS } from './tap';
import { loadWasm } from './wasm';
import { mockWavelog, seed, wavelogOnly } from './log-data';
import { prepare, waitForSlotPhase, waitForTransmissions } from './txhelp';

test('Contest exchange answers CQ FD with the exchange, sends RR73 after theirs and logs both', async ({ page }) => {
  test.setTimeout(150_000);
  const wavelog = await mockWavelog(page);
  const dock = await prepare(page, (p) => seed(p, wavelogOnly({ sendAutomatically: false })));

  await page.goto('./#/settings/ft8');
  const field = page.getByRole('textbox', { name: 'Contest exchange' });
  await expect(field).toHaveValue('');
  await field.fill('6a wi');
  await field.press('Enter');
  await expect(field).toHaveValue('6A WI');
  // The preview shows what goes on air in each format, for a station at −10 dB.
  await expect(page.getByTestId('exchange-fd')).toContainText('6A WI');
  await expect(page.getByTestId('exchange-ru')).toContainText('579 WI');
  await expect(page.getByTestId('exchange-vhf')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Next serial number' })).toHaveValue('1');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();

  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
  // Their CQ in the slot that just ended, double-tapped early in the next: the exchange goes out
  // late in the slot under way, or in the next slot of that parity.
  await waitForSlotPhase(page, 0.5, 2);
  const cqSlot = await page.evaluate(() => Math.floor(Date.now() / 15_000) * 15_000 - 15_000);
  await page.evaluate((s) => window.__rr73!.decoded(s, [{ text: 'CQ FD K1ABC FN42', freq_hz: 1200, dt_s: 0.1, snr_db: -8 }]), cqSlot);
  const list = page.getByTestId('decode-list');
  await list.locator('button.dr', { has: page.locator('.c-msg', { hasText: /^CQ FD K1ABC FN42$/ }) }).first().dblclick();
  await expect(dock.getByText(/K1ABC 9V1NE 6A WI/)).toBeVisible();

  const wasm = (await loadWasm())!;
  const [first] = await waitForTransmissions(page, 1, 40_000);
  expect(decodeCaptured(wasm, first).map((d) => d.text)).toEqual(['K1ABC 9V1NE 6A WI']);
  expect((slotOf(first) - cqSlot) % (2 * SLOT_MS)).toBe(SLOT_MS);

  // Their R and exchange in the slot after ours: RR73 goes out in the next, and the QSO is logged.
  const theirs = slotOf(first) + SLOT_MS;
  await page.waitForFunction((end) => Date.now() > end, theirs + SLOT_MS);
  await page.evaluate((s) => window.__rr73!.decoded(s, [{ text: '9V1NE K1ABC R 2B EMA', freq_hz: 1200, dt_s: 0.1, snr_db: -9 }]), theirs);
  const [, second] = await waitForTransmissions(page, 2, 40_000);
  expect(decodeCaptured(wasm, second).map((d) => d.text)).toEqual(['K1ABC 9V1NE RR73']);
  expect(slotOf(second) - slotOf(first)).toBe(2 * SLOT_MS);
  await expect(page.getByTestId('log-notice')).toContainText('Logged K1ABC', { timeout: 20_000 });
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();

  // Log details show both exchanges.
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Log' }).click();
  const entry = page.locator('li.lr', { has: page.getByText('K1ABC', { exact: true }) });
  await expect(entry).toHaveCount(1);
  await entry.click();
  const edit = page.getByRole('dialog', { name: 'Edit QSO' });
  await expect(edit.getByRole('textbox', { name: 'Exchange sent' })).toHaveValue('6A WI');
  await expect(edit.getByRole('textbox', { name: 'Exchange received' })).toHaveValue('2B EMA');
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  await page.getByRole('button', { name: 'Send 1 QSO to Wavelog' }).click();
  await expect(entry.getByText('Wavelog: delivered')).toBeAttached();
  const posted = wavelog.requests.filter((r) => r.path === '/api/qso');
  expect(posted).toHaveLength(1);
  const adif = String(posted[0].body?.string);
  for (const f of ['<CALL:5>K1ABC', '<STX_STRING:5>6A WI', '<SRX_STRING:6>2B EMA']) expect(adif).toContain(f);
});
