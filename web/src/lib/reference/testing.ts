// Test doubles for the reference data: an in-memory Cache API, a fake origin serving data/, and
// the country file the app ships.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCtyCsvCodes, parseCtyDat, toCtyJson } from './cty';
import type { CtyJson } from './format';

/** The Big CTY release committed in refdata/bigcty, which the build converts into the app. */
export const BIGCTY_DIR = new URL('../../../../refdata/bigcty/', import.meta.url);

/** cty.dat of the committed release, as released. */
export function bigCtyDat(): string {
  return gunzipSync(readFileSync(new URL('cty.dat.gz', BIGCTY_DIR))).toString('latin1');
}

/**
 * cty.json as the build makes it from the release committed in refdata/bigcty (cty.dat as
 * released, and the cty.csv columns with the DXCC codes).
 */
export function bigCtyFixture(): CtyJson {
  const csv = gunzipSync(readFileSync(new URL('cty-columns.csv.gz', BIGCTY_DIR))).toString('latin1');
  const release = JSON.parse(readFileSync(new URL('release.json', BIGCTY_DIR), 'utf8')) as { date: string; url: string };
  return toCtyJson(parseCtyDat(bigCtyDat()), parseCtyCsvCodes(csv), { version: release.date, source: release.url, notice: 'MIT' });
}

/** The parts of the Cache API that HttpStore uses, kept in memory. */
export class MemoryCache {
  readonly entries = new Map<string, { body: string; headers: [string, string][] }>();
  /** When set, put() throws, as a full store does. */
  failPuts = false;

  private key(req: RequestInfo | URL): string {
    return typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
  }

  match(req: RequestInfo | URL): Promise<Response | undefined> {
    const e = this.entries.get(this.key(req));
    return Promise.resolve(e ? new Response(e.body, { headers: e.headers }) : undefined);
  }

  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    if (this.failPuts) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.entries.set(this.key(req), { body: await res.text(), headers: [...res.headers] });
  }

  delete(req: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(this.key(req)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((k) => new Request(k)));
  }
}

export class MemoryCaches {
  readonly caches = new Map<string, MemoryCache>();

  open(name: string): Promise<MemoryCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new MemoryCache();
      this.caches.set(name, c);
    }
    return Promise.resolve(c);
  }

  /** Typed as the browser's CacheStorage for HttpStore. */
  asStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}

export const ORIGIN = 'https://app.test/RR73/data/';

/**
 * A fetch serving JSON files under ORIGIN from a map of paths to values. A value of Error makes
 * the request fail as a network error; offline makes every request fail. Records requested paths.
 */
export function fakeOrigin(files: Record<string, unknown>) {
  const state = { files, offline: false, requests: [] as string[] };
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
    state.requests.push(path);
    if (state.offline) return Promise.reject(new TypeError('Load failed'));
    const v = state.files[path];
    if (v instanceof Error) return Promise.reject(v);
    if (v === undefined) return Promise.resolve(new Response('Not found', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } }));
  };
  return { state, fetch: fetch as typeof globalThis.fetch };
}
