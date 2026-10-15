// The log end to end in Chromium: manual QSOs, delivery to a mock Wavelog (route interception; no
// real server is called), refusals and Fix, offline then online delivery, activations, and file
// export with Mark submitted.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { API_KEY, emptySeed, mockupLog, mockWavelog, seed, wavelogOnly, WAVELOG_URL, withFeatures, type MockWavelog } from './log-data';
import { FIXED_TIME } from './time';

/** Opens a screen with the clock at FIXED_TIME, running, and optionally a seeded log, seeded before the screen opens. */
async function start(page: Page, path: string, data?: Parameters<typeof seed>[1]) {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(data ? './' : `./${path}`);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  if (!data) return;
  await seed(page, data);
  await page.goto(`./${path}`);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
}

/** Activations on (Settings › Optional features); every feature is off on a new install. */
const activations = (data = emptySeed()) => withFeatures(data, { activations: true });

/** Adds a QSO through Log › Add QSO. */
async function addQso(page: Page, call: string, opts: { grid?: string; sent?: string; rcvd?: string; ref?: string } = {}) {
  if (!page.url().includes('#/log')) await page.goto('./#/log');
  await page.getByRole('button', { name: 'Add QSO' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add QSO' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Callsign' }).fill(call);
  await sheet.getByRole('textbox', { name: 'Their grid' }).fill(opts.grid ?? 'QF56');
  await sheet.getByRole('textbox', { name: 'Report sent' }).fill(opts.sent ?? '-12');
  await sheet.getByRole('textbox', { name: 'Report received' }).fill(opts.rcvd ?? '-10');
  if (opts.ref) await sheet.getByRole('textbox', { name: 'Their park or summit' }).fill(opts.ref);
  await sheet.getByRole('button', { name: 'Add QSO' }).click();
  await expect(sheet).toBeHidden();
}

const row = (page: Page, call: string) => page.locator('li.lr', { has: page.getByText(call, { exact: true }) });
/** A segment of the Log's All, To do and Activations control. */
const seg = (page: Page, name: string) => page.locator('label.seg-i', { hasText: name });

function stored(page: Page): Promise<{ qsos: { call: string; deletedAt: number | null; gridsquare: string }[]; ledger: { destinationId: string; state: string }[] }> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('rr73');
        req.onsuccess = () => {
          const tx = req.result.transaction(['qsos', 'ledger']);
          const q = tx.objectStore('qsos').getAll();
          const l = tx.objectStore('ledger').getAll();
          tx.oncomplete = () => resolve({ qsos: q.result, ledger: l.result });
        };
      }),
  );
}

test('adds, edits, deletes and restores a QSO by hand', async ({ page }) => {
  await start(page, '#/log');
  await expect(page.getByText('No QSOs yet')).toBeVisible();

  // The form says what is missing.
  await page.getByRole('button', { name: 'Add QSO' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add QSO' });
  await sheet.getByRole('textbox', { name: 'Their grid' }).fill('QF5');
  await sheet.getByRole('button', { name: 'Add QSO' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Type the other station’s callsign.');
  await expect(sheet.getByRole('alert')).toContainText('QF5 is not a grid. Grids look like QF56 or QF56od.');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  await addQso(page, 'vk2esn', { ref: 'us-1234' });
  const r = row(page, 'VK2ESN');
  await expect(r).toContainText('20m FT8 · 14.074 · QF56 · −12 / −10');
  // The clock runs from 13:14:52 UTC, so the QSO is at 13:14 or 13:15.
  await expect(r).toContainText(/13:1[45]/);
  await expect(page.getByRole('heading', { name: 'Today · 13 Oct 2026' })).toBeVisible();
  const notice = page.getByTestId('log-notice');
  await expect(notice).toContainText('Logged VK2ESN 20m FT8 −12 / −10');

  // Edit from the notice.
  await notice.getByRole('button', { name: 'Edit the QSO with VK2ESN' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit QSO' });
  await expect(edit.getByRole('textbox', { name: 'Callsign' })).toHaveValue('VK2ESN');
  await expect(edit.getByRole('textbox', { name: 'Their park or summit' })).toHaveValue('US-1234');
  await edit.getByRole('textbox', { name: 'Their grid' }).fill('qf57');
  await edit.getByRole('button', { name: 'Save QSO' }).click();
  await expect(edit).toBeHidden();
  await expect(r).toContainText('QF57');
  await expect.poll(async () => (await stored(page)).qsos.map((q) => q.gridsquare)).toEqual(['QF57']);

  // Delete, then Undo.
  await r.getByRole('button', { name: /VK2ESN/ }).click();
  await page.getByRole('dialog', { name: 'Edit QSO' }).getByRole('button', { name: 'Delete QSO' }).click();
  await expect(row(page, 'VK2ESN')).toHaveCount(0);
  await expect(notice).toContainText('Deleted VK2ESN');
  await expect.poll(async () => (await stored(page)).qsos[0]?.deletedAt).not.toBeNull();
  await notice.getByRole('button', { name: 'Undo deleting the QSO with VK2ESN' }).click();
  await expect(row(page, 'VK2ESN')).toHaveCount(1);

  // Undo on the logged notice removes the QSO.
  await addQso(page, 'JA1KXM', { grid: 'PM95' });
  await page.getByTestId('log-notice').getByRole('button', { name: 'Undo the QSO with JA1KXM' }).click();
  await expect(row(page, 'JA1KXM')).toHaveCount(0);
  await expect(page.getByTestId('log-notice')).toContainText('Removed JA1KXM from the log');

  // Stored on the phone.
  await page.reload();
  await expect(row(page, 'VK2ESN')).toContainText('QF57');
  await expect(row(page, 'JA1KXM')).toHaveCount(0);
});

/** The Send to Wavelog button at the top of the Log, by its count. */
const sendButton = (page: Page) => page.getByRole('button', { name: /^Send \d+ QSOs? to Wavelog$/ });
const posts = (mock: MockWavelog) => mock.requests.filter((r) => r.path === '/api/qso');

test('sets up Wavelog, keeps a new QSO not sent for 30 s, then sends it on Send to Wavelog', async ({ page }) => {
  const mock = await mockWavelog(page);
  await start(page, '#/settings/logging/wavelog');
  await page.getByRole('textbox', { name: 'Address' }).fill('wavelog.example.test/');
  await page.getByLabel('API key').fill(API_KEY);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/^Connected to Wavelog 2\.1 at 13:1\d UTC\. The key can read and write\.$/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue(WAVELOG_URL);
  expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
    `GET /api/auth/${API_KEY}`,
    `GET /api/station_info/${API_KEY}`,
    'POST /api/qso/true',
    'POST /api/version',
  ]);
  await expect(page.getByRole('radio', { name: /Home/ })).toBeChecked();

  await page.goto('./#/settings/logging');
  await expect(page.getByRole('link', { name: /Wavelog/ }).first()).toContainText('Connected');
  await expect(page.getByRole('switch', { name: /Send automatically/ })).not.toBeChecked();

  await addQso(page, 'VK2ESN');
  await expect(row(page, 'VK2ESN')).toContainText('Wavelog · not sent');
  await page.clock.fastForward(30_000);
  await page.clock.fastForward(30_000);
  expect(posts(mock)).toHaveLength(0);
  await expect(row(page, 'VK2ESN')).toContainText('Wavelog · not sent');
  await expect(page.getByTestId('send-bar')).toContainText('1 QSO not sent to Wavelog.');
  await expect(seg(page, 'To do')).toHaveText(/To do\s*1$/);

  await sendButton(page).click();
  await expect(row(page, 'VK2ESN').getByText('Wavelog: delivered')).toBeAttached();
  await expect(page.getByTestId('send-bar')).toContainText('Delivered VK2ESN to Wavelog.');
  expect(posts(mock)).toHaveLength(1);
  expect(posts(mock)[0].body).toMatchObject({ key: API_KEY, station_profile_id: '1', type: 'adif' });
  expect(posts(mock)[0].body?.string).toMatch(/^<CALL:6>VK2ESN <QSO_DATE:8>20261013 <TIME_ON:6>131[45]\d\d .*<GRIDSQUARE:4>QF56 <EOR>$/);
  // No callsign in Settings yet: STATION_CALLSIGN is left out and Wavelog uses the station location's.
  expect(posts(mock)[0].body?.string).not.toContain('STATION_CALLSIGN');
  await expect(seg(page, 'To do')).toHaveText(/To do$/);
});

test('sends QSOs oldest first with progress, and sums up mixed results', async ({ page }) => {
  const mock = await mockWavelog(page);
  let releaseFirst: () => void = () => undefined;
  const first = new Promise<void>((r) => (releaseFirst = r));
  // Wavelog's band refusal for one call, its duplicate report for another.
  mock.qso = (body) => {
    const call = /<CALL:\d+>(\S+)/.exec(String(body.string))?.[1];
    if (call === 'DL1XYZ') return { status: 400, body: { status: 'abort', messages: ['', "QSO on 2026-10-13: Band '20m' is not in the band configuration. This QSO wasn't imported.<br>"] } };
    if (call === 'K1ABC') return { status: 400, body: { status: 'abort', messages: ['', 'Date/Time: 2026-10-13 13:00:00 Callsign: K1ABC Band: 20m Duplicate for 9V1NE<br>'] } };
    return { status: 201, body: { status: 'created', adif_count: 1, adif_errors: 0 } };
  };
  await page.route(`${WAVELOG_URL}/api/qso`, async (route) => {
    await first;
    await route.fallback();
  });
  await start(page, '#/log', wavelogOnly());
  for (const call of ['W1AW', 'K1ABC', 'DL1XYZ', 'G4ABC']) await addQso(page, call);
  await expect(sendButton(page)).toHaveText('Send 4 QSOs to Wavelog');
  await sendButton(page).click();
  await expect(page.getByRole('button', { name: 'Sending 1 of 4' })).toBeDisabled();
  await expect(page.getByTestId('send-bar')).toContainText('Sending 1 of 4 to Wavelog.');
  releaseFirst();
  await expect(page.getByTestId('send-bar')).toContainText('3 delivered. 1 refused: see To do.');
  expect(posts(mock).map((r) => /<CALL:\d+>(\S+)/.exec(String(r.body?.string))?.[1])).toEqual(['W1AW', 'K1ABC', 'DL1XYZ', 'G4ABC']);
  await expect(row(page, 'DL1XYZ')).toContainText('Wavelog refused the QSO: 20m is not in its band list.');
  await expect(seg(page, 'To do')).toHaveText(/To do\s*1$/);
  await expect(page.getByTestId('log-notice')).toContainText('3 delivered. 1 refused: see To do.');
});

test('shows a refused API key with Fix, and sends again once the key is replaced', async ({ page }) => {
  const mock = await mockWavelog(page);
  mock.qso = () => ({ status: 403, body: { status: 'failed', reason: 'API key does not have write permissions' } });
  await start(page, '#/log', wavelogOnly());
  await addQso(page, 'YB0AZK', { grid: 'OI33' });
  await sendButton(page).click();
  const r = row(page, 'YB0AZK');
  await expect(r).toContainText('Wavelog · refused');
  await expect(r).toContainText('Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.');
  await expect(page.getByTestId('send-bar')).toContainText('Wavelog refused YB0AZK: see To do.');
  await expect(seg(page, 'To do')).toHaveText(/To do\s*1$/);

  await r.getByRole('button', { name: 'Fix the QSO with YB0AZK' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wavelog' })).toBeVisible();
  mock.qso = () => ({ status: 201, body: { status: 'created', adif_count: 1, adif_errors: 0 } });
  await page.getByLabel('API key').fill('new-key-rw');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/The key can read and write\./)).toBeVisible();

  await page.goto('./#/log');
  await expect(row(page, 'YB0AZK')).toContainText('Wavelog · not sent');
  await sendButton(page).click();
  await expect(row(page, 'YB0AZK').getByText('Wavelog: delivered')).toBeAttached();
  expect(posts(mock).at(-1)?.body?.key).toBe('new-key-rw');
});

test('disables Send to Wavelog offline, with the reason, and sends one QSO from its sheet', async ({ page, context }) => {
  const mock = await mockWavelog(page);
  await start(page, '#/log', wavelogOnly());
  await addQso(page, 'ZL1TQK', { grid: 'RF72' });
  await addQso(page, 'VK3ARR', { grid: 'QF22' });
  await context.setOffline(true);
  await expect(sendButton(page)).toBeDisabled();
  await expect(page.getByText('No connection. Send when the phone is online.')).toBeVisible();
  await context.setOffline(false);
  await expect(sendButton(page)).toBeEnabled();

  await row(page, 'VK3ARR').getByRole('button', { name: /^VK3ARR/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit QSO' });
  await expect(sheet).toContainText('Not sent');
  await sheet.getByRole('textbox', { name: 'Comment' }).fill('Sent from the sheet');
  await sheet.getByRole('button', { name: 'Send to Wavelog' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(page, 'VK3ARR').getByText('Wavelog: delivered')).toBeAttached();
  await expect(row(page, 'ZL1TQK')).toContainText('Wavelog · not sent');
  expect(posts(mock)).toHaveLength(1);
  // The edit was saved first, so Wavelog got it.
  expect(posts(mock)[0].body?.string).toContain('<COMMENT:19>Sent from the sheet');
  await expect(sendButton(page)).toHaveText('Send 1 QSO to Wavelog');
});

test('with Send automatically on, keeps QSOs waiting offline and sends them when the phone comes online', async ({ page, context }) => {
  const mock = await mockWavelog(page);
  await start(page, '#/log', wavelogOnly({ sendAutomatically: true }));
  await context.setOffline(true);
  await addQso(page, 'ZL1TQK');
  await page.clock.fastForward(70_000);
  await expect(row(page, 'ZL1TQK')).toContainText('Wavelog · waiting');
  expect(posts(mock)).toHaveLength(0);
  await seg(page, 'To do').click();
  await expect(page.getByTestId('send-bar')).toContainText('1 QSO waiting for Wavelog.');
  await expect(page.getByText('No connection. Send when the phone is online.')).toBeVisible();

  await context.setOffline(false);
  // Delivered QSOs leave To do.
  await expect(page.getByText('Nothing to do')).toBeVisible();
  expect(posts(mock)).toHaveLength(1);
  await seg(page, 'All').click();
  await expect(row(page, 'ZL1TQK').getByText('Wavelog: delivered')).toBeAttached();
});

test('turning Send automatically on sends QSOs not sent, and new ones after the Undo window', async ({ page }) => {
  const mock = await mockWavelog(page);
  await start(page, '#/log', wavelogOnly());
  await addQso(page, 'VK3ARR');
  await page.clock.fastForward(60_000);
  expect(posts(mock)).toHaveLength(0);

  await page.goto('./#/settings/logging');
  const toggle = page.getByRole('switch', { name: /Send automatically/ });
  await expect(toggle).not.toBeChecked();
  await page.getByText('Send automatically', { exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => posts(mock).length).toBe(1);

  await addQso(page, 'VK4TMZ');
  await expect(row(page, 'VK4TMZ')).toContainText('Wavelog · waiting');
  await page.clock.fastForward(11_000);
  await expect(row(page, 'VK4TMZ').getByText('Wavelog: delivered')).toBeAttached();
  expect(posts(mock)).toHaveLength(2);

  // Stays on after a reload.
  await page.reload();
  await page.goto('./#/settings/logging');
  await expect(page.getByRole('switch', { name: /Send automatically/ })).toBeChecked();
});

test('starts an activation from Spots, counts its QSOs and ends it', async ({ page }) => {
  await start(page, '#/spots', activations());
  await page.getByRole('button', { name: /^Start activation/ }).click();
  const form = page.getByRole('dialog', { name: 'Start activation' });
  const refInput = form.getByRole('textbox', { name: 'Reference' });
  await refInput.fill('VK0921');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('VK0921 is not a POTA reference. They look like VK-0921.');
  await refInput.fill('vk-0921');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await form.getByLabel('Programme').selectOption('SOTA');
  await refInput.fill('vk3/vc-012');
  await refInput.press('Enter');
  await expect(form.getByRole('button', { name: 'Remove SOTA VK3/VC-012' })).toBeVisible();
  await form.getByRole('textbox', { name: 'Callsign on air' }).fill('vk3/9v1ne');
  await form.getByRole('textbox', { name: 'Grid' }).fill('qf22lb');
  await form.getByRole('button', { name: 'Start activation' }).click();
  await expect(form).toBeHidden();

  await expect(page.getByRole('heading', { name: 'Activation' })).toBeVisible();
  await expect(page.getByText('POTA VK-0921 · SOTA VK3/VC-012', { exact: true })).toBeVisible();
  await expect(page.getByText('Operating as VK3/9V1NE · QF22lb')).toBeVisible();
  await expect(page.getByText('0 of 10 · 10 more')).toBeVisible();
  await expect(page.getByText('0 of 4 stations · 4 more')).toBeVisible();
  await expect(page.getByText(/^UTC day ends in 10 h 4[45] min$/)).toBeVisible();

  // Operate shows one line for the activation.
  await page.goto('./#/operate');
  await expect(page.getByRole('link', { name: /^Activation POTA VK-0921 \+1, 0 of 10\./ })).toBeVisible();

  await addQso(page, 'VK2ESN');
  await addQso(page, 'ZL1TQK', { grid: 'RF72' });
  await addQso(page, 'ZL1TQK', { grid: 'RF72' });
  await expect(row(page, 'VK2ESN')).toBeVisible();
  await page.goto('./#/spots');
  await expect(page.getByText('2 of 10 · 8 more')).toBeVisible();
  await expect(page.getByText('2 of 4 stations · 2 more')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /POTA VK-0921/ })).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByText('By band: 20m 3')).toBeVisible();
  await expect(page.getByRole('button', { name: /^ZL1TQK/ })).toHaveCount(2);
  await expect(page.getByText('POTA and SOTA files ready')).toBeVisible();

  // Edit: a second park joins, and the QSOs take it.
  await page.getByRole('button', { name: 'Edit activation' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit activation' });
  await edit.getByLabel('Programme').selectOption('POTA');
  await edit.getByRole('textbox', { name: 'Reference' }).fill('VK-0922');
  await edit.getByRole('button', { name: 'Add', exact: true }).click();
  await edit.getByRole('button', { name: 'Save activation' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('POTA VK-0921 · SOTA VK3/VC-012 · POTA VK-0922', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /POTA VK-0922/ })).toHaveAttribute('aria-valuenow', '2');

  await page.getByRole('button', { name: 'End activation…' }).click();
  const confirm = page.getByRole('dialog', { name: 'End activation?' });
  await expect(confirm).toContainText('The 3 QSOs stay on this phone.');
  await confirm.getByRole('button', { name: 'Keep operating' }).click();
  await expect(page.getByRole('heading', { name: 'Activation' })).toBeVisible();
  await page.getByRole('button', { name: 'End activation…' }).click();
  await page.getByRole('dialog', { name: 'End activation?' }).getByRole('button', { name: 'End activation' }).click();
  await expect(page.getByRole('button', { name: /^Start activation/ })).toBeVisible();
  await page.goto('./#/operate');
  await expect(page.getByRole('link', { name: /^Activation / })).toHaveCount(0);

  // QSOs after the end belong to no activation; the ended one is in the log with its files.
  await addQso(page, 'W1AW', { grid: 'FN31' });
  await seg(page, 'Activations').click();
  await expect(page.getByRole('heading', { name: 'POTA VK-0921 · SOTA VK3/VC-012 · POTA VK-0922' })).toBeVisible();
  await expect(page.locator('li.lr')).toHaveCount(3);
});

/** Serves small park and summit lists in place of the build's (tools/refdata formats). */
async function routeRefs(page: Page) {
  const source = (entry: string) => ({ title: 't', status: 'ok', url: 'u', publisher: 'p', terms: 't', fetchedAt: null, checkedAt: null, dataDate: null, rawBytes: null, records: 1, entry, files: 2, bytes: 1, gzipBytes: 1 });
  const files: Record<string, unknown> = {
    'manifest.json': { format: 1, generatedAt: '2026-10-13T00:00:00Z', sources: { pota: source('pota/index.e2e.json'), sota: source('sota/index.e2e.json') } },
    'pota/index.e2e.json': { format: 1, programme: 'POTA', separator: '-', count: 3, shards: [{ key: 'SG', file: 'SG.e2e.json', count: 3, bytes: 300, squares: 'OJ11' }] },
    'pota/SG.e2e.json': {
      format: 1,
      programme: 'POTA',
      key: 'SG',
      rows: [
        ['0001', 'Admiralty National Park', 1.4484, 103.779, 1],
        ['0002', 'Ang Mo Kio Town Garden East National Park', 1.3707, 103.85, 1],
        ['0099', 'Closed Test Park', 1.351, 103.82, 0],
      ],
    },
    'sota/index.e2e.json': { format: 1, programme: 'SOTA', separator: '/', count: 1, shards: [{ key: '9V', file: '9V.e2e.json', count: 1, bytes: 100, squares: 'OJ11', name: 'Singapore' }] },
    'sota/9V.e2e.json': { format: 1, programme: 'SOTA', key: '9V', association: 'Singapore', regions: { SG: 'Singapore' }, rows: [['SG-001', 'Bukit Timah Test Hill', 1.354, 103.776, 164, 1, 20100101, 0]] },
  };
  await page.route(/\/data\/(manifest\.json|pota\/.*|sota\/.*)$/, (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/data\//, '');
    return files[path] ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(files[path]) }) : route.fulfill({ status: 404 });
  });
}

test('suggests parks and summits as a reference is typed and near the phone, with their names', async ({ page, context }) => {
  await routeRefs(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 1.352, longitude: 103.8198, accuracy: 20 });
  await start(page, '#/spots', activations());
  await page.getByRole('button', { name: /^Start activation/ }).click();
  const form = page.getByRole('dialog', { name: 'Start activation' });
  const refInput = form.getByRole('textbox', { name: 'Reference' });

  // Typed: the parks that begin with the text, by name; a tap adds one.
  await refInput.fill('sg-000');
  await expect(form.getByRole('button', { name: /^Add POTA / })).toHaveCount(2);
  await form.getByRole('button', { name: 'Add POTA SG-0002, Ang Mo Kio Town Garden East National Park' }).click();
  await expect(refInput).toHaveValue('');
  await expect(form.getByRole('button', { name: 'Remove POTA SG-0002' })).toBeVisible();
  await expect(form.getByText('Ang Mo Kio Town Garden East National Park')).toBeVisible();

  // Nearby: the grid from the fix, and the active parks and summits around, nearest first.
  await form.getByRole('button', { name: 'Find nearby parks and summits' }).click();
  await expect(form.getByRole('textbox', { name: 'Grid' })).toHaveValue('OJ11vi');
  const nearby = form.getByRole('button', { name: /^Add (POTA|SOTA) .* km$/ });
  await expect(nearby).toHaveCount(2);
  await expect(nearby.first()).toHaveAccessibleName('Add SOTA 9V/SG-001, Bukit Timah Test Hill, 4.9 km');
  await expect(nearby.last()).toHaveAccessibleName('Add POTA SG-0001, Admiralty National Park, 12 km');
  await nearby.first().click();
  await expect(form.getByText('Bukit Timah Test Hill')).toBeVisible();

  await form.getByRole('textbox', { name: 'Callsign on air' }).fill('9v1ne/p');
  await form.getByRole('button', { name: 'Start activation' }).click();
  await expect(page.getByText('POTA SG-0002 · SOTA 9V/SG-001', { exact: true })).toBeVisible();
});

test('suggests the other station\'s park as it is typed in Add QSO', async ({ page }) => {
  await routeRefs(page);
  await start(page, '#/log', activations());
  await page.getByRole('button', { name: 'Add QSO' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add QSO' });
  const theirs = sheet.getByRole('textbox', { name: 'Their park or summit' });
  await theirs.fill('9v/sg-001, sg-000');
  await expect(sheet.getByRole('button', { name: /^Use POTA / })).toHaveCount(2);
  await sheet.getByRole('button', { name: 'Use POTA SG-0001, Admiralty National Park' }).click();
  await expect(theirs).toHaveValue('9V/SG-001, SG-0001');
  await expect(sheet.getByRole('button', { name: /^Use / })).toHaveCount(0);
});

test('a logged QSO joins the running activation from Edit QSO and leaves it again', async ({ page }) => {
  await start(page, '#/log', activations(mockupLog({ running: true })));
  const fields = () =>
    page.evaluate(
      () =>
        new Promise<{ activationId: string | null; myPotaRef: string; stationCallsign: string } | undefined>((resolve) => {
          const req = indexedDB.open('rr73');
          req.onsuccess = () => {
            const all = req.result.transaction('qsos').objectStore('qsos').getAll();
            all.onsuccess = () => resolve((all.result as { call: string; activationId: string | null; myPotaRef: string; stationCallsign: string }[]).find((q) => q.call === 'JA1KXM'));
          };
        }),
    );
  // JA1KXM was logged as 9V1NE, outside the activation running as VK3/9V1NE.
  await row(page, 'JA1KXM').getByRole('button', { name: /JA1KXM/ }).click();
  const edit = page.getByRole('dialog', { name: 'Edit QSO' });
  const part = edit.getByRole('switch', { name: /^Part of the activation/ });
  await expect(part).not.toBeChecked();
  await expect(edit.getByText('POTA VK-0921 · SOTA VK3/VC-012, made as 9V1NE')).toBeVisible();
  await part.check();
  await edit.getByRole('button', { name: 'Save QSO' }).click();
  await expect(edit).toBeHidden();
  await expect.poll(fields).toMatchObject({ activationId: 'act-live', myPotaRef: 'VK-0921', stationCallsign: '9V1NE' });
  await page.goto('./#/spots');
  await expect(page.getByRole('progressbar', { name: /POTA VK-0921/ })).toHaveAttribute('aria-valuenow', '8');

  // Wavelog already holds it: the change waits for the operator to make it there too.
  await page.goto('./#/log');
  await expect(row(page, 'JA1KXM')).toContainText('Wavelog: changed');
  await row(page, 'JA1KXM').getByRole('button', { name: /^JA1KXM/ }).click();
  await expect(part).toBeChecked();
  await part.uncheck();
  await edit.getByRole('button', { name: 'Save QSO' }).click();
  await expect.poll(fields).toMatchObject({ activationId: null, myPotaRef: '', stationCallsign: '9V1NE' });
  await page.goto('./#/spots');
  await expect(page.getByRole('progressbar', { name: /POTA VK-0921/ })).toHaveAttribute('aria-valuenow', '7');
});

test('exports a POTA file by download, marks it submitted, and shares through the share sheet where it can', async ({ page }) => {
  await page.addInitScript(() => {
    // Chromium on Linux has no Web Share; make that certain so the download path runs.
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
  });
  await start(page, '#/log/activations', activations(mockupLog()));
  await expect(seg(page, 'To do')).toHaveText(/To do\s*3$/);
  const card = page.getByRole('article', { name: /POTA VK-0921 · SOTA VK3\/VC-012/ });
  await expect(card).toContainText('Wavelog: all 7 delivered');
  await expect(card).toContainText('POTA VK-0921, 11 Oct 2026: file ready');
  await expect(card).toContainText('SOTA VK3/VC-012, 11 Oct 2026: submitted 12 Oct');

  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Share the POTA VK-0921, 11 Oct 2026 file' }).click()]);
  expect(download.suggestedFilename()).toBe('VK3-9V1NE@VK-0921-20261011.adi');
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text.split('<EOR>').length - 1).toBe(7);
  expect(text).toContain('<PROGRAMID:4>RR73');
  expect(text).toContain('<MY_SIG:4>POTA <MY_SIG_INFO:7>VK-0921 <MY_POTA_REF:7>VK-0921');
  expect(text).toContain('<STATION_CALLSIGN:9>VK3/9V1NE');

  // Where the browser can share files, the same button hands the file to the share sheet.
  await page.evaluate(() => {
    const w = window as unknown as { shared: { name: string; type: string; text: string }[] };
    w.shared = [];
    Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        for (const f of data.files ?? []) w.shared.push({ name: f.name, type: f.type, text: await f.text() });
      },
    });
  });
  await card.getByRole('button', { name: 'Share the POTA VK-0921, 11 Oct 2026 file' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: { name: string; type: string }[] }).shared.map((f) => [f.name, f.type]))).toEqual([['VK3-9V1NE@VK-0921-20261011.adi', 'text/plain']]);
  // Without Web Share again, for the downloads below.
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));

  await card.getByRole('button', { name: 'Mark the POTA VK-0921, 11 Oct 2026 file submitted' }).click();
  await expect(card).toContainText('POTA VK-0921, 11 Oct 2026: submitted 13 Oct');
  await expect(seg(page, 'To do')).toHaveText(/To do\s*2$/);

  // The whole log as ADIF from the toolbar.
  await seg(page, 'All').click();
  const [all] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export ADIF' }).click()]);
  expect(all.suggestedFilename()).toBe('RR73 9V1NE 20261013.adi');
  expect(readFileSync((await all.path())!, 'utf8').split('<EOR>').length - 1).toBe(11);
});

test('fixes a station location refusal by choosing another station location', async ({ page }) => {
  const mock = await mockWavelog(page);
  // Wavelog refuses QSOs made as VK3/9V1NE under the Home location (9V1NE), as its import does.
  mock.qso = (body) =>
    body.station_profile_id === '7'
      ? { status: 201, body: { status: 'created', adif_count: 1, adif_errors: 0 } }
      : { status: 400, body: { status: 'abort', adif_count: 1, adif_errors: 1, messages: ['', 'Differing station callsign <b>VK3/9V1NE</b> while importing QSO with VK2ESN for <b>9V1NE</b>: SKIPPED<br>'] } };
  await start(page, '#/spots', activations(wavelogOnly()));
  await page.getByRole('button', { name: /^Start activation/ }).click();
  const form = page.getByRole('dialog', { name: 'Start activation' });
  await form.getByRole('textbox', { name: 'Reference' }).fill('VK-0921');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await form.getByRole('textbox', { name: 'Callsign on air' }).fill('VK3/9V1NE');
  await expect(form.getByText('Wavelog refuses QSOs made as VK3/9V1NE under Home, which is for 9V1NE. Choose a station location for VK3/9V1NE.')).toBeVisible();
  await form.getByRole('button', { name: 'Start activation' }).click();
  await expect(form).toBeHidden();
  await addQso(page, 'VK2ESN');
  await sendButton(page).click();
  const r = row(page, 'VK2ESN');
  await expect(r).toContainText('Wavelog refused the QSO: it was made as VK3/9V1NE and the station location Home is for 9V1NE. Choose a station location for VK3/9V1NE.');
  await r.getByRole('button', { name: 'Fix the QSO with VK2ESN' }).click();
  const sheet = page.getByRole('dialog', { name: 'Choose a station location' });
  await expect(sheet).toContainText('The choice applies to the activation POTA VK-0921.');
  await sheet.getByRole('button', { name: /VK3 portable/ }).click();
  await expect(r).toContainText('Wavelog · not sent');
  await sendButton(page).click();
  await expect(r.getByText('Wavelog: delivered')).toBeAttached();
  expect(mock.requests.filter((x) => x.path === '/api/qso').map((x) => x.body?.station_profile_id)).toEqual(['1', '7']);
});

test('backs up the log, restores it into an empty log, and imports ADIF from another logger with Undo', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }));
  await start(page, '#/settings/logging', activations(mockupLog()));
  const notice = page.getByTestId('log-notice');

  // Back up the log: one JSON file, with the QSOs, the activation and the ledger, and no Wavelog key.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Back up the log/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^RR73 backup 9V1NE \d{8}\.json$/);
  const text = readFileSync((await download.path())!, 'utf8');
  const backup = JSON.parse(text) as { format: string; qsos: unknown[]; activations: unknown[]; ledger: unknown[] };
  expect(backup.format).toBe('rr73-backup');
  expect(backup.activations).toHaveLength(1);
  expect(backup.qsos.length).toBeGreaterThan(0);
  expect(text).not.toContain(API_KEY);
  await expect(page.getByRole('status').filter({ hasText: 'Downloaded RR73 backup' })).toBeAttached();

  // Imported into the same log, it adds nothing.
  const file = page.getByTestId('import-file');
  await file.setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(notice).toContainText(`No QSOs to import. ${backup.qsos.length} were in the log already.`);

  // ADIF from another logger: 2 new QSOs, and one the log holds already. Undo takes them out.
  const adif = [
    '<ADIF_VER:5>3.1.4 <EOH>',
    '<CALL:5>K1ABC <QSO_DATE:8>20261001 <TIME_ON:4>1200 <BAND:3>40m <MODE:3>FT8 <EOR>',
    '<CALL:6>DL1ABC <QSO_DATE:8>20261001 <TIME_ON:4>1210 <BAND:3>40m <MODE:3>FT8 <EOR>',
    '<CALL:7>BAD CALL <BAND:3>40m <EOR>',
  ].join('\n');
  await file.setInputFiles({ name: 'other.adi', mimeType: 'text/plain', buffer: Buffer.from(adif) });
  await expect(notice).toContainText('Imported 2 QSOs. 1 record could not be read.');
  await notice.getByRole('button', { name: 'Undo' }).click();
  await expect(notice).toContainText('Removed the 2 imported QSOs');

  // Not a log at all.
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello') });
  await expect(page.getByRole('status').filter({ hasText: 'The file is neither ADIF nor an RR73 backup.' })).toBeAttached();

  // A new phone: the backup brings the log back whole, delivered QSOs still delivered.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const fresh = await ctx.newPage();
  await fresh.goto('./#/settings/logging');
  await fresh.getByTestId('import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(fresh.getByTestId('log-notice')).toContainText(`Imported ${backup.qsos.length} QSOs and 1 activation.`);
  const stored = await fresh.evaluate(
    () =>
      new Promise<{ qsos: number; ledger: number }>((resolve) => {
        const r = indexedDB.open('rr73');
        r.onsuccess = () => {
          const tx = r.result.transaction(['qsos', 'ledger'], 'readonly');
          const q = tx.objectStore('qsos').count();
          const l = tx.objectStore('ledger').count();
          tx.oncomplete = () => resolve({ qsos: q.result, ledger: l.result });
        };
      }),
  );
  expect(stored).toEqual({ qsos: backup.qsos.length, ledger: backup.ledger.length });
  await ctx.close();
});
