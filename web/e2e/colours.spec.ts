// Settings › Decode colours: a colour change shows in Operate at once, the order decides which
// colour a decode takes, and a preset (RR73, Quiet, WSJT-X or an editor scheme) acts on the first
// tap with Undo. Decodes come through the screen-review hooks (src/lib/testing/e2e-hooks.ts).
//
// The DXCC, continent and zone categories need the country file, which CI serves and a local run
// may not. These tests run without it, but the one for New DXCC, which serves the file converted
// by the test helper.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { bigCtyFixture } from '../src/lib/reference/testing';

test.beforeEach(async ({ page }) => {
  await page.route('**/data/cty.json', (route) => route.fulfill({ status: 404, body: '' }));
});

/** The DXCC, continent and zone categories, as Settings names them. */
const PLACES = ['New continent', 'New continent on this band', 'New CQ zone', 'New CQ zone on this band', 'New ITU zone', 'New ITU zone on this band', 'New DXCC entity', 'New DXCC entity on this band'];

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
  // Operate's pane shows a moment after the route changes; a hidden row has no box to measure.
  await expect(page.getByTestId('decode-list')).toBeVisible();
}

/** Whether the stored decode colours have the category on, read from IndexedDB. */
function storedOn(page: Page, id: string): Promise<boolean | null> {
  return page.evaluate(
    (key) =>
      new Promise((resolve) => {
        const req = indexedDB.open('rr73');
        req.onsuccess = () => {
          const get = req.result.transaction('kv').objectStore('kv').get('settings');
          get.onsuccess = () => {
            req.result.close();
            const hl = (get.result?.value?.highlights ?? []) as { id: string; on: boolean }[];
            resolve(hl.find((h) => h.id === key)?.on ?? null);
          };
        };
      }),
    id,
  );
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
  await expect(sheet.getByRole('button', { name: 'Vermillion' })).toHaveAttribute('aria-pressed', 'true');
  // A palette tap applies the colour and closes the sheet: no Done step.
  await sheet.getByRole('button', { name: 'Sky blue', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: My call in the message' }))).toBe('#56B4E9');
  // The example shows it too.
  await expect(page.getByTestId('colours-example').locator('[data-hl="myCall"]')).toHaveCount(1);
  expect(await hlOf(page.getByTestId('colours-example').locator('[data-hl="myCall"]'))).toBe('#56B4E9');

  await toOperate(page);
  expect(await hlOf(mine)).toBe('#56B4E9');
  const after = await mine.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).not.toBe(before);
  // The tint: 45% of #56B4E9 over white, as tokens.css mixes it in light.
  const want = [0x56, 0xb4, 0xe9].map((c) => c * 0.45 + 255 * 0.55);
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
  const places = ['newContinent', 'newContinentBand', 'newCqZone', 'newCqZoneBand', 'newItuZone', 'newItuZoneBand', 'newDxcc', 'newDxccBand'];
  expect(await order(page)).toEqual(['cq', 'myCall', ...places, 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'sent']);
  await expect(page.getByRole('status').filter({ hasText: 'CQ in the message moved to 1 of 16.' })).toBeAttached();
  await toOperate(page);
  await expect(cq).toHaveAttribute('data-hl', 'cq');

  // A mouse drags at once: Ending a QSO above New call.
  await toColours(page);
  // The screen opens at the top; bring both rows into view before measuring them.
  await page.locator('.hl-list > li[data-id="ending"]').scrollIntoViewIfNeeded();
  await page.locator('.hl-list > li[data-id="newCall"]').scrollIntoViewIfNeeded();
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

test('the RR73 preset acts on the first tap and offers Undo', async ({ page }) => {
  await page.goto('./#/settings');
  const link = page.getByRole('link', { name: /^Decode colours/ });
  await expect(link).toContainText('RR73');
  await link.click();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
  await expect(preset(page, 'RR73')).toBeChecked();
  await expect(preset(page, 'Custom')).toBeDisabled();
  const defaults = await order(page);

  // Change all three: a switch, a colour and the order.
  await page.getByRole('switch', { name: 'New call', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Change colour: CQ in the message' }).click();
  await page.getByRole('dialog', { name: 'CQ in the message' }).getByRole('button', { name: 'Bright yellow' }).click();
  await page.getByRole('button', { name: 'Move Sent up' }).focus();
  await page.keyboard.press('Enter');
  const changed = await order(page);
  expect(changed).not.toEqual(defaults);
  await expect(preset(page, 'Custom')).toBeChecked();

  await choose(page, 'RR73');
  // No confirmation: the defaults are back at once, with Undo in a notice.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await order(page)).toEqual(defaults);
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).toBeChecked();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#009E73');
  await expect(preset(page, 'RR73')).toBeChecked();
  const notice = page.getByTestId('colours-notice');
  await expect(notice).toContainText('RR73 preset applied.');

  await notice.getByRole('button', { name: 'Undo the RR73 preset' }).click();
  await expect(notice).toBeHidden();
  expect(await order(page)).toEqual(changed);
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).not.toBeChecked();
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#FFFF00');

  // Stored: a reload keeps the operator's colours, once the Undo has reached storage.
  await expect.poll(() => storedOn(page, 'newCall')).toBe(false);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'New call', exact: true })).not.toBeChecked();
  expect(await order(page)).toEqual(changed);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Decode colours/ })).toContainText('Custom');
});

test('the Quiet preset keeps CQ coloured and turns the new-station colours off, with Undo', async ({ page }) => {
  await page.goto('./#/settings/colours');
  const example = page.getByTestId('colours-example');
  const fresh = '[data-hl="newGrid"], [data-hl="newGridBand"], [data-hl="newCall"], [data-hl="newCallBand"]';
  await expect(example.locator(fresh)).toHaveCount(4);
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(1);
  await expect(example.locator('[data-ink="worked"]')).toHaveCount(2);

  await choose(page, 'Quiet');
  await expect(preset(page, 'Quiet')).toBeChecked();
  // The five CQ rows take the CQ colour: no row keeps a new grid or new call colour, and no text greys as worked before.
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(5);
  for (const r of await example.locator('[data-hl="cq"]').all()) expect(await hlOf(r)).toBe('#009E73');
  await expect(example.locator(fresh)).toHaveCount(0);
  await expect(example.locator('[data-ink="worked"]')).toHaveCount(0);
  for (const name of [...PLACES, 'New grid', 'New grid on this band', 'New call', 'New call on this band', 'Worked before']) await expect(page.getByRole('switch', { name, exact: true })).not.toBeChecked();
  for (const name of ['My call in the message', 'Ending a QSO', 'CQ in the message', 'Sent']) await expect(page.getByRole('switch', { name, exact: true })).toBeChecked();

  const notice = page.getByTestId('colours-notice');
  await expect(notice).toContainText('Quiet preset applied.');
  await notice.getByRole('button', { name: 'Undo the Quiet preset' }).click();
  await expect(notice).toBeHidden();
  await expect(preset(page, 'RR73')).toBeChecked();
  await expect(example.locator(fresh)).toHaveCount(4);
  await expect(example.locator('[data-hl="cq"]')).toHaveCount(1);

  // Chosen again, Settings names it.
  await choose(page, 'Quiet');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Decode colours/ })).toContainText('Quiet');
});

test('the WSJT-X preset takes WSJT-X’s own colours and switches', async ({ page }) => {
  await page.goto('./#/settings/colours');
  const example = page.getByTestId('colours-example');
  await choose(page, 'WSJT-X');
  await expect(preset(page, 'WSJT-X')).toBeChecked();
  // CQ green, Sent yellow, the ITU zone and new-station categories and the 2 RR73-only ones off.
  for (const r of await example.locator('[data-hl="cq"]').all()) expect(await hlOf(r)).toBe('#66FF66');
  expect(await hlOf(example.locator('[data-hl="sent"]'))).toBe('#FFFF00');
  expect(await hlOf(example.locator('[data-hl="myCall"]'))).toBe('#FF6666');
  // WSJT-X's switches, but New DXCC off, as in every scheme.
  for (const name of ['New ITU zone', 'New ITU zone on this band', 'New DXCC entity', 'New DXCC entity on this band', 'New grid', 'New grid on this band', 'New call', 'New call on this band', 'Ending a QSO', 'Worked before']) await expect(page.getByRole('switch', { name, exact: true })).not.toBeChecked();
  for (const name of ['My call in the message', 'New continent', 'New continent on this band', 'New CQ zone', 'New CQ zone on this band', 'CQ in the message', 'Sent']) await expect(page.getByRole('switch', { name, exact: true })).toBeChecked();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /^Decode colours/ })).toContainText('WSJT-X');
});

test('each editor scheme applies with RR73’s switches: every category on but the place categories', async ({ page }) => {
  await page.goto('./#/settings/colours');
  const off = PLACES;
  for (const name of ['Monokai', 'Solarized', 'Dracula', 'Nord', 'Gruvbox']) {
    await choose(page, name);
    await expect(preset(page, name)).toBeChecked();
    for (const sw of await page.locator('.hl-list').getByRole('switch').all()) {
      const label = (await sw.getAttribute('aria-label')) ?? '';
      if (off.includes(label)) await expect(sw, label).not.toBeChecked();
      else await expect(sw, label).toBeChecked();
    }
  }
  expect(await hlOf(page.getByRole('button', { name: 'Change colour: CQ in the message' }))).toBe('#8EC07C');
});

test('a CQ from a DXCC entity the log lacks takes New DXCC, once the country file has loaded', async ({ page }) => {
  const cty = JSON.stringify(bigCtyFixture());
  await page.route('**/data/cty.json', (route) => route.fulfill({ body: cty, contentType: 'application/json' }));
  await setUp(page);
  // New DXCC is off by default: on, as an operator turns it on.
  await toColours(page);
  await page.getByRole('switch', { name: 'New DXCC entity', exact: true }).check();
  await toOperate(page);
  await decoded(page, ['CQ A41ZZ LL93', 'CQ JA1KXM PM95']);
  const oman = row(page, 'CQ A41ZZ LL93');
  await expect(oman).toHaveAttribute('data-hl', 'newDxcc');
  expect(await hlOf(oman)).toBe('#FF00FF');

  // A QSO with Oman, in another grid: the CQ is a new grid now, and Japan stays a new entity.
  await page.evaluate(() => window.__rr73!.logged({ call: 'A45XR', grid: 'LL72', band: '20m', mode: 'FT8', dialHz: 14_074_000, audioHz: 1500, startUtcMs: Date.now() - 120_000, endUtcMs: Date.now() - 60_000, reportSent: -10, reportRcvd: -12 }));
  await expect(oman).toHaveAttribute('data-hl', 'newGrid');
  await expect(row(page, 'CQ JA1KXM PM95')).toHaveAttribute('data-hl', 'newDxcc');
});

test('Show legend draws each row style with its meaning and stays as set', async ({ page }) => {
  await setUp(page);
  await toColours(page);
  await page.getByRole('switch', { name: 'Show legend' }).check();
  await expect(page.getByRole('heading', { name: 'Highlight' })).toHaveCount(0);

  // The colours in the operator's order, enabled ones only: RR73's scheme leaves New DXCC off.
  const colours = page.getByTestId('legend-colours');
  await expect(colours.locator('li.lg').first()).toHaveAttribute('data-key', 'myCall');
  await expect(colours.locator('li.lg[data-key="newDxcc"]')).toHaveCount(0);
  await expect(colours.locator('li.lg[data-key="cq"] .dr')).toHaveAttribute('data-hl', 'cq');
  await expect(colours.locator('li.lg[data-key="myCall"] .dr')).toHaveClass(/to-you/);

  const worked = page.getByTestId('legend-worked');
  await expect(worked.locator('li.lg[data-key="dupe"] .dr')).toHaveClass(/\bdupe\b/);
  await expect(worked.locator('li.lg[data-key="dupe"] .dr')).toHaveAttribute('data-ink', 'worked');
  await expect(worked.locator('li.lg[data-key="before"] .dr')).toHaveClass(/\bbefore\b/);
  // Worked on another day: the right edge takes the New call colour, RR73's #0072B2.
  expect(await worked.locator('li.lg[data-key="before"] .dr').evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(0, 114, 178)');

  const rows = page.getByTestId('legend-rows');
  await expect(rows.locator('li.lg[data-key="next"] .c-tag')).toHaveText('Next · :45');
  await expect(rows.locator('li.lg[data-key="sending"] .c-tag')).toHaveText('Sending');
  await expect(rows.locator('li.lg[data-key="old"] .dr')).toHaveClass(/\bold\b/);
  await expect(rows.locator('li.lg[data-key="dim"] .dr')).toHaveClass(/\bdim\b/);

  const tags = page.getByTestId('legend-tags');
  await expect(tags.locator('li.lg[data-key="lost"] .c-lost')).toHaveText('Lost');
  await expect(tags.locator('li.lg[data-key="queue"] .c-queue')).toHaveText('Next');
  await expect(tags.locator('li.lg[data-key="queue-dupe"] .c-queue')).toHaveText('Dupe');
  await expect(tags.getByTestId('chase-tag')).toHaveText('US-0817');

  // A colour turned off leaves the legend; grey text goes with Worked before.
  await page.getByRole('switch', { name: 'Show legend' }).uncheck();
  await page.getByRole('switch', { name: 'Worked before' }).uncheck();
  await page.getByRole('switch', { name: 'CQ in the message' }).uncheck();
  await page.getByRole('switch', { name: 'Show legend' }).check();
  await expect(colours.locator('li.lg[data-key="cq"]')).toHaveCount(0);
  await expect(worked.locator('li.lg[data-key="dupe"] .dr')).not.toHaveAttribute('data-ink', 'worked');

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Show legend' })).toBeChecked();
  await expect(page.getByTestId('legend-worked')).toBeVisible();
});
