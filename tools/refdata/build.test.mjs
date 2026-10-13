// The build's fetch policy, with a fake network: one request per source per UTC day, one attempt,
// conditional requests on later days, and a cached or missing copy when a download fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readManifest } from '../../web/src/lib/reference/format.ts';
import { buildAll } from './build.mjs';
import { BIGCTY_LIST } from './cty.mjs';
import { LOTW_URL } from './lotw.mjs';
import { POTA_URL } from './pota.mjs';
import { SOTA_URL } from './sota.mjs';
import { FIXTURES, fakeFetch, join, tempDir } from './testing.mjs';

const ZIP_URL = 'https://www.country-files.com/bigcty/download/2026/bigcty-20260915.zip';
const fixture = (name) => readFileSync(`${FIXTURES}${name}`);

/** Routes answering every source; validated ones answer 304 to a matching If-None-Match. */
function network() {
  const validated = (body, etag) => (headers) => (headers['if-none-match'] === etag ? { status: 304 } : { body, headers: { etag, 'last-modified': 'Mon, 12 Oct 2026 07:13:31 GMT' } });
  return {
    [BIGCTY_LIST]: { body: fixture('bigcty-category.html') },
    [ZIP_URL]: { body: fixture('bigcty-excerpt.zip') },
    [LOTW_URL]: validated(fixture('lotw-excerpt.csv'), '"lotw-1"'),
    [POTA_URL]: validated(fixture('pota-excerpt.csv'), '"pota-1"'),
    [SOTA_URL]: validated(fixture('sota-excerpt.csv'), '"sota-1"'),
  };
}

const DAY1 = new Date('2026-10-13T05:00:00Z');
const DAY1_LATER = new Date('2026-10-13T23:59:00Z');
const DAY2 = new Date('2026-10-14T00:01:00Z');

function dirs() {
  const root = tempDir('refdata');
  return { outDir: join(root, 'out'), cacheDir: join(root, 'cache') };
}

test('first build: every source fetched once, files and manifest written', async () => {
  const d = dirs();
  const fetch = fakeFetch(network());
  const manifest = readManifest(await buildAll({ ...d, now: DAY1, fetch }));
  assert.deepEqual(
    fetch.calls.map((c) => c.url),
    [BIGCTY_LIST, ZIP_URL, LOTW_URL, POTA_URL, SOTA_URL],
  );
  assert.ok(fetch.calls.every((c) => /^RR73-refdata\/1 /.test(c.headers['user-agent'])));
  for (const id of ['cty', 'lotw', 'pota', 'sota']) {
    const s = manifest.sources[id];
    assert.equal(s.status, 'ok', id);
    assert.equal(s.fetchedAt, DAY1.toISOString());
    assert.ok(s.entry && existsSync(join(d.outDir, s.entry)), `${id} entry ${s.entry}`);
    assert.ok(s.files >= 1 && s.bytes > 0 && s.gzipBytes > 0);
  }
  assert.equal(manifest.sources.cty.url, ZIP_URL);
  assert.equal(manifest.sources.cty.dataDate, '2026-09-15');
  assert.equal(manifest.sources.cty.records, 7);
  assert.equal(manifest.sources.lotw.records, 9);
  assert.equal(manifest.sources.pota.records, 13);
  assert.equal(manifest.sources.pota.files, 9);
  assert.equal(manifest.sources.sota.records, 2);
  assert.equal(manifest.sources.sota.dataDate, '2026-10-13');
  assert.match(manifest.sources.sota.terms, /^Source: Summits on the Air\. No endorsement implied\./);
  assert.equal(manifest.sources.lotw.rawBytes, fixture('lotw-excerpt.csv').length);
  assert.ok(existsSync(join(d.outDir, 'manifest.json')));
});

test('the same UTC day: no requests, the cached copy ships', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()) });
  const again = fakeFetch(network());
  const manifest = readManifest(await buildAll({ ...d, now: DAY1_LATER, fetch: again }));
  assert.deepEqual(again.calls, []);
  for (const s of Object.values(manifest.sources)) {
    assert.equal(s.status, 'ok');
    assert.equal(s.fetchedAt, DAY1.toISOString());
    assert.ok(existsSync(join(d.outDir, s.entry)));
  }
});

test('the next day: conditional requests, unchanged data keeps its fetch date', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()) });
  const next = fakeFetch(network());
  const manifest = readManifest(await buildAll({ ...d, now: DAY2, fetch: next }));
  // The category page still links the same zip, so the zip is not downloaded again.
  assert.deepEqual(
    next.calls.map((c) => c.url),
    [BIGCTY_LIST, LOTW_URL, POTA_URL, SOTA_URL],
  );
  assert.equal(next.calls[1].headers['if-none-match'], '"lotw-1"');
  assert.equal(next.calls[3].headers['if-modified-since'], 'Mon, 12 Oct 2026 07:13:31 GMT');
  for (const s of Object.values(manifest.sources)) {
    assert.equal(s.status, 'ok');
    assert.equal(s.fetchedAt, DAY1.toISOString());
    assert.equal(s.checkedAt, DAY2.toISOString());
  }
});

test('a failed download: one attempt, the older copy ships as stale', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()) });
  const failing = fakeFetch({ ...network(), [SOTA_URL]: new Error('connect ETIMEDOUT') });
  const lines = [];
  const manifest = readManifest(await buildAll({ ...d, now: DAY2, fetch: failing, log: (l) => lines.push(l) }));
  assert.equal(failing.calls.filter((c) => c.url === SOTA_URL).length, 1);
  const sota = manifest.sources.sota;
  assert.equal(sota.status, 'stale');
  assert.equal(sota.fetchedAt, DAY1.toISOString());
  assert.equal(sota.note, 'The download on 2026-10-14 failed (connect ETIMEDOUT). This copy is from 2026-10-13.');
  assert.ok(existsSync(join(d.outDir, sota.entry)));
  assert.ok(lines.includes('sota: download failed (connect ETIMEDOUT); shipping the copy from 2026-10-13'));
  // Later the same day: still no second attempt, still stale.
  const later = fakeFetch(network());
  const after = readManifest(await buildAll({ ...d, now: new Date('2026-10-14T12:00:00Z'), fetch: later }));
  assert.deepEqual(later.calls, []);
  assert.equal(after.sources.sota.status, 'stale');
});

test('a failed first download: the source is missing and the build goes on', async () => {
  const d = dirs();
  const failing = fakeFetch({ ...network(), [POTA_URL]: { status: 503, body: 'busy' } });
  const manifest = readManifest(await buildAll({ ...d, now: DAY1, fetch: failing }));
  const pota = manifest.sources.pota;
  assert.equal(pota.status, 'missing');
  assert.equal(pota.entry, null);
  assert.equal(pota.files, 0);
  assert.equal(pota.note, `The download on 2026-10-13 failed (${POTA_URL} answered HTTP 503).`);
  assert.equal(existsSync(join(d.outDir, 'pota')), false);
  assert.equal(manifest.sources.cty.status, 'ok');
});

test('a converter error counts as a failed download', async () => {
  const d = dirs();
  const broken = fakeFetch({ ...network(), [SOTA_URL]: { body: 'not the summits list' } });
  const manifest = readManifest(await buildAll({ ...d, now: DAY1, fetch: broken, only: ['sota'] }));
  assert.equal(manifest.sources.sota.status, 'missing');
  assert.match(manifest.sources.sota.note ?? '', /conversion failed: the summits list has no SummitCode header/);
  assert.deepEqual(Object.keys(manifest.sources), ['sota']);
});

test('offline builds make no requests; --only limits the sources', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()), only: ['cty', 'lotw'] });
  const none = fakeFetch(network());
  const manifest = readManifest(await buildAll({ ...d, now: DAY2, fetch: none, offline: true }));
  assert.deepEqual(none.calls, []);
  assert.equal(manifest.sources.cty.status, 'ok');
  assert.equal(manifest.sources.pota.status, 'missing');
  assert.equal(manifest.sources.pota.note, 'This build has no copy.');
  await assert.rejects(buildAll({ ...d, now: DAY2, fetch: none, only: ['iota'] }), /unknown source iota/);
  // The refused build left the previous output in place.
  assert.ok(existsSync(join(d.outDir, 'manifest.json')));
});

test('only the sources in ask are requested; the others build from the cache', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()), only: ['cty', 'sota'] });
  const some = fakeFetch(network());
  const manifest = readManifest(await buildAll({ ...d, now: DAY2, fetch: some, ask: ['lotw', 'pota'] }));
  assert.deepEqual(
    some.calls.map((c) => c.url),
    [LOTW_URL, POTA_URL],
  );
  assert.equal(manifest.sources.sota.status, 'ok');
  assert.equal(manifest.sources.sota.fetchedAt, DAY1.toISOString());
  await assert.rejects(buildAll({ ...d, now: DAY2, fetch: some, ask: ['iota'] }), /unknown source iota/);
});

test('a request is recorded before it goes out, so a stopped build does not ask again that day', async () => {
  const d = dirs();
  let seen = null;
  const watching = async (url) => {
    if (url === SOTA_URL) seen = JSON.parse(readFileSync(join(d.cacheDir, 'sota', 'meta.json'), 'utf8')).attemptedAt;
    // The process stops here, mid-download.
    if (url === SOTA_URL) await new Promise(() => {});
    return fakeFetch(network())(url);
  };
  void buildAll({ ...d, now: DAY1, fetch: watching, only: ['sota'] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen, DAY1.toISOString());
  const again = fakeFetch(network());
  await buildAll({ ...d, now: DAY1_LATER, fetch: again, only: ['sota'] });
  assert.deepEqual(again.calls, []);
});

test('a converter change converts the cached download again without a request', async () => {
  const d = dirs();
  await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()), converter: 'old' });
  const meta = JSON.parse(readFileSync(join(d.cacheDir, 'pota', 'meta.json'), 'utf8'));
  assert.equal(meta.converter, 'old');
  const none = fakeFetch(network());
  const lines = [];
  const manifest = readManifest(await buildAll({ ...d, now: DAY1_LATER, fetch: none, converter: 'new', log: (l) => lines.push(l) }));
  assert.deepEqual(none.calls, []);
  assert.ok(lines.includes('pota: converted: 13 records'));
  for (const s of Object.values(manifest.sources)) {
    assert.equal(s.status, 'ok');
    assert.equal(s.fetchedAt, DAY1.toISOString());
  }
  assert.equal(JSON.parse(readFileSync(join(d.cacheDir, 'pota', 'meta.json'), 'utf8')).converter, 'new');
  // The same holds offline, and the Big CTY release date survives the conversion.
  const offline = readManifest(await buildAll({ ...d, now: DAY2, fetch: none, converter: 'newer', offline: true }));
  assert.equal(offline.sources.cty.dataDate, '2026-09-15');
  assert.deepEqual(none.calls, []);
});

test('a download that does not convert leaves the source missing', async () => {
  const d = dirs();
  const broken = fakeFetch({ ...network(), [POTA_URL]: { body: 'reference\nUS-0001\n' } });
  const lines = [];
  const manifest = readManifest(await buildAll({ ...d, now: DAY1, fetch: broken, only: ['pota'], log: (l) => lines.push(l) }));
  assert.equal(manifest.sources.pota.status, 'missing');
  assert.match(manifest.sources.pota.note ?? '', /conversion failed: the parks list has no reference and latitude columns/);
  assert.ok(lines.some((l) => /^pota: conversion failed/.test(l)));
});

test('the output directory is emptied only when it holds a previous build', async () => {
  const d = dirs();
  mkdirSync(d.outDir, { recursive: true });
  writeFileSync(join(d.outDir, 'notes.txt'), 'keep me');
  await assert.rejects(buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()) }), /has files but no manifest.json/);
  assert.equal(readFileSync(join(d.outDir, 'notes.txt'), 'utf8'), 'keep me');
});

test('verify-dist: a consistent build passes; missing shards and wrong precache entries fail', async () => {
  const { verifyDist } = await import('./verify-dist.mjs');
  const { cpSync, rmSync } = await import('node:fs');
  const d = dirs();
  const manifest = await buildAll({ ...d, now: DAY1, fetch: fakeFetch(network()) });
  const dist = join(tempDir('dist'), 'dist');
  cpSync(d.outDir, join(dist, 'data'), { recursive: true });
  const sw = (urls) => writeFileSync(join(dist, 'sw.js'), `precacheAndRoute([${urls.map((u) => `{url:"${u}",revision:"1"}`).join(',')}])`);
  sw(['index.html', 'data/manifest.json', 'data/cty.json']);
  assert.deepEqual(verifyDist(dist), []);
  sw(['data/manifest.json', `data/${manifest.sources.lotw.entry}`]);
  assert.deepEqual(verifyDist(dist), ['sw.js does not precache data/cty.json', `sw.js precaches data/${manifest.sources.lotw.entry}, which loads only when its feature is on`]);
  sw(['data/manifest.json', 'data/cty.json']);
  const index = JSON.parse(readFileSync(join(dist, 'data', manifest.sources.pota.entry), 'utf8'));
  rmSync(join(dist, 'data', 'pota', index.shards[0].file));
  assert.deepEqual(verifyDist(dist), [`pota: data/pota/${index.shards[0].file} is missing`]);
  rmSync(join(dist, 'data', 'manifest.json'));
  assert.match(verifyDist(dist)[0], /manifest.json is missing/);
});
