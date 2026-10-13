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
  const heads = list.locator('.slot-bar .st');
  await decoded(page, older, ['CQ JA1KXM PM95', 'CQ VK3QRP QF22']);
  await expect(heads.first()).toHaveText(new RegExp(`^${hhmmss(older)}`));

  // A finger on the list while the next slot's decodes arrive.
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.down();
  await decoded(page, newer, ['CQ 9M2TRX OJ02', 'JH1RRT YB0AZK RR73']);
  await page.waitForTimeout(1500);
  expect((await heads.first().textContent())!.slice(0, 8)).toBe(hhmmss(older));
  await page.mouse.up();
  // Free again 0.5 s after the finger lifts: the newer slot goes in on top.
  await expect.poll(async () => (await heads.first().textContent())!.slice(0, 8), { timeout: 3000 }).toBe(hhmmss(newer));
});
