// Reports to PSK Reporter end to end in Chromium: Settings › PSK Reporter turned on against a
// stand-in QSP relay (relay-stand-in.ts), then a slot's decodes fed in through the e2e build's
// hook (lib/testing/e2e-hooks.ts). The relay receives each sender once, at dial plus audio, with
// the grid its messages carried. No request reaches a real server.
import { expect, test } from '@playwright/test';
import { RELAY_BASE, routeRelay } from './relay-stand-in';

let escaped: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  escaped = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === new URL(RELAY_BASE).origin) return;
    if (u.origin !== origin || (r.method() !== 'GET' && r.method() !== 'HEAD')) escaped.push(`${r.method()} ${r.url()}`);
  });
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

test.afterEach(() => {
  expect(escaped, 'requests that left for a real server').toEqual([]);
});

test('reports the senders of each slot through the relay', async ({ page }) => {
  const calls = await routeRelay(page);
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('link', { name: /^PSK Reporter/ }).click();
  const on = page.getByRole('switch', { name: /^Report to PSK Reporter/ });
  await on.check();
  await expect(page.getByTestId('psk-status')).toHaveText('Needs a relay. Add one in Settings › Relay.');

  await page.getByRole('link', { name: /^Relay/ }).click();
  await page.getByRole('button', { name: 'Add relay' }).click();
  const address = page.getByRole('textbox', { name: 'Address' });
  await address.fill(RELAY_BASE);
  await address.press('Enter');
  await expect(page.getByRole('radio', { name: /^relay\.test/ })).toBeChecked();
  await page.goto('./#/settings/pskreporter');
  await expect(page.getByTestId('psk-status')).toHaveText('Waiting for decodes');
  const antenna = page.getByRole('textbox', { name: 'Antenna' });
  await antenna.fill('Vertical, 10 m up');
  await antenna.press('Enter');

  // One FT8 slot on 20m, as the decoder delivers it.
  const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
  await page.evaluate((slot) => {
    const d = (text: string, freq_hz: number, snr_db: number) => ({ text, freq_hz, dt_s: 0.1, snr_db });
    window.__rr73!.decoded(slot, [d('CQ 9M2TRX OJ02', 1022, -10), d('9V1NE JA1KXM PM95', 1418, -12), d('JH1RRT YB0AZK RR73', 2210, -16), d('K1ABC <W9XYZ> -05', 600, -20)]);
  }, slot);
  await expect.poll(() => calls.filter((c) => c.path === '/v1/pskreporter/receptions').length).toBe(1);
  const post = calls.find((c) => c.path === '/v1/pskreporter/receptions')!;
  const body = post.body as { station: Record<string, string>; spots: unknown[] };
  expect(body.station).toEqual({ callsign: '9V1NE', locator: 'OJ11', software: expect.stringMatching(/^RR73 \d+\.\d+\.\d+/), antenna: 'Vertical, 10 m up' });
  // The time is when the decodes arrived: the developer page's flowStartSeconds.
  const time = expect.any(Number);
  expect((body.spots as { time: number }[]).every((s) => Math.abs(s.time - Date.now() / 1000) < 30)).toBe(true);
  expect(body.spots).toEqual([
    { callsign: '9M2TRX', locator: 'OJ02', frequencyHz: 14_075_022, snrDb: -10, mode: 'FT8', time },
    { callsign: 'JA1KXM', locator: 'PM95', frequencyHz: 14_075_418, snrDb: -12, mode: 'FT8', time },
    { callsign: 'YB0AZK', locator: '', frequencyHz: 14_076_210, snrDb: -16, mode: 'FT8', time },
  ]);
  await expect(page.getByTestId('psk-status')).toHaveText(/^Sent 3 spots, last at \d\d:\d\d UTC$/);

  // The same slot again sends nothing; off, nothing goes.
  await page.evaluate((slot) => window.__rr73!.decoded(slot, [{ text: 'CQ 9M2TRX OJ02', freq_hz: 1022, dt_s: 0.1, snr_db: -10 }]), slot);
  await on.uncheck();
  await page.evaluate((slot) => window.__rr73!.decoded(slot + 15_000, [{ text: 'CQ VK3QRP QF22', freq_hz: 1846, dt_s: 0.1, snr_db: -14 }]), slot);
  await page.waitForTimeout(500);
  expect(calls.filter((c) => c.path === '/v1/pskreporter/receptions')).toHaveLength(1);
});
