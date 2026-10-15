// The decode list under a finger, in Chromium: while touched, and for 0.5 s after the finger
// lifts, new slots wait (lib/decode/freeze.ts, wired in views/Operate.svelte). Slots arrive
// through the screen-review hooks (src/lib/testing/e2e-hooks.ts), the path the decoder's results
// take, so the test waits for no slot.
import { expect, test, type Page } from '@playwright/test';

async function decoded(page: Page, slotStartMs: number, texts: string[]) {
  await page.evaluate(
    ([s, ts]) => window.__rr73!.decoded(s as number, (ts as string[]).map((text, i) => ({ text, freq_hz: 600 + 150 * i, dt_s: 0.1, snr_db: -8 }))),
    [slotStartMs, texts] as const,
  );
}

/** "13:14:15", from a slot start in UTC ms. */
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

test('the list stays still under a finger and takes new slots after it lifts', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.press('Enter');
  await page.getByRole('link', { name: 'Operate' }).click();

  const now = Date.now() - (Date.now() % 15_000);
  const [older, newer] = [now - 30_000, now - 15_000];
  const list = page.getByTestId('decode-list');
  // The top bar's whole line: a run of empty slots keeps its first time as it grows.
  const heads = list.locator('.slot-bar .visually-hidden');
  await decoded(page, older, ['CQ JA1KXM PM95', 'CQ VK3QRP QF22']);
  await expect(heads.first()).toHaveText(new RegExp(`^${hhmmss(older)} UTC`));
  const first = (await heads.first().textContent())!;

  // A finger on the list while the next slot's decodes arrive.
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.down();
  await decoded(page, newer, ['CQ 9M2TRX OJ02', 'JH1RRT YB0AZK RR73']);
  await page.waitForTimeout(1500);
  expect(await heads.first().textContent()).toBe(first);
  await page.mouse.up();
  // Free again 0.5 s after the finger lifts: the newer slot goes in on top.
  await expect.poll(async () => await heads.first().textContent(), { timeout: 3000 }).toMatch(new RegExp(`^${hhmmss(newer)} UTC`));
});

test('New shows what the decode colours call new, and Hide worked hides stations in the log on this band and mode', async ({ page }) => {
  // Without the country file, new means a new call or grid here.
  await page.route('**/data/cty.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.press('Enter');
  await page.getByRole('link', { name: 'Operate' }).click();
  await page.evaluate(() => window.__rr73!.logged({ call: '9M2TRX', grid: 'OJ02', band: '20m', mode: 'FT8', dialHz: 14_074_000, audioHz: 1500, startUtcMs: Date.now() - 120_000, endUtcMs: Date.now() - 60_000, reportSent: -10, reportRcvd: -12 }));
  await page.getByRole('button', { name: 'Dismiss the notice' }).click();

  const slot = Date.now() - (Date.now() % 15_000) - 15_000;
  await decoded(page, slot, ['CQ 9M2TRX OJ02', 'CQ K1ABC FN42', '9V1NE 9M2TRX R-10', 'JA1KXM 9M2TRX 73', 'JH1RRT YB0AZK RR73']);
  const list = page.getByTestId('decode-list');
  const texts = () => list.locator('button.dr .c-msg').allTextContents();
  const chips = page.getByRole('radiogroup', { name: 'Show decodes' });
  await expect(chips.getByRole('radio')).toHaveText([/^All 5$/, /^CQ 2$/, /^New 2$/, /^To me 1$/, /^Rx freq \d+$/]);

  // New: the CQ from a new call and the RR73 from a new call, whatever colour won.
  await chips.getByRole('radio', { name: /^New/ }).click();
  await expect.poll(texts).toEqual(['CQ K1ABC FN42', 'JH1RRT YB0AZK RR73']);

  // Hide worked: 9M2TRX leaves the list but for its message to me, and the counts follow.
  await chips.getByRole('radio', { name: /^All/ }).click();
  const hide = page.getByRole('button', { name: 'Hide worked' });
  await expect(hide).toHaveAttribute('aria-pressed', 'false');
  await hide.click();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(texts).toEqual(['9V1NE 9M2TRX R-10', 'CQ K1ABC FN42', 'JH1RRT YB0AZK RR73']);
  await expect(chips.getByRole('radio')).toHaveText([/^All 3$/, /^CQ 1$/, /^New 2$/, /^To me 1$/, /^Rx freq \d+$/]);
  await hide.click();
  await expect.poll(texts).toHaveLength(5);

  // With every new category off in Decode colours, New leaves the row, and its filter with it.
  await chips.getByRole('radio', { name: /^New/ }).click();
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Decode colours/ }).click();
  await page.getByRole('radiogroup', { name: 'Preset' }).getByText('Quiet', { exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await expect(chips.getByRole('radio', { name: /^New/ })).toHaveCount(0);
  await expect(chips.getByRole('radio', { name: /^All/ })).toBeChecked();
  await expect.poll(texts).toHaveLength(5);
});

test('Band activity keeps the hour: the list draws 8 slots, and 8 more as it scrolls near its end', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.press('Enter');
  await page.getByRole('link', { name: 'Operate' }).click();

  // 20 slots of 6 decodes, oldest first.
  const now = Date.now() - (Date.now() % 15_000);
  for (let i = 20; i >= 1; i--) await decoded(page, now - i * 15_000, Array.from({ length: 6 }, (_, k) => `CQ JA${k}X${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + k)} PM9${k}`));
  const list = page.getByTestId('decode-list');
  const bars = list.locator('li.slot-bar');
  await expect(bars).toHaveCount(8);
  await expect(page.getByRole('radiogroup', { name: 'Show decodes' }).getByRole('radio', { name: /^All/ })).toHaveText(/^All 120$/);

  // Near the end, 8 more; then the rest.
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(bars).toHaveCount(16);
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(bars).toHaveCount(20);
  await expect(bars.last().locator('.visually-hidden')).toHaveText(new RegExp(`^${hhmmss(now - 20 * 15_000)} UTC`));

  // Back at the top, the next slot takes the list back to 8.
  await list.evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(700);
  await decoded(page, now, ['CQ K1ABC FN42']);
  await expect(bars).toHaveCount(8);
  await expect(bars.first().locator('.visually-hidden')).toHaveText(new RegExp(`^${hhmmss(now)} UTC`));

  // A filter that matches few rows draws back until the screen fills or the hour runs out.
  await page.getByRole('radiogroup', { name: 'Show decodes' }).getByRole('radio', { name: /^CQ/ }).click();
  await expect(bars).toHaveCount(8);
  await page.getByRole('radiogroup', { name: 'Show decodes' }).getByRole('radio', { name: /^To me/ }).click();
  await expect(list.locator('button.dr')).toHaveCount(0);
});

test('the station detail ends with the station’s signal over its last 8 slots, gaps marked', async ({ page }) => {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.press('Enter');
  await page.getByRole('link', { name: 'Operate' }).click();
  // VK3QRP calls CQ in the odd slots from 15 slots back; two of those slots hold only JA1KXM.
  const now = Date.now() - (Date.now() % 15_000);
  for (let i = 16; i >= 1; i--) await decoded(page, now - i * 15_000, [i % 2 === 1 && i !== 7 && i !== 11 ? 'CQ VK3QRP QF22' : 'CQ JA1KXM PM95']);
  await page.getByTestId('decode-list').locator('button.dr', { hasText: 'CQ VK3QRP QF22' }).first().click({ button: 'right' });
  await expect(page.getByTestId('signal-chart')).toHaveAttribute('aria-label', /^SNR over the last 8 slots, oldest first: (−8 dB, ){2}no decode, −8 dB, no decode, (−8 dB, ){2}−8 dB$/);
});
