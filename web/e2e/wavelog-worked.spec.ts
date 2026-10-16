// Read Wavelog's log in Chromium: the switch in Settings › Logging › Wavelog, off by
// default, reads the mock Wavelog's log (route interception, e2e/log-data.ts; no real server is
// called). A station worked only in Wavelog greys in Operate and Hide worked hides it; turning the
// switch off deletes what was read; Hunt still calls the station. Decodes come through the
// screen-review hooks (src/lib/testing/e2e-hooks.ts).
import { expect, test, type Page } from '@playwright/test';
import { mockWavelog, seed, wavelogOnly, WAVELOG_URL, type MockWavelog } from './log-data';

const WORKED_DB = 'rr73-wavelog-worked';

/** Wavelog set up, with the operator's callsign and grid. */
function setUpSeed() {
  const s = wavelogOnly();
  return { ...s, kv: [...s.kv.filter((k) => k.key !== 'settings'), { key: 'settings', value: { callsign: '9V1NE', grid: 'OJ11' } }] };
}

/** Requests that left for anywhere but the app and the mock Wavelog. */
function watchRequests(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const origin = new URL(r.url()).origin;
    if (origin !== new URL(page.url() || 'http://localhost').origin && origin !== WAVELOG_URL && !r.url().startsWith('data:')) out.push(r.url());
  });
  return out;
}

async function start(page: Page): Promise<{ mock: MockWavelog; strays: string[] }> {
  // Without the country file, New means a new call or grid here.
  await page.route('**/data/cty.json', (route) => route.fulfill({ status: 404, body: '' }));
  const mock = await mockWavelog(page);
  // JA1KXM worked on 20m FT8 from another station, and on 40m FT4 (MFSK with SUBMODE FT4) as portable.
  mock.add('JA1KXM', '20m', 'FT8', '', 'PM95');
  mock.add('JA1KXM/P', '40m', 'MFSK', 'FT4', 'PM95', '7');
  await page.goto('./');
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  const strays = watchRequests(page);
  await seed(page, setUpSeed());
  return { mock, strays };
}

const reads = (mock: MockWavelog) => mock.requests.filter((r) => r.path === '/api/get_contacts_adif');
const readSwitch = (page: Page) => page.getByRole('switch', { name: /^Read Wavelog’s log/ });

async function toWavelog(page: Page) {
  await page.goto('./#/settings/logging/wavelog');
  await expect(page.getByRole('heading', { level: 1, name: 'Wavelog' })).toBeVisible();
}

async function toOperate(page: Page) {
  await page.goto('./#/');
  await expect(page.getByTestId('decode-list')).toBeVisible();
}

/** A slot of decodes that ended a moment ago. */
async function decoded(page: Page, decodes: [string, number][]) {
  await page.evaluate((ds) => {
    const slot = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
    window.__rr73!.decoded(
      slot,
      ds.map(([text, snr], i) => ({ text, freq_hz: 600 + 300 * i, dt_s: 0.1, snr_db: snr })),
    );
  }, decodes);
}

const row = (page: Page, text: string) => page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: new RegExp(`^${text}$`) }) });

/** The names of the IndexedDB databases on the page. */
const databases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));

test('starts off and reads nothing from Wavelog', async ({ page }) => {
  const { mock, strays } = await start(page);
  await toWavelog(page);
  await expect(readSwitch(page)).not.toBeChecked();
  await expect(page.getByText('Dupes, Hunt and Repeat CQ count this phone’s log only.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Refresh from Wavelog/ })).toHaveCount(0);
  await toOperate(page);
  await decoded(page, [['CQ JA1KXM PM95', -8]]);
  await expect(row(page, 'CQ JA1KXM PM95')).not.toHaveAttribute('data-ink', 'worked');
  await page.waitForTimeout(500);
  expect(reads(mock)).toEqual([]);
  expect(await databases(page)).not.toContain(WORKED_DB);
  expect(strays).toEqual([]);
});

test('reads Wavelog’s log when switched on: a station worked only there greys, Hide worked hides it, and switching off deletes it', async ({ page }) => {
  const { mock, strays } = await start(page);
  await toWavelog(page);
  await readSwitch(page).check();
  const status = page.getByTestId('wavelog-read');
  await expect(status).toHaveText(/^1 station · checked \d\d:\d\d UTC$/);
  // Two station locations on a Wavelog older than 3.0.0: one series each, from id 0, for the fields the colours need.
  expect(reads(mock).map((r) => [r.body?.station_id, r.body?.fetchfromid])).toEqual([
    ['1', 0],
    ['1', mock.contacts[0].id],
    ['7', 0],
    ['7', mock.contacts[1].id],
  ]);
  expect(reads(mock)[0].body).toMatchObject({ output_format: 'json', fields: ['CALL', 'BAND', 'MODE', 'SUBMODE', 'GRIDSQUARE'], limit: 5000 });
  expect(await databases(page)).toContain(WORKED_DB);

  await toOperate(page);
  await decoded(page, [
    ['CQ JA1KXM PM95', -8],
    ['CQ K1ABC FN42', -12],
    ['9V1NE JA1KXM -10', -9],
  ]);
  await expect(row(page, 'CQ JA1KXM PM95')).toHaveAttribute('data-ink', 'worked');
  await expect(row(page, 'CQ JA1KXM PM95')).toHaveAttribute('data-hl', 'cq');
  await expect(row(page, 'CQ K1ABC FN42')).toHaveAttribute('data-hl', 'newGrid');
  await expect(row(page, 'CQ K1ABC FN42')).not.toHaveAttribute('data-ink', 'worked');
  const chips = page.getByRole('radiogroup', { name: 'Show decodes' });
  await expect(chips.getByRole('radio', { name: /^New/ })).toHaveText(/^New 1$/);
  const texts = () => page.getByTestId('decode-list').locator('button.dr .c-msg').allTextContents();
  await page.getByRole('button', { name: 'Hide worked' }).click();
  await expect.poll(texts).toEqual(['9V1NE JA1KXM -10', 'CQ K1ABC FN42']);
  await page.getByRole('button', { name: 'Hide worked' }).click();

  // The station's sheet says where Wavelog's log has it; the phone's log has it nowhere.
  await row(page, 'CQ JA1KXM PM95').click({ button: 'right' });
  const sheet = page.getByRole('dialog', { name: 'JA1KXM' });
  await expect(sheet.locator('.row', { hasText: 'Worked before' })).toContainText('Not yet');
  await expect(sheet.locator('.row', { hasText: 'In Wavelog' })).toContainText('40m FT4, 20m FT8');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Nothing went into the log, the Log or the backup.
  const qsos = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('rr73');
        req.onsuccess = () => {
          const get = req.result.transaction('qsos').objectStore('qsos').count();
          get.onsuccess = () => resolve(get.result);
        };
      }),
  );
  expect(qsos).toBe(0);

  // Off: what was read is deleted, and the colours go back to the phone's log.
  await toWavelog(page);
  await readSwitch(page).uncheck();
  await expect(page.getByTestId('wavelog-read')).toHaveCount(0);
  await expect.poll(() => databases(page)).not.toContain(WORKED_DB);
  await toOperate(page);
  await decoded(page, [['CQ JA1KXM PM95', -8]]);
  await expect(row(page, 'CQ JA1KXM PM95').first()).not.toHaveAttribute('data-ink', 'worked');
  const before = reads(mock).length;
  await page.reload();
  await toOperate(page);
  await page.waitForTimeout(500);
  expect(reads(mock).length).toBe(before);
  expect(strays).toEqual([]);
});

test('Refresh from Wavelog reads again and says why a read failed', async ({ page }) => {
  const { mock, strays } = await start(page);
  await toWavelog(page);
  await readSwitch(page).check();
  await expect(page.getByTestId('wavelog-read')).toHaveText(/^1 station · /);
  mock.add('VK2ESN', '20m', 'FT8', '', 'QF56');
  mock.rights = 'invalid';
  await page.getByRole('button', { name: /^Refresh from Wavelog/ }).click();
  await expect(page.getByRole('alert')).toHaveText('Wavelog refused the API key: it is wrong or switched off. Copy a read-write key from the API page in Wavelog.');
  await expect(page.getByTestId('wavelog-read')).toHaveText(/^1 station · /);
  mock.rights = 'rw';
  await page.getByRole('button', { name: /^Refresh from Wavelog/ }).click();
  await expect(page.getByTestId('wavelog-read')).toHaveText(/^2 stations · checked \d\d:\d\d UTC$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // A full read: the station list and every series from id 0 again.
  expect(mock.requests.filter((r) => r.path.startsWith('/api/station_info/')).length).toBeGreaterThanOrEqual(2);
  expect(strays).toEqual([]);
});

test('Hunt still calls a station worked only in Wavelog', async ({ page }) => {
  const { strays } = await start(page);
  await toWavelog(page);
  await readSwitch(page).check();
  await expect(page.getByTestId('wavelog-read')).toHaveText(/^1 station · /);
  await toOperate(page);
  const bar = page.getByRole('region', { name: 'Transmit' });
  await bar.getByRole('button', { name: 'Hunt', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Hunt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Not worked first, the default: JA1KXM, worked only in Wavelog, is not worked for Hunt, and
  // the strongest. Were Wavelog's log to count, Hunt would call K1ABC first.
  await decoded(page, [
    ['CQ K1ABC FN42', -15],
    ['CQ JA1KXM PM95', -5],
  ]);
  await expect(row(page, 'CQ JA1KXM PM95')).toHaveAttribute('data-ink', 'worked');
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toBeVisible();
  // Audio is off here, so nothing goes out: the call waits as the Next row.
  await expect(page.getByTestId('next-row')).toContainText('JA1KXM 9V1NE OJ11');
  await bar.getByRole('button', { name: 'Halt' }).click();
  expect(strays).toEqual([]);
});
