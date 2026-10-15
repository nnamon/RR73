// The README's walkthrough screenshots (docs/screenshots), in the review run only (RR73_REVIEW=1:
// projects walkthrough, an iPhone at 393 x 852, walkthrough-ipad and walkthrough-desktop, in WebKit). The practice band plays FT8 and RTTY
// stations in the page, so the waterfall, the decodes and the received text are the app's own,
// in real time. Rendered with SF Pro and SF Mono through scratchpad tooling outside the
// repository; the fonts are never committed.
import { expect, test, type Page } from '@playwright/test';
import { loadWasm } from './wasm';
import { useTheme } from './theme';
import { emptySeed, seed } from './log-data';

const OUT = 'test-results/screens/walkthrough';

test.beforeEach(async () => {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
});

/**
 * The station set up as after first use: callsign, grid, and a Tx frequency already picked on the
 * waterfall, so its first-use hint is gone. Then the practice band on, and Operate receiving.
 */
async function practiceOn(page: Page, theme: 'light' | 'dark') {
  await useTheme(page, theme);
  await page.goto('./');
  await seed(page, { ...emptySeed(), kv: [{ key: 'settings', value: { callsign: '9V1NE', grid: 'OJ11', freqPicked: true } }] });
  await page.goto('./#/settings/practice');
  await page.getByRole('switch', { name: /^Practice band/ }).check();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

const rows = (page: Page) => page.getByTestId('decode-list').locator('button.dr');
/** The screen as the operator sees it after a tap elsewhere: no keyboard focus ring. */
async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${OUT}/${test.info().project.name}-${name}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  test(`FT8 on the practice band in ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    // The large screens: light on the iPad, dark on the desktop.
    test.skip(info.project.name === 'walkthrough-ipad' && theme === 'dark');
    test.skip(info.project.name === 'walkthrough-desktop' && theme === 'light');
    await practiceOn(page, theme);
    await expect.poll(() => rows(page).count(), { timeout: 80_000, intervals: [1000] }).toBeGreaterThanOrEqual(16);
    await shot(page, `ft8-receiving-${theme}`);
    if (theme === 'dark' && info.project.name === 'walkthrough') return;

    // A caller answers the CQ; the screenshot catches the QSO under way.
    const bar = page.getByRole('region', { name: 'Transmit' });
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitemradio', { name: 'Practice: One caller' }).click();
    await bar.getByRole('button', { name: 'CQ' }).click();
    const caller = rows(page).filter({ has: page.locator('.c-msg', { hasText: /^9V1NE [A-Z0-9]+ [A-R]{2}\d{2}$/ }) }).first();
    await expect(caller).toBeVisible({ timeout: 90_000 });
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    await shot(page, `ft8-qso-${theme}`);
  });
}

test('RTTY on the practice band', async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== 'walkthrough');
  await practiceOn(page, 'light');
  await page.getByRole('button', { name: /^Change band/ }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByText('RTTY', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__rr73!.rttyTune(1612));
  const text = page.getByTestId('rx-text');
  await expect(text).toContainText('JA1XYZ JA1XYZ', { timeout: 60_000 });
  await text.locator('[data-call="JA1XYZ"]').last().click();
  await page.getByRole('toolbar', { name: 'Macros' }).getByRole('button', { name: 'Answer' }).click();
  await expect(text).toContainText('NAME TARO TARO QTH YOKOHAMA YOKOHAMA', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'rtty-qso-light');
});

test('Hound working the practice Fox', async ({ page }, info) => {
  test.setTimeout(300_000);
  test.skip(info.project.name !== 'walkthrough');
  await practiceOn(page, 'light');
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemradio', { name: 'Practice: Fox (DXpedition)' }).click();
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Hound/ }).click();
  await page.keyboard.press('Escape');
  const cq = rows(page).filter({ has: page.locator('.c-msg', { hasText: /^CQ (VP8|3Y0|FT5|VK0|ZL9|KH1)[A-Z]{2} [A-R]{2}\d{2}$/ }) }).first();
  await expect(cq).toBeVisible({ timeout: 60_000 });
  const fox = (await cq.locator('.c-msg').textContent())!.split(' ')[1];
  await cq.dblclick();
  // The Fox's report to us, alone or in a multi-call message.
  const report = new RegExp(`^(9V1NE ${fox} [+-]\\d{2}|[A-Z0-9/]+ RR73; 9V1NE <(${fox}|\\.\\.\\.)> [+-]\\d{2})$`);
  await expect(rows(page).filter({ has: page.locator('.c-msg', { hasText: report }) }).first()).toBeVisible({ timeout: 200_000 });
  await page.waitForTimeout(4000);
  await shot(page, 'hound-light');
});

/** Stations heard on WSPR, for the spots list: callsign, grid, dBm, SNR, audio Hz. */
const WSPR: [string, string, number, number, number][][] = [
  [['VK6XLR', 'OF78', 37, -13, 1462], ['ZL2BRG', 'RE78', 23, -23, 1563], ['YB0MWM', 'OI33', 30, -15, 1434], ['VK3ZPF', 'QF22', 37, -19, 1470], ['DU1IVT', 'PK04', 30, -10, 1508], ['4X1RF', 'KM72', 37, -27, 1571]],
  [['VK6XLR', 'OF78', 37, -14, 1462], ['JA5NVN', 'PM74', 23, -22, 1531], ['BH4XDZ', 'PM01', 30, -19, 1417], ['VK2ZT', 'QF56', 37, -18, 1489], ['ZL1RS', 'RF73', 37, -24, 1552], ['HS1FVL', 'OK03', 23, -16, 1443], ['G4ZFQ', 'IO90', 30, -28, 1426]],
];

test('WSPR on the practice band', async ({ page }, info) => {
  test.setTimeout(300_000);
  test.skip(info.project.name !== 'walkthrough');
  await practiceOn(page, 'light');
  await page.getByRole('button', { name: /^Change band/ }).click();
  await page.getByRole('dialog', { name: 'Change band' }).getByText('WSPR', { exact: true }).click();
  await page.keyboard.press('Escape');
  // The practice band's noise fills the 240 s waterfall; the spots of two slots come through the
  // review hook, as the band would give them: WSPR signals sit under the noise.
  await page.waitForTimeout(150_000);
  const slot = Math.floor(Date.now() / 120_000) * 120_000;
  for (const [i, spots] of WSPR.entries()) {
    const decodes = spots.map(([call, grid, dbm, snr, hz]) => ({ text: `${call} ${grid} ${dbm}`, freq_hz: hz, dt_s: 0.2, drift_hz_per_s: 0, snr_db: snr }));
    await page.evaluate(([s, ds]) => window.__rr73!.wsprDecoded(s as number, ds as never), [slot - (4 - 2 * i) * 60_000, decodes] as const);
  }
  await page.waitForTimeout(1000);
  await shot(page, 'wspr-light');
});
