// RTTY in Operate on iPhone viewports in WebKit, as in the approved mockup (docs/design/rtty.md):
// 20m from 9V1NE on 14 October 2026, the page clock held at the mockup's moments and the text
// added through the review hooks. Listening, a QSO with JA1XYZ filled from their text, a macro and a
// typed line on air, the keyboard up, Halt, the strip logged through the QSO sheet, the Contest set
// with the other-case reading, weak copy with the speed menu, the band sheet's RTTY dial, Settings ›
// RTTY and Settings › Macros. CI runs it in light at 375 x 667; the review projects run both themes
// at both sizes and save the screens to test-results/screens/rtty.
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { checkLayout, ci, reviewing, shot } from './layout-checks';
import { INSETS } from './operate-checks';
import { seed } from './log-data';
import { createQso } from '../src/lib/log/qso';
import type { LogQsoRecord, Qso } from '../src/lib/log/types';
import { useTheme } from './theme';

const SHOTS = fileURLToPath(new URL('../test-results/screens/rtty', import.meta.url));

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);

let n = 0;
function worked(call: string, mode: LogQsoRecord['mode'], band = '20m'): Qso {
  const t = at(9, 0) + ++n * 60_000;
  return createQso(
    { call, mode, band, dialHz: 14_074_000, audioHz: 1500, startUtcMs: t, endUtcMs: t, reportSent: -10, reportRcvd: -12 },
    { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, now: t, activation: null, callsign: '9V1NE' },
  );
}

/** The log behind the mockup's colours: these were worked on 20m FT8, SP9RQ in RTTY (worked before). */
const LOG = [...['BV2KQ', 'VK4TQ', 'UA9CDV', 'OH2BAX', 'VK6QXT'].map((c) => worked(c, 'FT8')), worked('SP9RQ', 'RTTY')];

/**
 * Lines in the mockup's notation: "> " starts a sent line, "@14:01" moves the clock (a quiet gap
 * makes the divider) and {u …} marks uncertain characters. Callsign colours come from the log.
 */
async function lines(page: Page, list: string[], startMs: number) {
  let now = startMs;
  for (const l of list) {
    if (l.startsWith('@')) {
      const [h, m] = l.slice(1).split(':').map(Number);
      now = at(h, m, 5);
      continue;
    }
    now += 2000;
    await page.clock.setFixedTime(now);
    const sent = l.startsWith('> ');
    let text = '';
    let kinds = '';
    for (const part of (sent ? l.slice(2) : l).split(/(\{u [^}]*\})/)) {
      const u = /^\{u (.*)\}$/.exec(part);
      text += u ? u[1] : part;
      kinds += (u ? 'u' : sent ? 't' : 'r').repeat((u ? u[1] : part).length);
    }
    await page.evaluate(([t, k]) => window.__rr73!.rttyText(t, k), [`${text}\n`, `${kinds}${sent ? 't' : 'r'}`] as const);
  }
}

const RX_LISTEN = [
  'BV2KQ DE VK4TQ',
  'R R FB OM. RIG IC-7300 100W ANT YAGI',
  'WX HR CLOUDY 18C. BTU BV2KQ DE VK4TQ K',
  '@14:01',
  'VK4TQ DE BV2KQ',
  'R TNX FER NICE QSO. 73 ES GUD DX',
  'VK4TQ DE BV2KQ SK',
  '@14:02',
  "{u E5 T'}",
  '@14:03',
  'RYRYRYRYRYRYRYRYRYRYRYRY',
  'CQ CQ CQ DE JA1XYZ JA1XYZ JA1XYZ',
  'PSE K',
  '@14:04',
  '{u 3T}CQ CQ CQ DE JA1XYZ JA1XYZ JA1XYZ',
  'PSE K',
];

const RX_REPLY = ['> JA1XYZ JA1XYZ DE 9V1NE 9V1NE 9V1NE K', '9V1NE DE JA1XYZ', 'GE OM TNX FER CALL. UR RST 579 579', 'NAME TARO TARO QTH YOKOHAMA YOKOHAMA', 'HW CPY? 9V1NE DE JA1XYZ K'];

const RX_CONTEST = [
  '> CQ TEST 9V1NE 9V1NE CQ',
  'UA9CDV UA9CDV',
  '> UA9CDV 599 039 039 UA9CDV',
  '9V1NE 599 0877 0877',
  '> TU 9V1NE TEST',
  'SP9RQ SP9RQ',
  '> SP9RQ 599 040 040 SP9RQ',
  '9V1NE TU 599 2203 2203',
  '> TU 9V1NE TEST',
  '@14:20',
  '> CQ TEST 9V1NE 9V1NE CQ',
  'DL5ABC DL5ABC',
  '> DL5ABC 599 041 041 DL5ABC',
  '9V1NE 599 1186 1186',
  '> TU 9V1NE TEST',
  'OH2BAX OH2BAX',
  '> OH2BAX 599 042 042 OH2BAX',
  '9V1NE 599 QWU QWU',
];

const RX_WEAK = [
  '@14:11',
  '{u T} CQ {u E} DE VK6QXT VK6Q{u 5}T VK6QXT',
  'PSE K',
  '@14:12',
  'CQ CQ CQ DE VK6QXT VK6QXT V{u 8}6QXT',
  'P{u ,}E K',
  '{u EE3}',
  'CQ CQ {u Q} DE VK6QXT VK6QXT VK6QXT',
  'PS{u T} {u T}',
];

/** Operate in RTTY with the device's insets, in `theme`, as 9V1NE with name and QTH, audio on. */
async function openRtty(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = `:root { --rr-safe-top: ${i.top}px; --rr-safe-bottom: ${i.bottom}px; }`;
      document.head.append(s);
    });
  }, INSETS[page.viewportSize()!.width]);
  await useTheme(page, theme);
  await page.clock.setFixedTime(at(13, 59, 0));
  await page.goto('./');
  const settings = { callsign: '9V1NE', grid: 'OJ11vi', myName: 'AMON', myQth: 'SINGAPORE', band: '20m', mode: 'RTTY', freqPicked: true, keyboard: { contestId: 'CQ-WPX-RTTY', nextSerial: 42 }, schema: 8 };
  await seed(page, { qsos: LOG, ledger: [], activations: [], destinations: [], kv: [{ key: 'settings', value: settings }] });
  await page.goto('./#/operate');
  await page.getByRole('button', { name: 'Start audio' }).click();
  await expect(page.getByRole('button', { name: 'Start audio' })).toBeHidden({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__rr73!.rttyDeaf();
    window.__rr73!.rttyTune(1612);
    window.__rr73!.rttySignal(-6, true);
  });
}

const bar = (page: Page) => page.getByRole('region', { name: 'Transmit' });
const text = (page: Page) => page.getByTestId('rx-text');
const word = (page: Page, w: string) => text(page).locator(`[data-w="${w}"]`);

for (const theme of ['light', 'dark'] as const) {
  test(`RTTY in Operate: a QSO from the text, macros, logging, the Contest set and the settings, in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    test.setTimeout(120_000);
    await openRtty(page, theme);
    const size = `${page.viewportSize()!.width}`;

    // Listening at 14:04:31: the top bar's dial to four decimals, no slot ring, the pair at 1612 Hz.
    await expect(page.getByRole('button', { name: /^Change band/ })).toHaveText(/20m\s*RTTY\s*14\.0830/);
    await lines(page, RX_LISTEN, at(13, 59, 40));
    await page.clock.setFixedTime(at(14, 4, 31));
    await expect(bar(page).getByRole('status')).toHaveText(/14\.0846 MHz · 1612 \/ 1442 Hz\s*Rx/);
    await expect(text(page).locator('[role=separator]')).toHaveText(['13:59', '14:01', '14:02', '14:03', '14:04']);
    // Callsigns take the decode colours: JA1XYZ is a new call, VK4TQ was worked in FT8 on 20m.
    await expect(word(page, 'JA1XYZ').first()).toHaveClass(/call.*hl|hl.*call/);
    await expect(word(page, 'VK4TQ').first()).not.toHaveClass(/hl/);
    await expect(bar(page).getByRole('button', { name: 'Log QSO' })).toHaveAttribute('aria-disabled', 'true');
    await checkLayout(page);
    // The signal meter and its value end inside the row's margin.
    const meter = (await page.getByRole('meter', { name: 'Signal' }).boundingBox())!;
    expect(meter.x + meter.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8);
    await shot(page, info, SHOTS, `${theme}-listen`, 300);

    // A tap on the waterfall tunes there (nothing to find: the receiver hears nothing); a drag
    // moves the pair with the finger, keeping the shift.
    const wf = (await page.getByTestId('waterfall-area').boundingBox())!;
    const xOf = (hz: number) => wf.x + (wf.width * hz) / 3000;
    await page.mouse.click(xOf(2000), wf.y + wf.height / 3);
    await expect(bar(page).getByRole('status')).toHaveText(/Tuned to 2085 Hz/);
    await expect(page.getByRole('slider', { name: 'Mark tone, Hz' })).toHaveValue('2085');
    await page.mouse.move(xOf(2000), wf.y + wf.height / 3);
    await page.mouse.down();
    await page.mouse.move(xOf(1800), wf.y + wf.height / 3, { steps: 8 });
    await page.mouse.up();
    // Within a pixel of the finger: 7.6 Hz at 393 pt.
    expect(Math.abs(Number(await page.getByRole('slider', { name: 'Mark tone, Hz' }).inputValue()) - 1885)).toBeLessThanOrEqual(8);
    await page.evaluate(() => window.__rr73!.rttyTune(1612));

    // JA1XYZ answers; a tap on the callsign fills the strip from their text.
    await lines(page, ['@14:05', ...RX_REPLY], at(14, 5, 0));
    await word(page, 'JA1XYZ').last().click();
    await expect(page.getByTestId('strip-call')).toHaveValue('JA1XYZ');
    await expect(page.getByTestId('strip-rcvd')).toHaveValue('579');
    await expect(page.getByTestId('strip-name')).toHaveValue('TARO');
    await expect(page.getByTestId('strip-qth')).toHaveValue('YOKOHAMA');
    // At 375 pt YOKOHAMA is wider than its cell: it ends in an ellipsis, never cut mid-letter.
    await expect(page.getByTestId('strip-qth')).toHaveCSS('text-overflow', 'ellipsis');
    await expect(bar(page).getByRole('status')).toHaveText(/Call set to JA1XYZ/);

    // The Report macro starts a transmission that returns to Rx after its text; a line typed
    // before then follows in the same over.
    await page.clock.setFixedTime(at(14, 6, 40));
    await page.getByRole('toolbar', { name: 'Macros' }).getByRole('button', { name: 'Report' }).click();
    await expect(bar(page).getByRole('button', { name: /^Rx in \d+ s$/ })).toBeVisible({ timeout: 5000 });
    const field = page.getByTestId('send-field');
    await field.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await field.pressSequentially(' RIG KX2 5W ES EFHW');
    await expect(field).toHaveValue(/RIG KX2 5W ES EFHW$/);
    await expect(text(page).locator('.k-t').last()).toBeVisible();
    await expect(bar(page).getByRole('status')).toHaveText(/Rx in \d+ s$/);
    await shot(page, info, SHOTS, `${theme}-qso`, 200);

    // The keyboard up: the waterfall as a 48 pt strip, no tuning row or status line.
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: vp.width === 393 ? 516 : 407 });
    await page.evaluate(() => window.__rr73!.rttyKeyboardUp(true));
    await expect(page.getByRole('toolbar', { name: 'Tuning' })).toBeHidden();
    await expect(page.getByTestId('kb-status')).toBeHidden();
    expect((await page.getByTestId('waterfall-area').boundingBox())!.height).toBe(48);
    await shot(page, info, SHOTS, `${theme}-keyboard`, 200);
    await page.evaluate(() => window.__rr73!.rttyKeyboardUp(null));
    await page.setViewportSize(vp);
    await field.blur();

    // Halt: off at once; the text not yet sent stays in the field.
    await bar(page).getByRole('button', { name: 'Halt' }).click();
    await expect(bar(page).getByRole('button', { name: 'Tx off' })).toBeVisible();
    await expect(field).toHaveValue(/EFHW$/);
    await page.getByRole('button', { name: 'Clear text to send' }).click();
    await expect(field).toHaveValue('');

    // The strip's chevron opens the QSO sheet with the strip's fields; Log QSO logs it as RTTY.
    await page.clock.setFixedTime(at(14, 9, 40));
    await page.getByRole('button', { name: 'Open the QSO sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Log QSO' });
    await expect(sheet.locator('select').nth(1)).toHaveValue('RTTY');
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('TARO');
    await expect(sheet.getByRole('textbox', { name: 'Frequency (MHz)' })).toHaveValue('14.084612');
    await sheet.getByRole('textbox', { name: 'Comment' }).fill('IC-7300 100W YAGI');
    await shot(page, info, SHOTS, `${theme}-log`, 400);
    await sheet.getByRole('button', { name: 'Log QSO' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('log-notice')).toContainText('Logged JA1XYZ 20m RTTY 599 / 579');
    await expect(page.getByTestId('strip-call')).toHaveValue('');

    // The Contest set from •••: the strip sends 599 042, and QWU reads 127 in figures.
    await bar(page).getByRole('button', { name: 'More' }).click();
    await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Macros/ }).click();
    await expect(page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Macros/ })).toContainText('Contest');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__rr73!.rttyText('\n', 't'));
    await lines(page, ['@14:19', ...RX_CONTEST], at(14, 19, 0));
    await page.clock.setFixedTime(at(14, 21, 18));
    await word(page, 'OH2BAX').last().click();
    await expect(page.getByTestId('strip-call')).toHaveValue('OH2BAX');
    await expect(page.getByRole('textbox', { name: 'RST sent' })).toHaveValue('599');
    await expect(page.getByRole('group', { name: 'QSO' })).toContainText('042');
    await word(page, 'QWU').first().click();
    const menu = page.getByRole('menu', { name: 'Use QWU as' });
    await expect(menu).toContainText('QWU reads 127 in figures');
    await expect(menu.getByRole('menuitem').first()).toHaveText('Number received 127');
    await expect(word(page, 'QWU').first()).toHaveClass(/marked/);
    await shot(page, info, SHOTS, `${theme}-contest`, 200);
    await menu.getByRole('menuitem', { name: 'Number received 127' }).click();
    await expect(page.getByTestId('strip-rcvd')).toHaveValue('599 127');
    await expect(page.getByRole('toolbar', { name: 'Macros' }).getByRole('button')).toHaveText(['CQ', 'Exch', 'TU', 'My call', 'S&P exch', 'Again', 'Nr?', 'Call?']);
    // The macro row scrolls sideways only, as the filter chips do.
    expect(await page.getByRole('toolbar', { name: 'Macros' }).evaluate((el) => [el.scrollHeight <= el.clientHeight, getComputedStyle(el).touchAction])).toEqual([true, 'pan-x']);

    // Weak copy: uncertain characters in grey, the squelch at −16 and the speed menu open.
    await bar(page).getByRole('button', { name: 'More' }).click();
    await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Macros/ }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('strip-call').fill('');
    await page.getByTestId('strip-call').press('Enter');
    await expect(page.getByTestId('strip-rcvd')).toHaveValue('');
    await page.evaluate(() => window.__rr73!.rttyText('\n', 't'));
    await lines(page, RX_WEAK, at(14, 11, 0));
    await page.clock.setFixedTime(at(14, 12, 47));
    await page.evaluate(() => {
      window.__rr73!.rttyTune(1425);
      window.__rr73!.rttySignal(-13, true);
    });
    await page.getByRole('button', { name: /^Squelch/ }).click();
    await page.getByRole('menu', { name: 'Squelch' }).getByRole('menuitemradio', { name: '−16 dB' }).click();
    await expect(page.getByRole('button', { name: /^Squelch/ })).toHaveText('Sq −16');
    await page.getByRole('button', { name: /^Speed and shift/ }).click();
    await expect(page.getByRole('menu', { name: 'Speed and shift' }).getByRole('menuitemradio', { name: '45.45 · 170' })).toHaveAttribute('aria-checked', 'true');
    await expect(text(page).locator('.k-u').first()).toBeVisible();
    await shot(page, info, SHOTS, `${theme}-weak`, 200);
    await page.keyboard.press('Escape');

    // The band sheet: RTTY's dial, editable, in MHz or kHz; the top bar follows.
    await page.getByRole('button', { name: /^Change band/ }).click();
    const band = page.getByRole('dialog', { name: 'Change band' });
    const dial = band.getByTestId('rtty-dial');
    await expect(dial).toHaveValue('14.0830');
    await expect(band.getByRole('radio', { name: '60m', exact: true })).toBeDisabled();
    await expect(band.getByRole('radio', { name: '2m', exact: true })).toBeDisabled();
    const reset = band.getByRole('button', { name: /^Reset to/ });
    await expect(reset).toHaveCount(0);
    // Pixels of the dial's text out of view, before and after the reset button shows.
    const hidden = () => dial.evaluate((el: HTMLInputElement) => el.scrollWidth - el.clientWidth);
    const hiddenAlone = await hidden();
    await dial.fill('14085');
    await dial.press('Enter');
    await expect(dial).toHaveValue('14.0850');
    // Reset goes back to the band's usual dial. On a 375 pt screen it leaves every digit in view.
    await expect(reset).toHaveAccessibleName('Reset to 14.0830 MHz');
    expect(await hidden()).toBeLessThanOrEqual(hiddenAlone);
    await reset.click();
    await expect(dial).toHaveValue('14.0830');
    await expect(reset).toHaveCount(0);
    await dial.fill('14085');
    await dial.press('Enter');
    await expect(dial).toHaveValue('14.0850');
    await dial.focus();
    await shot(page, info, SHOTS, `${theme}-band`, 400);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Change band/ })).toHaveText(/14\.0850/);

    // Settings › RTTY and Settings › Macros.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: /^RTTY/ }).click();
    await expect(page.getByRole('heading', { name: 'RTTY' })).toBeVisible();
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-settings`, 200);
    await page.getByRole('link', { name: /^Macros/ }).scrollIntoViewIfNeeded();
    await shot(page, info, SHOTS, `${theme}-settings2`, 200);
    await page.getByRole('link', { name: /^Macros/ }).click();
    await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
    await page.getByRole('radio', { name: 'QSO' }).check({ force: true });
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-macros`, 200);
    await page.getByRole('link', { name: /^Report/ }).click();
    await expect(page.getByTestId('macro-sends')).toHaveText('TNX FER CALL. UR RST 599 599. NAME AMON AMON QTH SINGAPORE SINGAPORE');
    await checkLayout(page);
    await shot(page, info, SHOTS, `${theme}-macroedit`, 200);

    // An edit shows in Sends now; Delete macro offers Undo; Restore defaults names what it replaces.
    const macroText = page.getByRole('textbox', { name: 'Text' });
    await macroText.fill('ur rst {rst} {rst}');
    await expect(page.getByTestId('macro-sends')).toHaveText('UR RST 599 599');
    await page.getByRole('button', { name: 'Delete macro' }).click();
    await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Report/ })).toHaveCount(0);
    await page.getByTestId('log-notice').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: /^Report/ })).toHaveText(/UR RST \{RST\} \{RST\}/);
    await page.getByRole('button', { name: 'Restore defaults' }).click();
    const restore = page.getByRole('dialog', { name: 'Restore 8 default macros?' });
    await expect(restore).toContainText('Your 1 edited macro is replaced.');
    await restore.getByRole('button', { name: 'Restore defaults' }).click();
    await expect(page.getByRole('link', { name: /^Report/ })).toHaveText(/TNX FER CALL/);
    if (!reviewing(info)) expect(size).toBe('375');
  });
}
