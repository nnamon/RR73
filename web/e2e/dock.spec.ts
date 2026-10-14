// The bottom bar: one row of controls that act on the first tap, the status line while calling
// or in a QSO, and the ••• menu. Taps that can lead to a transmission play a silent clip through
// a media element inside the tap, so iOS does not mute output on the silent switch; Halt and the
// taps that turn things off play nothing. Decodes come through the screen-review hooks.
import { expect, test, type Locator, type Page } from '@playwright/test';

async function setUp(page: Page) {
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('link', { name: 'Operate' }).click();
  return page.getByRole('region', { name: 'Transmit' });
}

/** Halt's face: its fill, text colour and edge. */
function haltLook(bar: Locator) {
  return bar
    .getByRole('button', { name: 'Halt' })
    .locator('.face')
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fill: cs.backgroundColor, text: cs.color, edge: cs.boxShadow };
    });
}

/** sRGB channels and alpha of a computed colour. */
const channels = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);

/** A slot of decodes that ended a moment ago. */
async function decoded(page: Page, texts: [string, number][]) {
  await page.evaluate((ds) => {
    const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
    window.__rr73!.decoded(
      slot,
      ds.map(([text, hz]) => ({ text, freq_hz: hz, dt_s: 0.1, snr_db: -8 })),
    );
  }, texts);
}

const row = (page: Page, text: string) => page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) });

test('CQ, Tx on and Hunt each play the silent clip inside the tap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __clips: number };
    w.__clips = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__clips++;
      return play.call(this);
    };
  });
  const clips = () => page.evaluate(() => (window as unknown as { __clips: number }).__clips);
  const bar = await setUp(page);
  expect(await clips()).toBe(0);

  // No band confirmation: CQ turns Tx on at once.
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  expect(await clips()).toBe(1);
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Tx on' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Tx on' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toHaveAttribute('aria-pressed', 'false');
  expect(await clips()).toBe(1);
  await bar.getByRole('button', { name: 'Tx off' }).click();
  await expect(bar.getByRole('button', { name: 'Tx on' })).toBeVisible();
  expect(await clips()).toBe(2);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await clips()).toBe(2);

  // Hunt turns Tx on and stops CQ.
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await bar.getByRole('button', { name: 'Hunt', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(bar.getByRole('button', { name: 'Tx on' })).toHaveAttribute('aria-pressed', 'true');
  expect(await clips()).toBe(4);
  await bar.getByRole('button', { name: 'Hunt', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  expect(await clips()).toBe(4);
});

test('a double-tap on a decode calls the station with Tx on at once, and ends CQ', async ({ page }) => {
  const bar = await setUp(page);
  const idle = await haltLook(bar);
  await decoded(page, [
    ['CQ VJ6X OF78', 506],
    ['BH1LKO VK4SHG 73', 1641],
  ]);
  // A tap selects and says how to call; a second tap on the selected row clears it.
  await row(page, 'CQ VJ6X OF78').click();
  await expect(row(page, 'CQ VJ6X OF78')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('status')).toContainText('VJ6X · OF78');
  await expect(bar.getByRole('status')).toContainText('Double-tap to call');
  await page.waitForTimeout(500);
  await row(page, 'CQ VJ6X OF78').click();
  await expect(row(page, 'CQ VJ6X OF78')).toHaveAttribute('aria-pressed', 'false');
  await expect(bar.getByRole('status')).toHaveText('');

  await row(page, 'CQ VJ6X OF78').dblclick();
  await expect(bar.getByRole('button', { name: 'Tx on' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toBeVisible();
  // Rx moves to the station; Hold Tx keeps Tx. Audio is off here, so the bar says why nothing goes out.
  await expect(page.getByRole('slider', { name: 'Receive frequency, Hz' })).toHaveValue('505');
  await expect(bar.getByRole('status')).toContainText('Audio off');
  // Halt is a red tint with red text, the same as before the call: the Tx button carries the state.
  expect(await haltLook(bar)).toEqual(idle);
  expect(idle.edge).toBe('none');
  const [r, g, b, a] = channels(idle.fill);
  expect(a).toBeGreaterThan(0);
  expect(r).toBeGreaterThan(Math.max(g, b) + 100);
  const [tr, tg, tb] = channels(idle.text);
  expect(tr).toBeGreaterThan(Math.max(tg, tb) + 100);

  // While calling CQ, a double-tap on another station's CQ turns CQ off and takes the answering
  // steps; the sequencer's tests check that CQ does not come back (qso/sequencer.test.ts).
  await bar.getByRole('button', { name: 'Halt' }).click();
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/CQ.*Report.*R-report.*RR73.*Logged/);
  await decoded(page, [
    ['CQ VJ6X OF78', 506],
    ['CQ A41ZZ LL93', 956],
  ]);
  await row(page, 'CQ A41ZZ LL93').dblclick();
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(bar.getByRole('button', { name: 'Tx on' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/Grid.*Report.*R-report.*RR73.*73/);
});

test('the ••• menu holds the rest, acts on the first tap and closes with Escape', async ({ page }) => {
  const bar = await setUp(page);
  const more = bar.getByRole('button', { name: 'More' });
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'More' });
  const items = menu.getByRole('menuitem').or(menu.getByRole('menuitemcheckbox'));
  await expect(items).toHaveText(['Edit messages', 'Find clear Tx', 'Tune for 10 s', 'Clear decodes', 'Repeat CQ Off', 'Hound Off', 'Answer order First', 'Work dupes Off', 'Transmit in 1st', 'Hunt order Not worked']);
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();

  // Values change in place; the menu stays open.
  await menu.getByRole('menuitem', { name: /^Transmit in/ }).click();
  await expect(menu.getByRole('menuitem', { name: /^Transmit in/ })).toHaveText('Transmit in 2nd');
  await menu.getByRole('menuitem', { name: /^Answer order/ }).click();
  await expect(menu.getByRole('menuitem', { name: /^Answer order/ })).toHaveText('Answer order Strongest');
  await menu.getByRole('menuitemcheckbox', { name: /^Work dupes/ }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Work dupes/ })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitem', { name: /^Hunt order/ }).click();
  await expect(menu.getByRole('menuitem', { name: /^Hunt order/ })).toHaveText('Hunt order Strongest');
  // Run is a setting: it starts nothing.
  await menu.getByRole('menuitemcheckbox', { name: /^Repeat CQ/ }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Repeat CQ/ })).toHaveText('Repeat CQ On');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  // Hound is a switch for the band: the top bar shows it.
  await menu.getByRole('menuitemcheckbox', { name: /^Hound/ }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Hound/ })).toHaveText('Hound On');
  await expect(page.locator('header.top .mode')).toHaveText('FT8 Hound');
  await menu.getByRole('menuitemcheckbox', { name: /^Hound/ }).click();
  await expect(page.locator('header.top .mode')).toHaveText('FT8');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // Clear decodes empties the list and its selection at once.
  await decoded(page, [['CQ VK2LAW QF56', 1200]]);
  await row(page, 'CQ VK2LAW QF56').click();
  await more.click();
  await menu.getByRole('menuitem', { name: 'Clear decodes' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('decode-list').locator('button.dr')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^All/ })).toHaveText('All 0');
  await expect(bar.getByRole('status')).toHaveText('Decodes cleared');

  // Edit messages opens the Messages sheet.
  await more.click();
  await menu.getByRole('menuitem', { name: 'Edit messages' }).click();
  await expect(page.getByRole('dialog', { name: 'Messages' })).toBeVisible();
  await page.keyboard.press('Escape');

  // CQ with Run on: Stop after this QSO; with a QSO under way, End QSO goes back to idle.
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await more.click();
  const stop = menu.getByRole('menuitemcheckbox', { name: 'Stop after this QSO' });
  await stop.click();
  await expect(stop).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitem', { name: 'End QSO' }).click();
  await expect(menu).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'CQ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  // The choices are stored.
  await page.waitForTimeout(500);
  await page.reload();
  await bar.getByRole('button', { name: 'More' }).click();
  await expect(menu.getByRole('menuitem', { name: /^Transmit in/ })).toHaveText('Transmit in 2nd');
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Repeat CQ/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: /^Hunt order/ })).toHaveText('Hunt order Strongest');
});

test('Tune in the ••• menu starts at once, shows in the bar, and Halt stops it', async ({ page }) => {
  const bar = await setUp(page);
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Tune for 10 s' }).click();
  await expect(bar.getByRole('status')).toContainText('Tune');
  await expect(bar.getByRole('status')).toContainText('1500 Hz');
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible();
  await expect(page.getByRole('timer', { name: /Tuning$/ })).toBeVisible();
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('status')).toHaveText('');
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
});
