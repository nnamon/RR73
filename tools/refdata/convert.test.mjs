// Converters against fixtures in fixtures/reference: trimmed copies of the real files (category
// page, Big CTY zip excerpt, LoTW, POTA and SOTA lines) and a hand-written SOTA sample. The output
// goes through the app's own readers (web/src/lib/reference/format.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readCtyJson, readLotwJson, readPotaShard, readRefIndex, readSotaShard } from '../../web/src/lib/reference/format.ts';
import { convertBigCty, latestBigCty } from './cty.mjs';
import { convertLotw } from './lotw.mjs';
import { convertPota } from './pota.mjs';
import { convertSota, dmyNumber } from './sota.mjs';
import { position, square } from './refs.mjs';
import { FIXTURES, storedZip } from './testing.mjs';

const fixture = (name) => readFileSync(`${FIXTURES}${name}`);
const ZIP_URL = 'https://www.country-files.com/bigcty/download/2026/bigcty-20260915.zip';

test('Big CTY: the newest zip on the category page', () => {
  assert.deepEqual(latestBigCty(fixture('bigcty-category.html').toString('utf8')), { url: ZIP_URL, date: '2026-09-15' });
  assert.equal(latestBigCty('<html>no links</html>'), null);
});

test('Big CTY: cty.json from the zip, with DXCC codes from cty.csv and the notice', () => {
  const out = convertBigCty(fixture('bigcty-excerpt.zip'), { url: ZIP_URL, date: '2026-09-15' });
  assert.deepEqual(out.warnings, []);
  assert.equal(out.entry, 'cty.json');
  assert.equal(out.records, 7);
  const cty = readCtyJson(JSON.parse(out.files['cty.json']));
  assert.equal(cty.version, '2026-09-15');
  assert.equal(cty.source, ZIP_URL);
  assert.match(cty.notice, /^Big CTY by Jim Reisert AD1C/);
  assert.match(cty.notice, /The above copyright notice and this permission notice shall be included/);
  const by = Object.fromEntries(cty.entities.map((e) => [e.prefix, e]));
  assert.deepEqual(Object.keys(by), ['1A', '3D2', '3D2/r', '4U1V', '9V', 'OE', 'VP2E']);
  assert.deepEqual(
    Object.values(by).map((e) => e.dxcc),
    [246, 176, 460, 206, 381, 206, 12],
  );
  assert.equal(by['4U1V'].wae, true);
  assert.equal(by['OE'].wae, false);
  // cty.dat gives longitude west positive and time west of UTC; cty.json east positive.
  assert.deepEqual([by['3D2'].lat, by['3D2'].lon, by['3D2'].utc], [-17.78, 177.92, 12]);
  assert.deepEqual([by['VP2E'].lon, by['VP2E'].utc], [-63, -4]);
  assert.match(by['3D2/r'].aliases, /^=3D22 =3D2AG\/P /);
});

test('Big CTY: a zip without cty.csv or copyright.txt still converts, with warnings', () => {
  const dat = 'Singapore:                28:  54:  AS:    1.37:  -103.78:    -8.0:  9V:\r\n    9V,S6;\r\n';
  const out = convertBigCty(storedZip({ 'cty.dat': dat }), { url: ZIP_URL, date: '2026-09-15' });
  assert.equal(out.warnings.length, 2);
  const cty = readCtyJson(JSON.parse(out.files['cty.json']));
  assert.equal(cty.entities[0].dxcc, null);
  assert.match(cty.notice, /Permission is hereby granted/);
  assert.throws(() => convertBigCty(storedZip({ 'README.TXT': 'x' }), { url: ZIP_URL, date: null }), /no cty.dat/);
});

test('LoTW: callsigns grouped by last upload date, in a hashed file', () => {
  const out = convertLotw(fixture('lotw-excerpt.csv').toString('utf8'));
  assert.match(out.entry, /^lotw\.[0-9a-f]{10}\.json$/);
  const lotw = readLotwJson(JSON.parse(out.files[out.entry]));
  assert.equal(lotw.count, 9);
  assert.equal(out.records, 9);
  assert.equal(lotw.latest, '2026-10-07');
  assert.equal(lotw.byDate['2026-10-07'], 'W1AW W1AW/4');
  assert.equal(lotw.byDate['2014-02-08'], '1A0KM');
  assert.deepEqual(Object.keys(lotw.byDate), [...Object.keys(lotw.byDate)].sort());
});

test('LoTW: duplicates keep the latest date; malformed lines are skipped and counted', () => {
  const out = convertLotw('k1abc,2020-01-01,00:00:00\nK1ABC,2024-05-06,10:00:00\nK1ABC,2022-01-01,00:00:00\nbad line\nK2X,26-01-01,1\n');
  const lotw = readLotwJson(JSON.parse(out.files[out.entry]));
  assert.deepEqual(lotw.byDate, { '2024-05-06': 'K1ABC' });
  assert.deepEqual(out.warnings, ['skipped 2 lines that are not "CALL,YYYY-MM-DD,HH:MM:SS"']);
  assert.throws(() => convertLotw('\n'), /no callsigns/);
});

test('positions: rounding, empty, out of range and 0,0', () => {
  assert.deepEqual(position('44.31', '-68.20341'), { lat: 44.31, lon: -68.2034 });
  assert.equal(position('', ''), null);
  assert.equal(position('121.497', '14.5633'), null);
  assert.equal(position('0.0', '0.0'), null);
  assert.deepEqual(position('0', '103.8'), { lat: 0, lon: 103.8 });
  assert.equal(square(41.7148, -72.7272), 'FN31');
  assert.equal(square(-37.5, 145), 'QF22');
  assert.equal(square(90, 180), 'RR99');
  assert.equal(square(-90, -180), 'AA00');
});

test('POTA: shards by prefix with the squares they cover, positions cleaned', () => {
  const out = convertPota(fixture('pota-excerpt.csv').toString('utf8'));
  assert.deepEqual(out.warnings, ['skipped 1 rows whose reference is not PREFIX-NNNN', '4 parks have no usable position (empty, out of range or 0,0)']);
  assert.equal(out.records, 13);
  assert.match(out.entry, /^pota\/index\.[0-9a-f]{10}\.json$/);
  const index = readRefIndex(JSON.parse(out.files[out.entry]), 'POTA');
  assert.equal(index.separator, '-');
  assert.equal(index.count, 13);
  assert.deepEqual(
    index.shards.map((s) => [s.key, s.count, s.squares]),
    [
      ['CA', 1, ''],
      ['FR', 2, 'JO10'],
      ['IT', 1, 'JN35'],
      ['MY', 1, ''],
      ['PH', 1, ''],
      ['PR', 2, 'FK68'],
      ['SG', 3, 'OJ11'],
      ['US', 2, 'BO19FN54'],
    ],
  );
  const rows = {};
  for (const s of index.shards) {
    const body = out.files[`pota/${s.file}`];
    assert.equal(s.file, `${s.key}.${createHash('sha256').update(body).digest('hex').slice(0, 10)}.json`);
    assert.equal(s.bytes, Buffer.byteLength(body));
    for (const r of readPotaShard(JSON.parse(body), s.key).rows) rows[`${s.key}-${r[0]}`] = r;
  }
  assert.deepEqual(rows['US-0001'], ['0001', 'Acadia National Park', 44.31, -68.2034, 1]);
  assert.deepEqual(rows['PR-0090'], ['0090', 'Desecheo National Wildlife Refuge', 18.3879, -67.4795, 0]);
  assert.deepEqual(rows['FR-1291'], ['1291', 'La Camargue Provincial Park', null, null, 0]);
  assert.deepEqual(rows['PH-0128'].slice(2, 4), [null, null]);
  assert.equal(rows['MY-0023'][1], 'Taman Rimba Ampang');
  assert.equal(rows['IT-0177'][1], 'Bosco del Vaj e "Bosc Grand" Natura 2000');
  assert.equal(rows['K-TEST'], undefined);
});

test('POTA: the same list gives the same files', () => {
  const text = fixture('pota-excerpt.csv').toString('utf8');
  assert.deepEqual(convertPota(text).files, convertPota(text).files);
  assert.throws(() => convertPota('a,b\n1,2\n'), /no reference and latitude columns/);
});

test('SOTA: the real header and rows', () => {
  const out = convertSota(fixture('sota-excerpt.csv').toString('utf8'));
  assert.deepEqual(out.warnings, []);
  assert.equal(out.records, 2);
  assert.equal(out.dataDate, '2026-10-13');
  const index = readRefIndex(JSON.parse(out.files[out.entry]), 'SOTA');
  assert.equal(index.separator, '/');
  assert.deepEqual(index.shards.map((s) => [s.key, s.count, s.squares, s.name]), [['3B8', 2, 'LG89', 'Mauritius']]);
  const shard = readSotaShard(JSON.parse(out.files[`sota/${index.shards[0].file}`]), '3B8');
  assert.equal(shard.association, 'Mauritius');
  assert.deepEqual(shard.regions, { MU: 'Mauritius' });
  assert.deepEqual(shard.rows[0], ['MU-001', 'Piton de la Petite Rivière Noire (Black River Peak)', -20.4088, 57.4077, 828, 10, 20260801, 0]);
});

test('SOTA: retired, future and unplaced summits, quoted names and bad codes', () => {
  const out = convertSota(fixture('sota-sample.csv').toString('utf8'));
  assert.deepEqual(out.warnings, ['skipped 1 rows without a summit code like W7O/CN-001 or valid dates', '1 summits have no usable position']);
  assert.equal(out.dataDate, '2026-10-01');
  const index = readRefIndex(JSON.parse(out.files[out.entry]), 'SOTA');
  assert.deepEqual(index.shards.map((s) => [s.key, s.count, s.squares]), [['XA', 5, 'JO50'], ['XB', 1, 'CN95']]);
  const xa = readSotaShard(JSON.parse(out.files[`sota/${index.shards[0].file}`]), 'XA');
  assert.deepEqual(xa.regions, { AA: 'Alpha Hills', BB: 'Bravo Range' });
  const row = Object.fromEntries(xa.rows.map((r) => [r[0], r]));
  assert.deepEqual(row['AA-002'], ['AA-002', 'Beta Hill, North Top', 50.05, 10.1, 650, 2, 20100101, 0]);
  assert.deepEqual(row['AA-003'].slice(6), [20100101, 20201231]);
  assert.deepEqual(row['BB-001'].slice(6), [20300101, 0]);
  assert.deepEqual(row['BB-002'].slice(2, 4), [null, null]);
  assert.throws(() => convertSota('no header here\n'), /no SummitCode header/);
});

test('SOTA: day-month-year dates', () => {
  assert.equal(dmyNumber('31/12/2099'), 20991231);
  assert.equal(dmyNumber('1/8/2026'), 20260801);
  assert.equal(dmyNumber('2026-08-01'), null);
});
