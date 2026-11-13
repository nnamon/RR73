// The decoder's prefix table (crates/rr73-decode/data/prefixes.txt) matches the committed Big CTY
// release, and the generator follows cty.dat's rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREFIXES_FILE, committedPrefixesText, prefixesText } from './prefixes.mjs';

test('the committed prefix table is current', () => {
  assert.equal(readFileSync(PREFIXES_FILE, 'utf8'), committedPrefixesText(), 'run node tools/refdata/prefixes.mjs');
});

test('exact callsigns add their entity to their prefix, and countries spanning zones are exempt', () => {
  const dat = [
    'Hawaii:  31:  61:  OC:   21.12:   157.48:    10.0:  KH6:',
    '    AH6,KH6,=W7ABC;',
    'Japan:  25:  45:  AS:   36.40:  -138.38:    -9.0:  JA:',
    '    JA,7J,=JA1XYZ/1;',
    'United States:  05:  08:  NA:   37.60:    91.87:     5.0:  K:',
    '    K,W,AA0(4)[7];',
  ].join('\n');
  const lines = prefixesText(dat, '2026-09-15').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['@ 21.1 -157.5', '@ 36.4 138.4', '@ 37.6 -91.9', '7J 1', 'AA0 * 2', 'AH6 0', 'JA 1', 'K * 2', 'KH6 0', 'W * 2 0']);
});
