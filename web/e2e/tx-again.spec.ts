// Transmit, Halt, then call a station: the second call goes on air too. Runs in WebKit, the
// engine on the iPhone, whose output timestamps are wrong in Playwright on Linux (performanceTime
// advances 2 s per second; engine.test.ts replays recorded readings). Chromium's transmissions
// are measured in tx-cq.spec.ts and transmit.spec.ts. The CQ to answer arrives through the test
// hooks (src/lib/testing/e2e-hooks.ts). Along the way the clock mapping that stamps receive audio
// and schedules Tx must stay on UTC.
import { expect, test, type Page } from '@playwright/test';
import { prepare, waitForSlotPhase } from './txhelp';

/** Mapped UTC of the audio clock and of the last receive chunk against Date.now(), ms. */
async function expectOnUtc(page: Page, when: string) {
  const e = await page.evaluate(() => ({ mapMs: window.__rr73!.clockErrorMs(), rxMs: window.__rr73!.rxLagMs() }));
  test.info().annotations.push({ type: 'clock', description: `${when}: ${JSON.stringify(e)}` });
  expect.soft(e.mapMs, `audio clock against UTC ${when}, ms`).not.toBeNull();
  expect.soft(Math.abs(e.mapMs ?? Infinity), `audio clock against UTC ${when}, ms`).toBeLessThan(250);
  expect.soft(Math.abs(e.rxMs ?? Infinity), `receive stamps against UTC ${when}, ms`).toBeLessThan(500);
}

test('after a CQ and Halt, calling a station goes on air', async ({ page }) => {
  test.setTimeout(180_000);
  const dock = await prepare(page, undefined, { tap: false });
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(5000);
  await expectOnUtc(page, 'before Tx');

  // Past the 4.3 s in which CQ would start late in the slot under way: a whole CQ, on time.
  await waitForSlotPhase(page, 5, 12);
  await dock.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await page.waitForTimeout(2000);
  await dock.getByRole('button', { name: 'Halt' }).click();
  await expect(dock.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await page.waitForTimeout(3000);
  await expectOnUtc(page, 'after Halt');

  // A CQ in the slot that just ended; the reply goes out in the next slot of the other parity.
  const slot = await page.evaluate(() => Math.floor(Date.now() / 15_000) * 15_000 - 15_000);
  await page.evaluate((s) => window.__rr73!.decoded(s, [{ text: 'CQ JA1ABC PM95', freq_hz: 1200, dt_s: 0.1, snr_db: -8 }]), slot);
  const row = page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: /^CQ JA1ABC PM95$/ }) });
  await row.first().dblclick();
  await expect(dock.getByText(/JA1ABC 9V1NE OJ11/)).toBeVisible();
  await expect(dock.getByText('On air')).toBeVisible({ timeout: 35_000 });
  await expectOnUtc(page, 'on air again');

  // The radio hands our own signal back in the slot we transmit in, at +45 dB: that slot's decodes
  // are not shown, and the one row for the call is the one going out, marked Sending.
  const ours = await page.evaluate(() => Math.floor(Date.now() / 15_000) * 15_000);
  await page.evaluate((s) => window.__rr73!.decoded(s, [{ text: 'JA1ABC 9V1NE OJ11', freq_hz: 1500, dt_s: -0.7, snr_db: 45 }]), ours);
  await page.waitForTimeout(300);
  const list = page.getByTestId('decode-list');
  await expect(list.locator('button.dr', { has: page.locator('.c-msg', { hasText: /^JA1ABC 9V1NE OJ11$/ }) })).toHaveCount(1);
  await expect(list.locator('button.dr.sending .c-tag')).toHaveText('Sending');
  await dock.getByRole('button', { name: 'Halt' }).click();
});
