// WSPRnet uploads end to end in Chromium: Settings › WSPR turns them on, WSPR decodes go in
// through the e2e build's hook (lib/testing/e2e-hooks.ts), and a stand-in for
// https://wsprnet.org/post/ (page.route) receives one form-encoded record per spot, or one
// wsprstat for a slot without spots. The page's clock runs past the random 0 to 20 s wait. No
// request reaches a real server.
import { expect, test } from '@playwright/test';

test('uploads each WSPR slot to WSPRnet, one record per spot', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const posted: string[] = [];
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  await page.route('https://wsprnet.org/post/', async (route) => {
    posted.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'text/html', body: '1 spot(s) added' });
  });
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
  await page.getByRole('link', { name: /^WSPR/ }).click();
  await page.getByRole('switch', { name: /^Upload spots to WSPRnet/ }).check();
  await expect(page.getByTestId('wsprnet-status')).toHaveText('Paused outside WSPR');

  await page.goto('./#/operate');
  await page.locator('header.top').getByRole('button', { name: /^Change band/ }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByText('WSPR', { exact: true }).click();
  await page.keyboard.press('Escape');

  // One slot on 20m (dial 14.0956 MHz) with three decodes: Type 1, Type 2, an unresolved hash.
  const slot = Date.UTC(2026, 9, 14, 19, 32);
  await page.evaluate((slot) => {
    const d = (text: string, freq_hz: number, snr_db: number) => ({ text, freq_hz, dt_s: -0.3, drift_hz_per_s: 0, snr_db });
    window.__rr73!.wsprDecoded(slot, [d('DU1MGA PK04 37', 1490, -21), d('PJ4/K1ABC 37', 1551, -27), d('<...> FN42AB 37', 1530, -24)]);
    window.__rr73!.wsprDecoded(slot + 120_000, []);
  }, slot);
  await page.clock.runFor(21_000);
  await expect.poll(() => posted.length).toBe(3);
  const version = expect.stringMatching(/^RR73%20\d+\.\d+\.\d+$/);
  const all = posted.map((p) => Object.fromEntries(p.split('&').map((kv) => kv.split('=') as [string, string])));
  // Each slot waits its own random time, so the slots may go in either order; a slot's records keep theirs.
  const fields = [...all.filter((f) => f.function === 'wspr'), ...all.filter((f) => f.function === 'wsprstat')];
  expect(fields[0]).toEqual({ function: 'wspr', date: '261014', time: '1932', sig: '-21', dt: '-0.3', drift: '0', tqrg: '14.097090', tcall: 'DU1MGA', tgrid: 'PK04', dbm: '37', version, rcall: '9V1NE', rgrid: 'OJ11', rqrg: '14.097100', mode: '2' });
  expect(fields[1]).toMatchObject({ function: 'wspr', tqrg: '14.097151', tcall: 'PJ4/K1ABC', tgrid: '' });
  expect(fields[2]).toEqual({ function: 'wsprstat', rcall: '9V1NE', rgrid: 'OJ11', rqrg: '14.097100', tpct: '0', tqrg: '14.097100', dbm: '37', version, mode: '2' });
  expect(Object.keys(fields[0])).toEqual(['function', 'date', 'time', 'sig', 'dt', 'drift', 'tqrg', 'tcall', 'tgrid', 'dbm', 'version', 'rcall', 'rgrid', 'rqrg', 'mode']);
  expect(Object.keys(fields[2])).toEqual(['function', 'rcall', 'rgrid', 'rqrg', 'tpct', 'tqrg', 'dbm', 'version', 'mode']);

  await page.goto('./#/settings/wspr');
  await expect(page.getByTestId('wsprnet-status')).toHaveText(/^Sent 2 spots, last at \d\d:\d\d UTC$/);
});
