// Who heard you end to end in Chromium: Settings › PSK Reporter turns it on, and a stand-in for
// PSK Reporter's MQTT feed (page.routeWebSocket) answers the app's MQTT packets and publishes
// spots in the feed's format (https://www.mqtt.pskreporter.info). Spots lists who heard you.
// No request reaches a real server.
import { expect, test } from '@playwright/test';
import { feedSpot, publish, routeFeed } from './feed-stand-in';

test('lists the stations that heard you, live from the feed', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  const feed = await routeFeed(page);

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
  await page.getByRole('switch', { name: /^Show who heard you/ }).check();
  await expect(page.getByRole('region', { name: 'PSK Reporter' }).getByText('Live', { exact: true })).toBeVisible();
  await expect.poll(() => feed.subscribed).toEqual(['pskr/filter/v2/+/+/9V1NE/#']);

  await page.goto('./#/spots');
  await expect(page.getByText('Stations that report your signal to PSK Reporter appear here', { exact: false })).toBeVisible();
  const now = Math.floor(Date.now() / 1000);
  const spot = (rc: string, rl: string, rp: number | null, b: string, ago: number) => feedSpot(now, '9V1NE', rc, rl, rp, b, ago);
  feed.ws!.send(publish('pskr/filter/v2/20m/FT8/9V1NE/JA1XYZ/OJ11/PM95/381/339', spot('JA1XYZ', 'PM95qq', -8, '20m', 60)));
  feed.ws!.send(publish('pskr/filter/v2/20m/FT8/9V1NE/VK3QRP/OJ11/QF22/381/150', spot('VK3QRP', 'QF22lb', null, '20m', 30)));
  feed.ws!.send(publish('pskr/filter/v2/20m/FT8/9V1NE/JA1XYZ/OJ11/PM95/381/339', spot('JA1XYZ', 'PM95qq', -3, '20m', 15)));
  const list = page.getByRole('list', { name: 'Stations that heard you in the last 30 minutes' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Heard you · 2' })).toBeVisible();
  const rows = await list.getByRole('listitem').allInnerTexts();
  expect(rows[0]).toMatch(/^JA1XYZ\s+PM95qq · 5,\d{3} km · 20m\s+−03 dB\s+\d\d:\d\d$/);
  expect(rows[1]).toMatch(/^VK3QRP\s+QF22lb · 6,\d{3} km · 20m\s+\d\d:\d\d$/);
});
