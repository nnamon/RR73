// The practice band end to end in Chromium with no microphone: the band is synthesised in the
// page, captured through the worklet and decoded by the app's decoder in real time. Every test
// records the requests the page makes and fails if one leaves other than for the app's own files.
import { expect, test, type Page } from '@playwright/test';
import { loadWasm } from './wasm';
import type { LogQsoRecord } from '../src/lib/log/types';
import { refusesFirst } from '../src/lib/practice/wavelog-stand-in';
import { brightness, elementPixels } from './pixels';

const ME = '9V1NE';
let escaped: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  test.skip(!(await loadWasm()), 'The wasm package is not built (src/wasm/pkg).');
  escaped = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.origin !== origin || (r.method() !== 'GET' && r.method() !== 'HEAD')) escaped.push(`${r.method()} ${r.url()}`);
  });
  // Whatever escapes stops here: no test reaches a real server.
  await page.route((url) => url.origin !== origin, (route) => route.abort());
});

test.afterEach(() => {
  expect(escaped, 'requests that left the phone').toEqual([]);
});

/** Callsign and grid set, then Settings › Practice band turned on, which starts the band. */
async function practiceOn(page: Page) {
  await page.goto('./#/settings');
  for (const [name, value] of [
    ['Callsign', ME],
    ['Grid', 'OJ11'],
  ]) {
    const field = page.getByRole('textbox', { name });
    await field.fill(value);
    await field.press('Enter');
  }
  await page.getByRole('link', { name: /^Practice band/ }).click();
  const on = page.getByRole('switch', { name: /^Practice band/ });
  await on.check();
  await expect(on).toBeChecked();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Operate' }).click();
  await expect(page.locator('header.top .practice')).toHaveText('Practice');
  await expect(page.getByRole('timer', { name: /Receiving$/ })).toBeVisible({ timeout: 10_000 });
}

async function scenario(page: Page, name: string) {
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemradio', { name: `Practice: ${name}` }).click();
  await expect(bar.getByRole('status')).toContainText(`Practice · ${name}`);
}

const rows = (page: Page) => page.getByTestId('decode-list').locator('button.dr');
const row = (page: Page, text: RegExp) => rows(page).filter({ has: page.locator('.c-msg', { hasText: text }) });

async function callsInLog(page: Page, db: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    const d = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!d.objectStoreNames.contains('qsos')) return [];
    const all = await new Promise<{ call: string; deletedAt: number | null }[]>((resolve) => {
      const g = d.transaction('qsos').objectStore('qsos').getAll();
      g.onsuccess = () => resolve(g.result as { call: string; deletedAt: number | null }[]);
    });
    d.close();
    return all.filter((q) => q.deletedAt === null).map((q) => q.call).sort();
  }, db);
}

function record(call: string, minutesAgo: number): LogQsoRecord {
  const end = Date.now() - minutesAgo * 60_000;
  return { call, grid: 'FN42', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: end - 45_000, endUtcMs: end, reportSent: -10, reportRcvd: -12 };
}

test('practice on shows the tag and decodes the band without a microphone', async ({ page }) => {
  test.setTimeout(120_000);
  const media: string[] = [];
  await page.exposeFunction('__mediaAsked', (k: string) => media.push(k));
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = (c) => ((window as unknown as { __mediaAsked(k: string): void }).__mediaAsked(JSON.stringify(c)), Promise.reject(new DOMException('No', 'NotAllowedError')));
  });
  await practiceOn(page);
  // Two slots at most: the first partial one is too short to decode.
  await expect.poll(() => rows(page).count(), { timeout: 50_000, intervals: [1000] }).toBeGreaterThanOrEqual(5);
  await expect(row(page, /^CQ /).first()).toBeVisible();
  expect(media).toEqual([]);
});

test('calling CQ gets a caller and logs a practice QSO; the log is untouched', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((r) => window.__rr73!.logged(r), record('VK2ESN', 30));
  await practiceOn(page);
  await scenario(page, 'One caller');
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'CQ' }).click();

  // On air, the waterfall shows the transmitted tones. In 0.10.1 the whole slot was blank.
  await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(4000);
  // The markers and labels sit over the canvas; hidden, the pixels are the waterfall's own.
  const hide = await page.addStyleTag({ content: '.wf .mark, .wf .tl, .wf .hint { visibility: hidden !important; }' });
  const px = await elementPixels(page, page.getByTestId('waterfall'));
  await hide.evaluate((el) => (el as Element).remove());
  // The newest 3 s of rows lie in the transmission: Tx at 1500 Hz (8 tones to 1544 Hz) shows bright,
  // the rest of the band at an even floor.
  const rowsDown = Math.max(4, Math.floor((px.height * 3) / 45));
  const col = (hz: number) => Math.round((hz / 3000) * px.width);
  const band = (lo: number, hi: number) => brightness(px, col(lo), col(hi), 2, rowsDown);
  const tx = band(1500, 1544);
  const elsewhere = Math.max(band(600, 700), band(2100, 2200), band(2600, 2700));
  test.info().annotations.push({ type: 'waterfall', description: JSON.stringify({ tx, elsewhere }) });
  expect(elsewhere).toBeGreaterThan(0);
  expect(tx).toBeGreaterThan(1.5 * elsewhere);

  // The caller answers the CQ the slot after it goes out.
  const caller = row(page, new RegExp(`^${ME} [A-Z0-9]+ [A-R]{2}\\d{2}$`)).first();
  await expect(caller).toBeVisible({ timeout: 75_000 });
  const call = (await caller.locator('.c-msg').textContent())!.split(' ')[1];
  const notice = page.getByRole('status').filter({ hasText: `Logged ${call}` });
  await expect(notice).toBeVisible({ timeout: 120_000 });

  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Practice log' })).toBeVisible();
  await expect(page.locator('li.lr')).toHaveCount(1);
  await expect(page.locator('li.lr').first()).toContainText(call);
  expect(await callsInLog(page, 'rr73')).toEqual(['VK2ESN']);
  expect(await callsInLog(page, 'rr73-practice')).toEqual([call]);

  // Practice off: the log comes back as it was.
  await page.goto('./#/settings/practice');
  await page.getByRole('switch', { name: /^Practice band/ }).uncheck();
  await page.goto('./#/log');
  await expect(page.getByRole('heading', { level: 1, name: 'Log' })).toBeVisible();
  await expect(page.locator('li.lr')).toHaveCount(1);
  await expect(page.locator('li.lr').first()).toContainText('VK2ESN');
  await expect(page.locator('header.top .practice')).toHaveCount(0);
});

test('nothing leaves the phone: the guard refuses sends, Send to Wavelog goes to the stand-in, Clear practice log has Undo', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.waitForFunction(() => !!window.__rr73);
  await page.evaluate((r) => window.__rr73!.logged(r), record('VK2ESN', 30));
  await practiceOn(page);

  // A send to any server is refused in the page.
  const attempts = await page.evaluate(() =>
    Promise.all(
      [
        ['https://api.pota.app/spot/activator', 'GET'],
        ['https://log.example.com/api/qso', 'POST'],
        ['/report', 'POST'],
      ].map(([url, method]) => fetch(url, { method }).then(
        () => 'sent',
        (e: unknown) => String(e),
      )),
    ),
  );
  for (const a of attempts) expect(a).toContain('Practice band is on');

  const delivered = ['K1ABC', 'K1ABD', 'K1ABE', 'K1ABF'].find((c) => !refusesFirst(c))!;
  const refused = ['JA1AAA', 'JA1AAB', 'JA1AAC', 'JA1AAD', 'JA1AAE', 'JA1AAF', 'JA1AAG', 'JA1AAH'].find(refusesFirst)!;
  for (const [i, call] of [delivered, refused].entries()) await page.evaluate((r) => window.__rr73!.logged(r), record(call, 5 - i));
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Log' }).click();
  await page.getByRole('button', { name: 'Send 2 QSOs to Wavelog' }).click();
  const entry = (call: string) => page.locator('li.lr', { has: page.getByText(call, { exact: true }) });
  await expect(entry(delivered).getByText('Wavelog: delivered')).toBeAttached();
  await expect(entry(refused)).toContainText('refused');
  await expect(page.getByTestId('log-notice')).toContainText('1 delivered. 1 refused: see To do.');

  await page.goto('./#/settings/practice');
  await expect(page.getByText('2 practice QSOs')).toBeVisible();
  await page.getByRole('button', { name: /^Clear practice log/ }).click();
  const cleared = page.getByTestId('log-notice').filter({ hasText: 'Cleared 2 practice QSOs' });
  await expect(cleared).toBeVisible();
  expect(await callsInLog(page, 'rr73-practice')).toEqual([]);
  await cleared.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('log-notice')).toContainText('Restored 2 practice QSOs');
  expect(await callsInLog(page, 'rr73-practice')).toEqual([delivered, refused].sort());
  expect(await callsInLog(page, 'rr73')).toEqual(['VK2ESN']);
});
