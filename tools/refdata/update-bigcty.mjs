#!/usr/bin/env node
// Replaces the Big CTY release committed in refdata/bigcty with the newest release on
// country-files.com, when that is newer, and prints what changed. It commits nothing: the
// maintainer reviews the change, runs the tests and commits it. The app build never contacts the
// site (build.mjs).
//
//   docker compose run --rm node node tools/refdata/update-bigcty.mjs
//
// --dir DIR updates another copy of the release (default refdata/bigcty).
//
// Requests, one attempt each: the category page, then the newest release post and its zip when
// they are newer than the committed release. The zip must hold cty.dat, cty.csv and copyright.txt
// and convert as build.mjs converts it; otherwise nothing is written.

import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { download } from './http.mjs';
import { BIGCTY_DIR, bigCtyZipFiles, convertBigCtyFiles, convertCommittedBigCty, ctyCsvColumns, findLatestBigCty, readBigCtyRelease } from './cty.mjs';

/** Entities by primary prefix, and the number of prefixes and callsigns listed, from converted cty.json. */
function summary(converted) {
  const json = JSON.parse(converted.files['cty.json']);
  const entities = new Map(json.entities.map((e) => [e.prefix, e.name]));
  const aliases = json.entities.reduce((n, e) => n + (e.aliases ? e.aliases.split(' ').length : 0), 0);
  return { entities, aliases };
}

/**
 * Checks country-files.com for a release newer than the one in dir and, when there is one,
 * replaces dir's files with it. Returns { changed, from, to, ... } and logs what changed. Throws on
 * a failed request or a zip that does not convert, leaving dir as it was. fetch is injectable for
 * tests.
 */
export async function updateBigCty({ dir = BIGCTY_DIR, fetch = globalThis.fetch, log = () => {} } = {}) {
  const current = readBigCtyRelease(dir);
  const get = async (url) => (await download(url, { fetch })).body;
  const latest = await findLatestBigCty(async (url) => (await get(url)).toString('utf8'), { after: current.date });
  if (latest.date <= current.date || !latest.url) {
    log(`Big CTY of ${current.date} is the newest release; nothing changed`);
    return { changed: false, from: current, to: current };
  }
  const zip = await get(latest.url);
  const files = bigCtyZipFiles(zip);
  for (const name of ['dat', 'csv', 'copyright']) {
    if (!files[name]) throw new Error(`${latest.url} has no ${{ dat: 'cty.dat', csv: 'cty.csv', copyright: 'copyright.txt' }[name]}; the committed release stays`);
  }
  const columns = Buffer.from(ctyCsvColumns(files.csv.toString('latin1')), 'latin1');
  // Converted from what will be committed, as the build will convert it.
  const after = convertBigCtyFiles({ dat: files.dat, csv: columns, copyright: files.copyright }, latest);
  for (const w of after.warnings) log(`warning: ${w}`);
  const before = summary(convertCommittedBigCty(dir));
  const now = summary(after);

  // Each file is written beside its old copy, then all are moved into place.
  const out = {
    'cty.dat.gz': gzipSync(files.dat, { level: 9 }),
    'cty-columns.csv.gz': gzipSync(columns, { level: 9 }),
    'copyright.txt': files.copyright,
    'release.json': `${JSON.stringify({ date: latest.date, url: latest.url }, null, 2)}\n`,
  };
  for (const [name, body] of Object.entries(out)) writeFileSync(new URL(`${name}.new`, dir), body);
  for (const name of Object.keys(out)) renameSync(new URL(`${name}.new`, dir), new URL(name, dir));

  const added = [...now.entities].filter(([p]) => !before.entities.has(p)).map(([p, n]) => `${n} (${p})`);
  const removed = [...before.entities].filter(([p]) => !now.entities.has(p)).map(([p, n]) => `${n} (${p})`);
  const renamed = [...now.entities].filter(([p, n]) => before.entities.has(p) && before.entities.get(p) !== n).map(([p, n]) => `${before.entities.get(p)} to ${n} (${p})`);
  log(`Big CTY updated from ${current.date} to ${latest.date}: ${latest.url}`);
  log(`Entities: ${before.entities.size} to ${now.entities.size}`);
  log(`Prefixes and callsigns: ${before.aliases.toLocaleString('en-GB')} to ${now.aliases.toLocaleString('en-GB')}`);
  log(`Added: ${added.length ? added.join(', ') : 'none'}`);
  log(`Removed: ${removed.length ? removed.join(', ') : 'none'}`);
  if (renamed.length) log(`Renamed: ${renamed.join(', ')}`);
  log('Review the change, run the tests and commit it');
  return { changed: true, from: current, to: latest, entities: [before.entities.size, now.entities.size], added, removed, renamed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--dir');
  const dir = at > 0 ? pathToFileURL(`${resolve(process.argv[at + 1] ?? '.')}/`) : BIGCTY_DIR;
  updateBigCty({ dir, log: (line) => console.log(`update-bigcty: ${line}`) }).then(
    () => process.exit(0),
    (e) => {
      console.error(`update-bigcty: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
