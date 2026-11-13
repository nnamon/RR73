#!/usr/bin/env node
// Writes crates/rr73-decode/data/prefixes.txt, the callsign prefixes and DXCC entity positions
// that the decoder's OSD locator check reads (crates/rr73-decode/src/prefix.rs, experiment 0015),
// from the Big CTY release committed in refdata/bigcty.
//
//   docker compose run --rm node node tools/refdata/prefixes.mjs           # write the file
//   docker compose run --rm node node tools/refdata/prefixes.mjs --check   # exit 1 when stale
//
// Each prefix alias of cty.dat lists the positions a station using it may sit at: its own (the
// alias's override or its entity's) and the entity of every exact callsign whose longest prefix
// is that alias, so W calls cover Hawaii and Alaska as well as the 48 states. Exact callsigns
// themselves are left out, and so are aliases with a `/`, which no standard FT8 callsign carries.
// The prefixes of a country whose aliases span several CQ zones carry `*` before their positions,
// and the decoder exempts them: one position cannot stand for the USA, Canada, Russia, China,
// Australia or Antarctica. update-bigcty.mjs rewrites the file with each new release.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAlias, parseCtyDat } from '../../web/src/lib/reference/cty.ts';
import { readBigCtyFiles, readBigCtyRelease } from './cty.mjs';

export const PREFIXES_FILE = new URL('../../crates/rr73-decode/data/prefixes.txt', import.meta.url);

/** The prefixes file's text for a cty.dat text and the release's date. */
export function prefixesText(dat, date) {
  const entities = parseCtyDat(dat);
  const positions = [];
  const index = new Map();
  const position = (lat, lon) => {
    const key = `${lat.toFixed(1)} ${lon.toFixed(1)}`;
    if (!index.has(key)) {
      index.set(key, positions.length);
      positions.push(key);
    }
    return index.get(key);
  };
  const prefixes = new Map();
  const exempt = new Set();
  const exact = [];
  for (const e of entities) {
    // A country whose prefixes span several CQ zones (the USA, Canada, Russia, China,
    // Australia, Antarctica) is too large for one position: its prefixes are exempt.
    const zones = new Set([e.cq, ...e.tokens.map(parseAlias).filter((a) => !a.exact && a.cq !== undefined).map((a) => a.cq)]);
    for (const token of e.tokens) {
      const a = parseAlias(token);
      if (a.text.includes('/')) continue;
      const at = position(a.lat ?? e.lat, a.lon ?? e.lon);
      if (a.exact) exact.push({ call: a.text, at });
      else if (!prefixes.has(a.text)) {
        prefixes.set(a.text, new Set([at]));
        if (zones.size > 1) exempt.add(a.text);
      }
    }
  }
  for (const { call, at } of exact) {
    for (let n = call.length; n > 0; n--) {
      const set = prefixes.get(call.slice(0, n));
      if (set) {
        set.add(at);
        break;
      }
    }
  }
  const lines = [
    '# Callsign prefixes and the positions of the DXCC entities that use them, for the OSD locator',
    `# check in rr73-decode. Written by tools/refdata/prefixes.mjs from Big CTY of ${date}`,
    '# (refdata/bigcty, MIT licence, Jim Reisert AD1C); do not edit.',
    '# "@ lat lon" lines number the positions from 0 (degrees, north and east positive);',
    '# each other line is a prefix and the positions its stations may sit at, its own entity',
    '# first; "*" before them marks a country whose prefixes span several CQ zones, which the',
    '# check exempts.',
    ...positions.map((p) => `@ ${p}`),
    ...[...prefixes.keys()].sort().map((p) => {
      // The prefix's own entity first, then the other entities in index order.
      const [own, ...rest] = prefixes.get(p);
      return [p, ...(exempt.has(p) ? ['*'] : []), own, ...rest.sort((a, b) => a - b)].join(' ');
    }),
  ];
  return `${lines.join('\n')}\n`;
}

/** The prefixes file's text for the committed release. */
export function committedPrefixesText() {
  const { dat } = readBigCtyFiles();
  return prefixesText(dat.toString('latin1'), readBigCtyRelease().date);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = committedPrefixesText();
  const path = fileURLToPath(PREFIXES_FILE);
  if (process.argv.includes('--check')) {
    let old = '';
    try {
      old = readFileSync(path, 'utf8');
    } catch {
      // A missing file is stale.
    }
    if (old !== text) {
      console.error(`${path} is stale: run node tools/refdata/prefixes.mjs`);
      process.exit(1);
    }
  } else {
    writeFileSync(path, text);
  }
}
