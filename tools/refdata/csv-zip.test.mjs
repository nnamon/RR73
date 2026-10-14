import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, csvRecords } from './csv.mjs';
import { unzip } from './zip.mjs';
import { FIXTURES, storedZip } from './testing.mjs';

test('CSV: quotes, doubled quotes, commas, CRLF, a byte-order mark and blank lines', () => {
  const text = '﻿"a","b"\r\n"x, y","say ""hi"""\r\n\r\nplain,\n"multi\nline",3';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
    ['plain', ''],
    ['multi\nline', '3'],
  ]);
});

test('CSV: records keyed by the header, missing fields empty', () => {
  assert.deepEqual(csvRecords(parseCsv('k,v,w\n1,2\n')), [{ k: '1', v: '2', w: '' }]);
  assert.deepEqual(csvRecords([]), []);
});

test('zip: reads the deflated files Info-ZIP wrote', () => {
  const files = unzip(readFileSync(`${FIXTURES}bigcty-excerpt.zip`));
  assert.deepEqual([...files.keys()], ['cty.dat', 'cty.csv', 'copyright.txt']);
  assert.match(files.get('cty.dat').toString('latin1'), /^Sov Mil Order of Malta: {3}15: {2}28: {2}EU:/);
  assert.match(files.get('copyright.txt').toString('utf8'), /Permission is hereby granted/);
});

test('zip: reads stored files', () => {
  const files = unzip(storedZip({ 'a.txt': 'alpha', 'dir/b.txt': Buffer.from([1, 2, 3]) }));
  assert.equal(files.get('a.txt').toString(), 'alpha');
  assert.deepEqual([...files.get('dir/b.txt')], [1, 2, 3]);
});

test('zip: refuses damaged and foreign data', () => {
  const zip = storedZip({ 'a.txt': 'alpha' });
  const flipped = Buffer.from(zip);
  flipped[30 + 'a.txt'.length] ^= 0xff;
  assert.throws(() => unzip(flipped), /CRC/);
  assert.throws(() => unzip(Buffer.from('this is not a zip archive at all, no records')), /not a zip archive/);
});
