// CQ rows name the caller's country from the country file, which Operate loads when the page is
// idle. The file comes from fixtures/ (Big CTY of 15 September 2026), so the test does not
// depend on the data the build fetched. Decodes come through the e2e hooks.
import { expect, test, type Page } from '@playwright/test';
import { bigCtyFixture } from '../src/lib/reference/testing';

const row = (page: Page, text: string) => page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) });

/** Widths in px: the message shown and needed, the country shown and needed, and where the numbers start. */
const widths = (page: Page, text: string) =>
  row(page, text).evaluate((el) => {
    const msg = el.querySelector<HTMLElement>('.c-msg')!;
    const name = el.querySelector<HTMLElement>('.c-country > span');
    return { msg: [msg.clientWidth, msg.scrollWidth], country: name ? [name.clientWidth, name.scrollWidth] : null, numbers: el.querySelector('.c-num')!.getBoundingClientRect().left };
  });

test('a CQ row names the caller’s country before the numbers, and a QSO row does not', async ({ page }) => {
  // Hold the country file until the rows are on screen, to see them fill in.
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const cty = JSON.stringify(bigCtyFixture());
  await page.route('**/data/cty.json', async (route) => {
    await held;
    await route.fulfill({ body: cty, contentType: 'application/json' });
  });
  await page.goto('./');
  await page.waitForFunction(() => !!window.__rr73);
  const texts = ['CQ VK2LAW QF56', 'JA1XYZ VK2LAW -09', 'CQ DX DL1ABC JO62', 'CQ POTA DL1ABC/QRP JO62'];
  await page.evaluate((ts) => {
    const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
    window.__rr73!.decoded(
      slot,
      ts.map((text, i) => ({ text, freq_hz: 763 + 300 * i, dt_s: 0.1, snr_db: -11 })),
    );
  }, texts);
  const cq = row(page, 'CQ VK2LAW QF56');
  await expect(cq).toBeVisible();
  await expect(page.locator('.c-country')).toHaveCount(0);
  const before = await Promise.all(texts.map((t) => row(page, t).boundingBox()));

  release();
  await expect(cq.locator('.c-country')).toHaveText('Australia');
  await expect(row(page, 'JA1XYZ VK2LAW -09').locator('.c-country')).toHaveCount(0);
  const after = await Promise.all(texts.map((t) => row(page, t).boundingBox()));
  expect(after.map((b) => [b!.y, b!.height])).toEqual(before.map((b) => [b!.y, 32]));

  // With room, the whole name; short of room, an ellipsis; with none, no country. The message
  // stays whole, and the numbers keep their column.
  const [vk, qso, dl, dlLong] = await Promise.all(texts.map((t) => widths(page, t)));
  expect(vk.country![0]).toBe(vk.country![1]);
  expect(dl.country![0]).toBeGreaterThan(20);
  expect(dl.country![1]).toBeGreaterThan(dl.country![0]);
  await expect(row(page, 'CQ DX DL1ABC JO62').locator('.c-country > span')).toHaveCSS('text-overflow', 'ellipsis');
  await expect(row(page, 'CQ POTA DL1ABC/QRP JO62').locator('.c-country > span')).toBeHidden();
  for (const w of [vk, dl, dlLong]) expect(w.msg[0]).toBe(w.msg[1]);
  expect(new Set([vk, qso, dl, dlLong].map((w) => w.numbers)).size).toBe(1);
});
