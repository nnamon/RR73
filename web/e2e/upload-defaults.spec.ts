// A new install sends nothing anywhere: with callsign and grid set, FT8 and WSPR decodes reach no
// relay, PSK Reporter feed or WSPRnet until their switches are turned on. Every upload switch
// starts off.
import { expect, test } from '@playwright/test';

test('a new install has every upload off and sends no decode anywhere', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const left: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.protocol !== 'blob:' && u.origin !== origin) left.push(`${r.method()} ${r.url()}`);
  });
  page.on('websocket', (ws) => left.push(`WebSocket ${ws.url()}`));
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  await page.clock.install();
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }

  await page.goto('./#/settings/pskreporter');
  await expect(page.getByRole('switch', { name: /^Report to PSK Reporter/ })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: /^Show who heard you/ })).not.toBeChecked();
  await page.goto('./#/settings/wspr');
  await expect(page.getByRole('switch', { name: /^Upload spots to WSPRnet/ })).not.toBeChecked();
  await page.goto('./#/settings/sdr');
  await expect(page.getByRole('switch', { name: /^Receive from a web SDR/ })).not.toBeChecked();

  const slot = Math.floor(Date.now() / 120_000) * 120_000;
  await page.evaluate((slot) => {
    window.__rr73!.decoded(slot, [{ text: 'CQ 9M2TRX OJ02', freq_hz: 1022, dt_s: 0.1, snr_db: -10 }]);
    window.__rr73!.wsprDecoded(slot, [{ text: 'DU1MGA PK04 37', freq_hz: 1490, dt_s: -0.3, drift_hz_per_s: 0, snr_db: -21 }]);
    window.__rr73!.wsprDecoded(slot + 120_000, []);
  }, slot);
  await page.clock.runFor(90_000);
  expect(left).toEqual([]);
});
