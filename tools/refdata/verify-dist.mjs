#!/usr/bin/env node
// Checks a built app for its reference data: every file the manifest names is in the build and
// reads back, and the service worker precaches the core files (manifest, country file) and none
// of the optional ones (LoTW, parks, summits), which load only when their feature is on.
//
//   node tools/refdata/verify-dist.mjs web/dist

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCtyJson, readLotwJson, readManifest, readPotaShard, readRefIndex, readSotaShard } from '../../web/src/lib/reference/format.ts';

const CORE = new Set(['data/manifest.json', 'data/cty.json']);

/** Returns a list of problems; empty when the build is consistent. */
export function verifyDist(dist) {
  const problems = [];
  const data = join(dist, 'data');
  const read = (path) => JSON.parse(readFileSync(join(data, path), 'utf8'));
  if (!existsSync(join(data, 'manifest.json'))) return ['data/manifest.json is missing: run tools/refdata/build.mjs before the app build'];
  let manifest;
  try {
    manifest = readManifest(read('manifest.json'));
  } catch (e) {
    return [`data/manifest.json does not read: ${e.message}`];
  }
  // The country file is core: every CQ row reads it, and 0.11.1 to 0.12.2 shipped without it.
  if (!manifest.sources.cty?.entry) problems.push('cty: the country file is missing; the build pins a release in fixtures/ for this');
  for (const [id, s] of Object.entries(manifest.sources)) {
    if (!s.entry) {
      if (s.status !== 'missing') problems.push(`${id}: status ${s.status} without an entry file`);
      continue;
    }
    if (!existsSync(join(data, s.entry))) {
      problems.push(`${id}: data/${s.entry} is missing`);
      continue;
    }
    try {
      if (id === 'cty') readCtyJson(read(s.entry));
      if (id === 'lotw') readLotwJson(read(s.entry));
      if (id === 'pota' || id === 'sota') {
        const index = readRefIndex(read(s.entry), id.toUpperCase());
        for (const shard of index.shards) {
          const path = `${id}/${shard.file}`;
          if (!existsSync(join(data, path))) problems.push(`${id}: data/${path} is missing`);
          else (id === 'pota' ? readPotaShard : readSotaShard)(read(path), shard.key);
        }
      }
    } catch (e) {
      problems.push(`${id}: ${e.message}`);
    }
  }
  const swPath = join(dist, 'sw.js');
  if (!existsSync(swPath)) problems.push('sw.js is missing');
  else {
    const precached = new Set([...readFileSync(swPath, 'utf8').matchAll(/url:\s*"(data\/[^"]+)"/g)].map((m) => m[1]));
    for (const core of CORE) {
      if (!precached.has(core)) problems.push(`sw.js does not precache ${core}`);
    }
    for (const url of precached) if (!CORE.has(url)) problems.push(`sw.js precaches ${url}, which loads only when its feature is on`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2] ?? 'web/dist';
  const problems = verifyDist(dist);
  for (const p of problems) console.error(`verify-dist: ${p}`);
  if (problems.length) process.exit(1);
  const m = readManifest(JSON.parse(readFileSync(join(dist, 'data', 'manifest.json'), 'utf8')));
  for (const [id, s] of Object.entries(m.sources)) console.log(`verify-dist: ${id}: ${s.status}, ${s.files} files, ${s.bytes} bytes (${s.gzipBytes} gzipped)`);
}
