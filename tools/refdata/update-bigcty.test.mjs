// update-bigcty.mjs with a fake network, on a copy of a committed release made from the Big CTY
// excerpt in fixtures/reference: a newer release replaces the files, the same release changes
// nothing, and a failure leaves the files as they were.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BIGCTY_LIST, bigCtyZipFiles, convertCommittedBigCty, ctyCsvColumns, readBigCtyRelease } from './cty.mjs';
import { updateBigCty } from './update-bigcty.mjs';
import { FIXTURES, fakeFetch, join, storedZip, tempDir } from './testing.mjs';

const EXCERPT = bigCtyZipFiles(readFileSync(`${FIXTURES}bigcty-excerpt.zip`));
const OLD_ZIP = 'https://www.country-files.com/bigcty/download/2026/bigcty-20260915.zip';
const NEW_ZIP = 'https://www.country-files.com/bigcty/download/2026/bigcty-20261008.zip';
const NEW_POST = 'https://www.country-files.com/big-cty-08-october-2026/';
const NAMES = ['cty.dat.gz', 'cty-columns.csv.gz', 'copyright.txt', 'release.json'];

/** A committed release of 15 September 2026 holding the excerpt's 7 entities, in a new directory. */
function committed() {
  const dir = tempDir('bigcty');
  writeFileSync(join(dir, 'cty.dat.gz'), gzipSync(EXCERPT.dat));
  writeFileSync(join(dir, 'cty-columns.csv.gz'), gzipSync(Buffer.from(ctyCsvColumns(EXCERPT.csv.toString('latin1')), 'latin1')));
  writeFileSync(join(dir, 'copyright.txt'), EXCERPT.copyright);
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ date: '2026-09-15', url: OLD_ZIP }));
  return { dir, url: pathToFileURL(`${dir}/`), files: () => Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))])) };
}

// The release of 8 October: Anguilla (VP2E) gone, Testland (T9X) added, Fiji renamed.
const TESTLAND_DAT = 'Testland:                 14:  27:  EU:   50.00:   -10.00:    -1.0:  T9X:\r\n    T9X,=T90TEST;\r\n';
const NEW_DAT = Buffer.from(
  EXCERPT.dat
    .toString('latin1')
    .split(/(?<=;\r\n)/)
    .filter((r) => !r.startsWith('Anguilla:'))
    .map((r) => r.replace(/^Fiji: {4}/, 'Fiji Is.:'))
    .join('') + TESTLAND_DAT,
  'latin1',
);
const NEW_CSV = Buffer.from(
  EXCERPT.csv
    .toString('latin1')
    .split('\r\n')
    .filter((l) => l && !l.startsWith('VP2E,'))
    .map((l) => l.replace(',Fiji,', ',Fiji Is.,'))
    .concat('T9X,Testland,999,EU,14,27,50.00,-10.00,-1.0,T9X =T90TEST;', '')
    .join('\r\n'),
  'latin1',
);
const NEW_ZIP_BODY = storedZip({ 'cty.dat': NEW_DAT, 'cty.csv': NEW_CSV, 'copyright.txt': EXCERPT.copyright, 'README.TXT': 'x' });

// The category page as country-files.com serves it from October 2026: each release an excerpt,
// with the zip linked only from the release's own post.
const page = (...posts) => posts.map((p) => `<article><a href="https://www.country-files.com/big-cty-${p}/">Big CTY</a></article>`).join('\n');

function network(routes = {}) {
  return fakeFetch({
    [BIGCTY_LIST]: { body: page('15-september-2026', '08-october-2026') },
    [NEW_POST]: { body: `<p>Download <a href="${NEW_ZIP}">bigcty-20261008.zip</a></p>` },
    [NEW_ZIP]: { body: NEW_ZIP_BODY },
    ...routes,
  });
}

test('a newer release replaces the committed files and says what changed', async () => {
  const c = committed();
  const fetch = network();
  const lines = [];
  const r = await updateBigCty({ dir: c.url, fetch, log: (l) => lines.push(l) });
  assert.deepEqual(fetch.calls.map((x) => x.url), [BIGCTY_LIST, NEW_POST, NEW_ZIP]);
  assert.deepEqual([r.changed, r.from.date, r.to.date, r.entities], [true, '2026-09-15', '2026-10-08', [7, 7]]);
  assert.deepEqual([r.added, r.removed, r.renamed], [['Testland (T9X)'], ['Anguilla (VP2E)'], ['Fiji to Fiji Is. (3D2)']]);
  assert.deepEqual(lines, [
    `Big CTY updated from 2026-09-15 to 2026-10-08: ${NEW_ZIP}`,
    'Entities: 7 to 7',
    'Prefixes and callsigns: 88 to 89',
    'Added: Testland (T9X)',
    'Removed: Anguilla (VP2E)',
    'Renamed: Fiji to Fiji Is. (3D2)',
    'Review the change, run the tests and commit it',
  ]);
  // The files hold the new release as the build reads it, and nothing else is left behind.
  assert.deepEqual(readdirSync(c.dir).sort(), [...NAMES].sort());
  assert.deepEqual(readBigCtyRelease(c.url), { date: '2026-10-08', url: NEW_ZIP });
  assert.deepEqual(gunzipSync(readFileSync(join(c.dir, 'cty.dat.gz'))), NEW_DAT);
  assert.equal(gunzipSync(readFileSync(join(c.dir, 'cty-columns.csv.gz'))).toString('latin1'), ctyCsvColumns(NEW_CSV.toString('latin1')));
  assert.deepEqual(readFileSync(join(c.dir, 'copyright.txt')), EXCERPT.copyright);
  const built = convertCommittedBigCty(c.url);
  assert.deepEqual([built.dataDate, built.url, built.records, built.warnings], ['2026-10-08', NEW_ZIP, 7, []]);
  const testland = JSON.parse(built.files['cty.json']).entities.find((e) => e.prefix === 'T9X');
  assert.equal(testland.dxcc, 999);
});

test('the same release, or an older one, changes nothing and downloads no zip', async () => {
  for (const listing of [page('06-september-2026-3', '15-september-2026') + `<a href="${OLD_ZIP}">x</a>`, page('06-september-2026-3')]) {
    const c = committed();
    const before = c.files();
    const fetch = network({ [BIGCTY_LIST]: { body: listing } });
    const lines = [];
    const r = await updateBigCty({ dir: c.url, fetch, log: (l) => lines.push(l) });
    assert.equal(r.changed, false);
    assert.deepEqual(fetch.calls.map((x) => x.url), [BIGCTY_LIST]);
    assert.deepEqual(lines, ['Big CTY of 2026-09-15 is the newest release; nothing changed']);
    assert.deepEqual(c.files(), before);
  }
});

test('a failure leaves the committed files untouched', async () => {
  const cases = [
    [{ [BIGCTY_LIST]: new Error('connect ETIMEDOUT') }, /connect ETIMEDOUT/],
    [{ [BIGCTY_LIST]: { status: 503, body: 'busy' } }, /answered HTTP 503/],
    [{ [BIGCTY_LIST]: { body: '<html>no releases</html>' } }, /links no Big CTY release/],
    [{ [NEW_ZIP]: { status: 404, body: 'gone' } }, /bigcty-20261008\.zip answered HTTP 404/],
    [{ [NEW_ZIP]: { body: storedZip({ 'cty.dat': NEW_DAT, 'copyright.txt': EXCERPT.copyright }) } }, /has no cty\.csv; the committed release stays/],
    [{ [NEW_ZIP]: { body: storedZip({ 'cty.dat': NEW_DAT, 'cty.csv': NEW_CSV }) } }, /has no copyright\.txt/],
    [{ [NEW_ZIP]: { body: storedZip({ 'cty.dat': NEW_DAT, 'cty.csv': 'T9X,Testland,none,EU;\r\n', 'copyright.txt': EXCERPT.copyright }) } }, /has no DXCC code/],
    [{ [NEW_ZIP]: { body: Buffer.from('not a zip') } }, /not a zip archive/],
  ];
  for (const [routes, error] of cases) {
    const c = committed();
    const before = c.files();
    await assert.rejects(updateBigCty({ dir: c.url, fetch: network(routes) }), error);
    assert.deepEqual(c.files(), before);
  }
});

test('the repository holds one copy of the release, which the build and the tests read', () => {
  const dir = new URL('../../refdata/bigcty/', import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), [...NAMES].sort());
  assert.equal(existsSync(new URL('../../fixtures/reference/bigcty-20260915/', import.meta.url)), false);
});
