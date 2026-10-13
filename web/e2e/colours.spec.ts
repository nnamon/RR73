// Settings › Decode colours: a colour change shows in Operate at once, the order decides which
// colour a decode takes, and a preset (WSJT-X or Quiet) acts on the first tap with Undo. Decodes come
// through the screen-review hooks (src/lib/testing/e2e-hooks.ts).
import { expect, test, type Locator, type Page } from '@playwright/test';

async function setUp(page: Page) {
  await page.goto('./#/settings');
  const field = page.getByRole('textbox', { name: 'Callsign' });
  await field.fill('9V1NE');
  await field.press('Enter');
  await page.getByRole('link', { name: 'Operate' }).click();
}

/** A slot of decodes that ended a moment ago. */
async function decoded(page: Page, texts: string[]) {
  await page.evaluate((ts) => {
    const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
    window.__rr73!.decoded(
      slot,
      ts.map((text, i) => ({ text, freq_hz: 600 + 150 * i, dt_s: 0.1, snr_db: -8 })),
    );
  }, texts);
}

const row = (page: Page, text: string) => page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) });
const order = (page: Page) => page.locator('.hl-list:not(.text-list) > li').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id));
const hlOf = (l: Locator) => l.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--rr-hl'));
const preset = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Preset' }).getByRole('radio', { name });
const choose = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Preset' }).getByText(name, { exact: true }).click();

/** sRGB channels 0 to 255 from a computed colour, rgb() or color(srgb ...). */
function channels(css: string): number[] {
  const n = [...css.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
  return css.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
}

async function toColours(page: Page) {
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Decode colours/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Decode colours' })).toBeVisible();
}

async function toOperate(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
}

/** Touch and hold a category's handle, then drag it onto another category's row, as on iOS. */
async function dragByTouch(page: Page, id: string, onto: string) {
  const grip = page.locator(`.hl-list > li[data-id="${id}"] .grip`);
  const g = (await grip.boundingBox())!;
  const t = (await page.locator(`.hl-list > li[data-id="${onto}"]`).boundingBox())!;
  const at = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  await grip.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, buttons: 1, clientX: at.x, clientY: at.y });
  await page.waitForTimeout(500);
  const to = t.y + t.height / 2 - 4;
  for (let i = 1; i <= 8; i++) {
    const y = at.y + ((to - at.y) * i) / 8;
    await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 7, isPrimary: true, buttons: 1, clientX: x, clientY: y, bubbles: true, cancelable: true })), [at.x, y]);
  }
  await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: y, bubbles: true })), [at.x, to]);
}

test('a colour change shows in Operate at once', async ({ page }) => {
  await setUp(page);
  await decoded(page, ['9V1NE JA1KXM PM95', 'CQ A41ZZ LL93']);
  const mine = row(page, '9V1NE JA1KXM PM95');
  await expect(mine).toHaveAttribute('data-hl', 'myCall');
  await expect(row(page, 'CQ A41ZZ LL93')).toHaveAttribute('data-hl', 'newGrid');
  const before = await mine.evaluate((el) => getComputedStyle(el).backgroundColor);
  const box = (await mine.boundingBox())!;

  await toColours(page);
  await page.getByRole('button', { name: 'Change colour: My call in the message' }).click();
  const sheet = page.getByRole('dialog', { name: 'My call in the message' });
  await expect(sheet.getByRole('button', { name: 'Red' })).toHaveAttribute('aria-pressed', 'true');
  // A palette tap applies the colour and closes the sheet: no Done step.
  await sheet.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: My call in the message' }))).toBe('#3399FF');
  // The example shows it too.
  await expect(page.getByTestId('colours-example').locator('[data-hl="myCall"]')).toHaveCount(1);
  expect(await hlOf(page.getByTestId('colours-example').locator('[data-hl="myCall"]'))).toBe('#3399FF');

  await toOperate(page);
  expect(await hlOf(mine)).toBe('#3399FF');
  const after = await mine.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).not.toBe(before);
  // The tint: 45% of #3399FF over white, as tokens.css mixes it in light.
  const want = [0x33, 0x99, 0xff].map((c) => c * 0.45 + 255 * 0.55);
  channels(after).forEach((c, i) => expect(Math.abs(c - want[i])).toBeLessThan(1.5));
  // Same row box: a colour change moves nothing.
  expect(await mine.boundingBox()).toEqual(box);

  // Worked before greys the text over the CQ background: log 9M2TRX, then its CQ.
  await page.evaluate(() => window.__rr73!.logged({ call: '9M2TRX', grid: 'OJ02', band: '20m', mode: 'FT8', dialHz: 14_074_000, audioHz: 1500, startUtcMs: Date.now() - 120_000, endUtcMs: Date.now() - 60_000, reportSent: -10, reportRcvd: -12 }));
  await decoded(page, ['CQ 9M2TRX OJ02']);
  const worked = row(page, 'CQ 9M2TRX OJ02');
  await expect(worked).toHaveAttribute('data-hl', 'cq');
  await expect(worked).toHaveAttribute('data-ink', 'worked');
  const [fg, label] = await worked.evaluate((el) => [getComputedStyle(el.querySelector('.c-msg')!).color, getComputedStyle(document.body).color]);
  expect(fg).not.toBe(label);
  await toColours(page);
  await page.getByRole('switch', { name: 'Worked before' }).uncheck();
  await toOperate(page);
  await expect(worked).not.toHaveAttribute('data-ink');
  await expect(worked).toHaveAttribute('data-hl', 'cq');

  // The custom colour picker applies as it changes.
  await toColours(page);
  await page.getByRole('button', { name: 'Change colour: CQ in the message' }).click();
  await page.getByRole('dialog', { name: 'CQ in the message' }).getByLabel('Custom colour').fill('#123456');
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#123456');
});

test('the order decides which colour a decode takes', async ({ page }) => {
  await setUp(page);
  await decoded(page, ['CQ A41ZZ LL93', 'JA8HCE A41ZZ RR73']);
  const cq = row(page, 'CQ A41ZZ LL93');
  await expect(cq).toHaveAttribute('data-hl', 'newGrid');
  await expect(row(page, 'JA8HCE A41ZZ RR73')).toHaveAttribute('data-hl', 'newCall');

  // Touch and hold CQ in the message, then drag it to the top.
  await toColours(page);
  expect((await order(page))[0]).toBe('myCall');
  await dragByTouch(page, 'cq', 'myCall');
  expect(await order(page)).toEqual(['cq', 'myCall', 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'sent']);
  await expect(page.getByRole('status').filter({ hasText: 'CQ in the message moved to 1 of 8.' })).toBeAttached();
  await toOperate(page);
  await expect(cq).toHaveAttribute('data-hl', 'cq');

  // A mouse drags at once: Ending a QSO above New call.
  await toColours(page);
  const grip = (await page.locator('.hl-list > li[data-id="ending"] .grip').boundingBox())!;
  const target = (await page.locator('.hl-list > li[data-id="newCall"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + target.height / 2 - 4, { steps: 8 });
  await page.mouse.up();
  expect((await order(page)).indexOf('ending')).toBe((await order(page)).indexOf('newCall') - 1);
  await toOperate(page);
  await expect(row(page, 'JA8HCE A41ZZ RR73')).toHaveAttribute('data-hl', 'ending');

  // Move up and Move down, for VoiceOver and keyboards: shown when focused, focus stays with the row.
  await toColours(page);
  const down = page.getByRole('button', { name: 'Move CQ in the message down' });
  await down.focus();
  expect((await down.boundingBox())!.width).toBeGreaterThanOrEqual(43.5);
  await page.keyboard.press('Enter');
  expect((await order(page)).slice(0, 2)).toEqual(['myCall', 'cq']);
  await expect(down).toBeFocused();
  await page.getByRole('button', { name: 'Move CQ in the message up' }).click();
  expect((await order(page))[0]).toBe('cq');
  await expect(page.getByRole('button', { name: 'Move CQ in the message up' })).toBeDisabled();
});

test('the WSJT-X preset acts on the first tap and offers Undo', async ({ page }) => {
  await page.goto('./#/settings');
  const link = page.getByRole('link', { name: /^Decode colours/ });
  await expect(link).toContainText('WSJT-X');
  await link.click();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
  await expect(preset(page, 'WSJT-X')).toBeChecked();
  await expect(preset(page, 'Custom')).toBeDisabled();
  const defaults = await order(page);

  // Change all three: a switch, a colour and the order.
  await page.getByRole('switch', { name: 'New call', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Change colour: CQ in the message' }).click();
  await page.getByRole('dialog', { name: 'CQ in the message' }).getByRole('button', { name: 'Magenta' }).click();
  await page.getByRole('button', { name: 'Move Sent up' }).focus();
  await page.keyboard.press('Enter');
  const changed = await order(page);
  expect(changed).not.toEqual(defaults);
  await expect(preset(page, 'Custom')).toBeChecked();

  await choose(page, 'WSJT-X');
  // No confirmation: the defaults are back at once, with Undo in a notice.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await order(page)).toEqual(defaults);
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).toBeChecked();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#66FF66');
  await expect(preset(page, 'WSJT-X')).toBeChecked();
  const notice = page.getByTestId('colours-notice');
  await expect(notice).toContainText('WSJT-X preset applied.');

  await notice.getByRole('button', { name: 'Undo the WSJT-X preset' }).click();
  await expect(notice).toBeHidden();
  expect(await order(page)).toEqual(changed);
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).not.toBeChecked();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#FF00FF');

  // Stored: a reload keeps the operator's colours.
  await page.reload();
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).not.toBeChecked();
  expect(await order(page)).toEqual(changed);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Decode colours/ })).toContainText('Custom');
});

test('the Quiet preset keeps CQ green and turns the new-station colours off, with Undo', async ({ page }) => {
  await page.goto('./#/settings/colours');
  const example = page.getByTestId('colours-example');
  const fresh = '[data-hl="newGrid"], [data-hl="newGridBand"], [data-hl="newCall"], [data-hl="newCallBand"]';
  await expect(example.locator(fresh)).toHaveCount(4);
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(1);
  await expect(example.locator('[data-ink="worked"]')).toHaveCount(2);

  await choose(page, 'Quiet');
  await expect(preset(page, 'Quiet')).toBeChecked();
  // The five CQ rows are green: no row keeps a new grid or new call colour, and no text greys as worked before.
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(5);
  for (const r of await example.locator('[data-hl="cq"]').all()) expect(await hlOf(r)).toBe('#66FF66');
  await expect(example.locator(fresh)).toHaveCount(0);
  await expect(example.locator('[data-ink="worked"]')).toHaveCount(0);
  for (const name of ['New grid', 'New grid on this band', 'New call', 'New call on this band', 'Worked before']) await expect(page.getByRole('switch', { name, exact: true })).not.toBeChecked();
  for (const name of ['My call in the message', 'Ending a QSO', 'CQ in the message', 'Sent']) await expect(page.getByRole('switch', { name, exact: true })).toBeChecked();

  const notice = page.getByTestId('colours-notice');
  await expect(notice).toContainText('Quiet preset applied.');
  await notice.getByRole('button', { name: 'Undo the Quiet preset' }).click();
  await expect(notice).toBeHidden();
  await expect(preset(page, 'WSJT-X')).toBeChecked();
  await expect(example.locator(fresh)).toHaveCount(4);
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(1);

  // Chosen again, Settings names it.
  await choose(page, 'Quiet');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Decode colours/ })).toContainText('Quiet');
});
