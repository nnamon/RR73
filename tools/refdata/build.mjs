#!/usr/bin/env node
// Builds RR73's reference data into web/public/data, where Vite copies it into the app:
//
//   cty.json                 country file (Big CTY), precached by the service worker
//   lotw.<hash>.json         LoTW users and last upload dates
//   pota/index.<hash>.json   POTA parks index, and one shard per prefix
//   sota/index.<hash>.json   SOTA summits index, and one shard per association
//   manifest.json            sources, terms, dates, counts and sizes; precached
//
// Run in the node container from the repository root:
//
//   docker compose run --rm node node tools/refdata/build.mjs
//
// Options: --out DIR (default web/public/data), --cache DIR (default .refdata-cache),
// --only cty,lotw,pota,sota, --ask cty,lotw (the sources that may be requested; the others build
// from the cache; CI chooses them with ci-plan.mjs), --offline (no requests: build from what the
// cache holds), --strict (exit 1 when a source is stale or missing).
//
// Each source is requested at most once per UTC day, with one attempt and no retries. The
// attempt is recorded in the cache before the request goes out. The cache
// keeps each source's download, its HTTP validators and the converted files, stamped with a hash
// of the converter code. A later day's request can come back 304 Not Modified, and a changed
// converter converts the kept download again without a request. When a download fails, the build
// ships the cached copy (status "stale") or goes on without the source (status "missing"); the app
// treats a missing source as unavailable.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { download } from './http.mjs';
import { BIGCTY_LIST, BIGCTY_PAGE, convertBigCty, latestBigCty } from './cty.mjs';
import { LOTW_URL, convertLotw } from './lotw.mjs';
import { POTA_URL, convertPota } from './pota.mjs';
import { SOTA_URL, convertSota } from './sota.mjs';

const CHECKED = '13 October 2026';

/** A hash of the code that turns downloads into data files: a change re-converts cached downloads. */
export const CONVERTER = (() => {
  const h = createHash('sha256');
  for (const f of ['cty.mjs', 'lotw.mjs', 'pota.mjs', 'sota.mjs', 'refs.mjs', 'csv.mjs', 'zip.mjs', '../../web/src/lib/reference/cty.ts', '../../web/src/lib/reference/format.ts']) {
    h.update(readFileSync(fileURLToPath(new URL(f, import.meta.url))));
  }
  return h.digest('hex').slice(0, 12);
})();

/** A plain download that the server may answer 304 when it has not changed. */
const conditional = (url) => async ({ get }) => {
  const r = await get(url, { conditional: true });
  return r.notModified ? { unchanged: true } : { url, body: r.body, etag: r.etag, lastModified: r.lastModified, info: {} };
};

export const SOURCES = {
  cty: {
    title: 'Big CTY country file',
    url: BIGCTY_PAGE,
    publisher: 'Jim Reisert AD1C, https://www.country-files.com',
    terms: 'MIT licence (https://www.country-files.com/copyright/). cty.json carries the copyright and permission notice.',
    async fetch({ get, prev }) {
      const list = await get(BIGCTY_LIST);
      const latest = latestBigCty(list.body.toString('utf8'));
      if (!latest) throw new Error(`${BIGCTY_LIST} links no Big CTY zip`);
      if (prev?.url === latest.url) return { unchanged: true };
      const zip = await get(latest.url);
      return { url: latest.url, body: zip.body, info: { date: latest.date } };
    },
    convert: (body, { url, info }) => convertBigCty(body, { url, date: info.date }),
  },
  lotw: {
    title: 'LoTW user activity list',
    url: LOTW_URL,
    publisher: 'ARRL, Logbook of The World',
    terms: `No terms of use published for this file (checked ${CHECKED} at https://lotw.arrl.org/lotw-help/developer-query-lotw-users/, which documents it for logging software).`,
    fetch: conditional(LOTW_URL),
    convert: (body) => convertLotw(body.toString('utf8')),
  },
  pota: {
    title: 'POTA parks list',
    url: POTA_URL,
    publisher: 'Parks on the Air, https://pota.app',
    terms: `No terms of use found for the parks list (checked ${CHECKED}: docs.pota.app, its resources page). Use of the POTA logo needs a licence; RR73 does not use the logo.`,
    fetch: conditional(POTA_URL),
    convert: (body) => convertPota(body.toString('utf8')),
  },
  sota: {
    title: 'SOTA summits list',
    url: SOTA_URL,
    publisher: 'Summits on the Air, https://www.sota.org.uk',
    terms: `Source: Summits on the Air. No endorsement implied. No licence found for the summits list (checked ${CHECKED}). Downloaded at build time only, once a day at most; RR73 uses no SOTA API.`,
    fetch: conditional(SOTA_URL),
    convert: (body) => convertSota(body.toString('utf8')),
  },
};

export const SOURCE_IDS = Object.keys(SOURCES);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const day = (iso) => (iso ? iso.slice(0, 10) : null);

/**
 * One source's cache entry, in <cache>/<id>/: meta.json, raw (the download) and files/ (the
 * converted files).
 */
class Entry {
  constructor(cacheDir, id) {
    this.dir = join(cacheDir, id);
    this.meta = readJson(join(this.dir, 'meta.json')) ?? {};
  }

  get hasRaw() {
    return !!this.meta.fetchedAt && existsSync(join(this.dir, 'raw'));
  }

  /** Converted files exist and come from this converter. */
  hasFiles(converter) {
    return this.meta.converter === converter && !!this.meta.files?.length && this.meta.files.every((f) => existsSync(join(this.dir, 'files', f)));
  }

  raw() {
    return readFileSync(join(this.dir, 'raw'));
  }

  writeRaw(body) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'raw'), body);
  }

  writeFiles(files) {
    rmSync(join(this.dir, 'files'), { recursive: true, force: true });
    for (const [path, body] of Object.entries(files)) {
      const to = join(this.dir, 'files', path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, body);
    }
  }

  save() {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2));
  }
}

/** Converts the entry's download and records the result in its metadata. */
function convertEntry(id, src, entry, converter, log) {
  const m = entry.meta;
  const result = src.convert(entry.raw(), { url: m.url, info: m.info ?? {} });
  entry.writeFiles(result.files);
  Object.assign(m, { converter, dataDate: result.dataDate ?? null, records: result.records, entry: result.entry, files: Object.keys(result.files), warnings: result.warnings ?? [] });
  for (const w of m.warnings) log(`${id}: ${w}`);
}

/** Brings one source's cache entry up to date and returns it with whether it has files to ship. */
async function refresh(id, src, { cacheDir, now, fetch, offline, ask, converter, log }) {
  const entry = new Entry(cacheDir, id);
  const m = entry.meta;
  const today = now.toISOString().slice(0, 10);
  let request = true;
  let failure = null;
  if (offline) {
    log(`${id}: offline build, no request made`);
    request = false;
  } else if (!ask.includes(id)) {
    log(`${id}: not asked in this build; built from the cache`);
    request = false;
  } else if (day(m.attemptedAt) === today) {
    log(`${id}: already requested today (${m.attemptedAt}); next request on a later UTC day`);
    request = false;
  }
  if (request) {
    m.attemptedAt = now.toISOString();
    // Recorded first: a build stopped during the download still counts as today's request.
    entry.save();
    try {
      const get = (url, opts = {}) => {
        const validated = opts.conditional && entry.hasRaw;
        return download(url, { fetch, etag: validated ? m.etag : null, lastModified: validated ? m.lastModified : null });
      };
      const got = await src.fetch({ get, prev: entry.hasRaw ? m : null });
      if (got.unchanged) {
        log(`${id}: unchanged since ${day(m.fetchedAt)}`);
      } else {
        entry.writeRaw(got.body);
        Object.assign(m, { url: got.url, etag: got.etag ?? null, lastModified: got.lastModified ?? null, info: got.info ?? {}, fetchedAt: now.toISOString(), rawBytes: got.body.length, converter: null });
        log(`${id}: downloaded ${got.url} (${got.body.length} bytes)`);
      }
      m.checkedAt = now.toISOString();
      m.error = null;
    } catch (e) {
      m.error = e instanceof Error ? e.message : String(e);
      failure = `download failed (${m.error})`;
    }
  }
  let converted = false;
  if (entry.hasRaw && !entry.hasFiles(converter)) {
    converted = true;
    try {
      convertEntry(id, src, entry, converter, log);
      log(`${id}: converted: ${m.records} records`);
    } catch (e) {
      m.error = `conversion failed: ${e instanceof Error ? e.message : String(e)}`;
      m.converter = null;
      failure = m.error;
    }
  }
  const hasFiles = entry.hasFiles(converter);
  if (failure) log(`${id}: ${failure}; ${hasFiles ? `shipping the copy from ${day(m.fetchedAt)}` : 'building without it'}`, 'warning');
  if (request || converted) entry.save();
  return { meta: m, hasFiles, dir: entry.dir };
}

/** The manifest entry for a source, after its files are copied to out. */
function manifestEntry(src, meta, hasFiles, outDir) {
  const entry = {
    title: src.title,
    status: !hasFiles ? 'missing' : meta.error ? 'stale' : 'ok',
    url: hasFiles ? meta.url : src.url,
    publisher: src.publisher,
    terms: src.terms,
    fetchedAt: hasFiles ? meta.fetchedAt : null,
    checkedAt: hasFiles ? (meta.checkedAt ?? null) : null,
    dataDate: hasFiles ? (meta.dataDate ?? null) : null,
    rawBytes: hasFiles ? (meta.rawBytes ?? null) : null,
    records: hasFiles ? meta.records : null,
    entry: hasFiles ? meta.entry : null,
    files: 0,
    bytes: 0,
    gzipBytes: 0,
  };
  if (hasFiles) {
    for (const f of meta.files) {
      const body = readFileSync(join(outDir, f));
      entry.files++;
      entry.bytes += body.length;
      entry.gzipBytes += gzipSync(body, { level: 9 }).length;
    }
  }
  if (entry.status === 'stale') entry.note = `The download on ${day(meta.attemptedAt)} failed (${meta.error}). This copy is from ${day(meta.fetchedAt)}.`;
  if (entry.status === 'missing') entry.note = meta.error ? `The download on ${day(meta.attemptedAt)} failed (${meta.error}).` : 'This build has no copy.';
  return entry;
}

/** Empties the output directory, refusing one that does not look like a previous build's. */
function prepareOut(outDir) {
  if (existsSync(outDir) && readdirSync(outDir).length && !existsSync(join(outDir, 'manifest.json'))) {
    throw new Error(`${outDir} has files but no manifest.json; not emptying it`);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
}

/**
 * Builds the sources named in only into outDir and writes manifest.json. Returns the manifest.
 * Only the sources named in ask may be requested. fetch, now and converter are injectable for
 * tests.
 */
export async function buildAll({ outDir, cacheDir, only = SOURCE_IDS, ask = SOURCE_IDS, offline = false, now = new Date(), fetch = globalThis.fetch, converter = CONVERTER, log = () => {} }) {
  const unknown = [...only, ...ask].filter((id) => !SOURCES[id]);
  if (unknown.length) throw new Error(`unknown source ${unknown.join(', ')}; sources are ${SOURCE_IDS.join(', ')}`);
  prepareOut(outDir);
  const manifest = { format: 1, generatedAt: now.toISOString(), sources: {} };
  for (const id of only) {
    const src = SOURCES[id];
    const { meta, hasFiles, dir } = await refresh(id, src, { cacheDir, now, fetch, offline, ask, converter, log });
    if (hasFiles) for (const f of meta.files) cpSync(join(dir, 'files', f), join(outDir, f));
    manifest.sources[id] = manifestEntry(src, meta, hasFiles, outDir);
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function parseArgs(argv) {
  const opts = { outDir: 'web/public/data', cacheDir: '.refdata-cache', only: SOURCE_IDS, ask: SOURCE_IDS, offline: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.outDir = argv[++i];
    else if (a === '--cache') opts.cacheDir = argv[++i];
    else if (a === '--only') opts.only = argv[++i].split(',').filter(Boolean);
    else if (a === '--ask') opts.ask = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--offline') opts.offline = true;
    else if (a === '--strict') opts.strict = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const actions = process.env.GITHUB_ACTIONS === 'true';
  const log = (line, level) => {
    console.log(`refdata: ${line}`);
    if (level === 'warning' && actions) console.log(`::warning title=Reference data::${line}`);
  };
  const manifest = await buildAll({ ...opts, outDir: resolve(opts.outDir), cacheDir: resolve(opts.cacheDir), log });
  let bad = 0;
  for (const [id, s] of Object.entries(manifest.sources)) {
    console.log(`refdata: ${id}: ${s.status}, ${s.records ?? 0} records, ${s.files} files, ${s.bytes} bytes (${s.gzipBytes} gzipped)`);
    if (s.status !== 'ok') bad++;
  }
  return opts.strict && bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`refdata: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
