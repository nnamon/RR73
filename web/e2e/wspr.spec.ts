// WSPR in Operate on iPhone viewports in WebKit, with spots injected through the screen-review
// hooks and the page clock held at the moments of the approved mockup (docs/design/wspr.md),
// 20m from 9V1NE in OJ11 on 14 October 2026: the band sheet's WSPR dial, the top bar, the
// 200 Hz ruler, the spot list farthest first, the beacon waiting for its slot with a Next row,
// on air, a slot with spots under the Sent row, the ••• menu and a spot's details. Nothing is
// transmitted: the beacon goes off with Halt before its slot, and on air is shown through a hook.
// CI runs it in light at 375 x 667; the review projects run both themes at both sizes and save
// the screens to test-results/screens/wspr.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkLayout, ci, shot } from './layout-checks';
import { INSETS } from './operate-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/wspr', import.meta.url));

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);

/** Stations of the mockup: grid and audio frequency, Hz. */
const ST: Record<string, [string, number]> = {
  VK6XLR: ['OF78', 1462], JA5NVN: ['PM74', 1531], BH4XDZ: ['PM01', 1417], VK2ZT: ['QF56', 1489], ZL1RS: ['RF73', 1552],
  DU1IVT: ['PK04', 1508], HS1FVL: ['OK03', 1443], '4X1RF': ['KM72', 1571], G4ZFQ: ['IO90', 1426], BV2DD: ['PL05', 1478],
  VK4YEH: ['QG62', 1586], JH1ICD: ['PM95', 1521], '9M2KG': ['OJ03', 1454], VU2NSB: ['MK82', 1539], DK6UG: ['JN49', 1594],
  ZL2BRG: ['RE78', 1563], YB0MWM: ['OI33', 1434], VR2XAN: ['OL72', 1514], VK3ZPF: ['QF22', 1470], JA7TKT: ['QM07', 1545],
  VK5ZOM: ['PF95', 1528],
};
type S = [string, number, number, number];
/** Spots per slot, minutes past 14:00: callsign, dBm, SNR (dB) and drift over the transmission (Hz). */
const SPOTS: Record<number, S[]> = {
  0: [['VK5ZOM', 30, -18, 0], ['BH4XDZ', 30, -20, -1], ['HS1FVL', 23, -14, 0], ['VK2ZT', 37, -17, 0], ['ZL1RS', 37, -26, 1], ['G4ZFQ', 30, -28, 0]],
  2: [['VK6XLR', 37, -13, 0], ['ZL2BRG', 23, -23, 0], ['YB0MWM', 30, -15, 0], ['VR2XAN', 33, -20, 0], ['VK3ZPF', 37, -19, 1], ['JA7TKT', 23, -24, 1], ['4X1RF', 37, -27, 0], ['DU1IVT', 30, -10, 0]],
  8: [['VK6XLR', 37, -14, 0], ['JA5NVN', 23, -22, 0], ['BH4XDZ', 30, -19, -1], ['VK2ZT', 37, -18, 0], ['ZL1RS', 37, -24, 1], ['DU1IVT', 30, -11, 0], ['HS1FVL', 23, -16, 0], ['4X1RF', 37, -26, 0], ['G4ZFQ', 30, -28, -1]],
};

async function spots(page: Page, minute: number) {
  const decodes = SPOTS[minute].map(([call, dbm, snr, drift]) => ({ text: `${call} ${ST[call][0]} ${dbm}`, freq_hz: ST[call][1], dt_s: 0.2, drift_hz_per_s: drift / 110.6, snr_db: snr }));
  await page.evaluate(([s, ds]) => window.__rr73!.wsprDecoded(s as number, ds as never), [at(14, minute), decodes] as const);
}

/** Operate with the device's insets, in `theme`, as 9V1NE in OJ11vi, with audio on. */
async function openOperate(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[page.viewportSize()!.width]);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', '9V1NE'],
    ['Grid', 'OJ11vi'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('link', { name: 'Operate' }).click();
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
}

const list = (page: Page) => page.getByTestId('spot-list');
const calls = (page: Page) => list(page).locator('button.sr .call').allTextContents();

for (const theme of ['light', 'dark'] as const) {
  test(`WSPR in Operate: spots farthest first, the beacon and its slots, in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    await page.clock.setFixedTime(at(14, 5, 12));
    await openOperate(page, theme);

    // The band sheet: WSPR is a third mode, with WSPRnet's dial; 2m has WSPR only.
    await page.getByRole('button', { name: /^Change band/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Change band' });
    await sheet.getByText('WSPR', { exact: true }).click();
    await expect(sheet.getByText('14.0956 MHz')).toBeVisible();
    await expect(sheet.getByRole('radio', { name: '2m', exact: true })).toBeEnabled();
    await shot(page, info, SHOTS, `${theme}-band`, 400);
    await sheet.getByText('FT8', { exact: true }).click();
    await expect(sheet.getByRole('radio', { name: '2m', exact: true })).toBeDisabled();
    await sheet.getByText('WSPR', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Operate in WSPR: the dial to four decimals, a 200 Hz ruler, the WSPR controls.
    await expect(page.getByRole('button', { name: /^Change band/ })).toHaveAccessibleName(/20m WSPR, 14\.0956 MHz USB/);
    await expect(page.locator('.ruler .rl')).toHaveText(['1400', '1450', '1500', '1550', '1600']);
    const bar = page.getByRole('region', { name: 'Beacon' });
    await expect(bar.getByRole('button', { name: 'Beacon' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Halt' })).toBeVisible();
    await expect(bar.getByRole('status')).toHaveText(/9V1NE OJ11 37 · 1500 Hz\s*Beacon off/);

    // Listening at 14:05:12: two slots of spots, each farthest first; the older one fades.
    await spots(page, 0);
    await spots(page, 2);
    await expect(list(page).locator('li.slot-bar')).toHaveText([/14:04\s*receiving, spots at 14:06/, /14:02\s*8 spots/, /14:00\s*6 spots/]);
    expect((await calls(page)).slice(0, 8)).toEqual(['ZL2BRG', '4X1RF', 'VK3ZPF', 'JA7TKT', 'VK6XLR', 'VR2XAN', 'DU1IVT', 'YB0MWM']);
    await expect(list(page).locator('button.sr').first()).toHaveAccessibleName('ZL2BRG, RE78, 8558 km, 23 dBm, −23 dB, drift 0 Hz');
    await expect(list(page).locator('button.sr.old')).toHaveCount(6);
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-listen`);

    // Beacon on at 14:05:28: the next slot is the Tx slot, so Next counts down at the top.
    // The beacon's gaps come from Math.random: 0 draws a gap of one slot, so it takes the next one.
    await page.clock.setFixedTime(at(14, 5, 28));
    await page.evaluate(() => {
      const random = Math.random;
      Math.random = () => 0;
      setTimeout(() => (Math.random = random), 500);
    });
    await bar.getByRole('button', { name: 'Beacon' }).click();
    await expect(bar.getByRole('button', { name: 'Tx at :06' })).toHaveAttribute('aria-pressed', 'true');
    await expect(bar.getByRole('status')).toHaveText(/Stops at 15:05/);
    await expect(page.getByTestId('wspr-next')).toHaveText(/Next\s*9V1NE OJ11 37\s*in 0:33/);
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-beacon`, 300);

    // The Tx percentage menu: a choice applies at once.
    await bar.getByRole('button', { name: '20%' }).click();
    await expect(page.getByRole('menu', { name: 'Tx percentage' }).getByRole('menuitemradio', { name: '20%' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, info, SHOTS, `${theme}-percent`, 300);
    await page.getByRole('menu', { name: 'Tx percentage' }).getByRole('menuitemradio', { name: '25%' }).click();
    await expect(bar.getByRole('button', { name: '25%' })).toBeVisible();

    // Halt ends it in one tap, before anything is sent.
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Beacon' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('wspr-next')).toHaveCount(0);

    // On air at 14:06:47 (shown through the hook; no audio plays).
    await page.clock.setFixedTime(at(14, 6, 47));
    await page.evaluate((s) => window.__rr73!.wsprOnAir(s, '9V1NE OJ11 37'), at(14, 6));
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible();
    await expect(page.getByTestId('wspr-sending')).toHaveText(/Sending\s*9V1NE OJ11 37\s*1500 Hz/);
    await expect(bar.getByRole('status')).toHaveText(/9V1NE OJ11 37 · 1500 Hz\s*1:05 left/);
    await shot(page, info, SHOTS, `${theme}-air`, 300);

    // 14:10:04: the slot after the transmission has its spots, above the Sent row.
    await page.evaluate((s) => {
      window.__rr73!.wsprOnAir(s, null);
      window.__rr73!.wsprSent(s, '9V1NE OJ11 37');
    }, at(14, 6));
    await page.clock.setFixedTime(at(14, 10, 4));
    await spots(page, 8);
    await expect(list(page).locator('li.slot-bar').first()).toHaveText(/14:10\s*receiving, spots at 14:12/);
    await expect(list(page).locator('li.slot-bar').nth(1)).toHaveText(/14:08\s*9 spots/);
    await expect(page.getByTestId('wspr-sent')).toHaveText(/Sent\s*9V1NE OJ11 37\s*1500 Hz/);
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-spots`);

    // A tap selects a spot and marks its trace; the order changes from the ••• menu.
    await list(page).locator('button.sr').first().click();
    await expect(page.getByTestId('selected-marker')).toBeVisible();
    await bar.getByRole('button', { name: 'More' }).click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Transmit next slot', 'Tune for 10 s', 'Save slot', /Sort by\s*Distance/, /Stop beacon after\s*1 h/]);
    await shot(page, info, SHOTS, `${theme}-menu`, 300);
    await menu.getByRole('menuitem', { name: /Sort by/ }).click();
    await expect(menu.getByRole('menuitem', { name: /Sort by/ })).toHaveText(/SNR/);
    await page.keyboard.press('Escape');
    expect((await calls(page)).slice(0, 3)).toEqual(['DU1IVT', 'VK6XLR', 'HS1FVL']);

    // Touch and hold: the spot's details.
    const row = list(page).locator('button.sr', { hasText: 'G4ZFQ' }).first();
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const details = page.getByRole('dialog', { name: 'G4ZFQ' });
    await expect(details).toBeVisible();
    await expect(details.getByText('14.097026 MHz').or(details.getByText('14.097026 MHz'))).toBeVisible();
    await expect(details.getByText('30 dBm · 1 W')).toBeVisible();
    await shot(page, info, SHOTS, `${theme}-details`, 400);
  });
}
