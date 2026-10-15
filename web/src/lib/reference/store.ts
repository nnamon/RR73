/**
 * Reads the reference data files under `data/`.
 *
 * Two kinds of file:
 *
 * - Core files, the country file (cty.json) and the manifest, are in the service worker's
 *   precache (vite.config.ts): they install and update with the app, and json() reads them with a
 *   plain fetch that the service worker answers.
 * - Optional files, the park and summit lists, are fetched only when their feature is on, and
 *   kept in the Cache API (`rr73-reference`) for offline use. Their file names carry a content
 *   hash, and each is kept under a stable slot name ("pota/US.json") with the file it came from. kept() returns the kept copy when it is the
 *   current file, else fetches the current file and replaces the copy. When that fetch fails, an
 *   older kept copy is returned marked stale: an app update while online must not take the parks
 *   away from an operator who is offline later.
 *
 * Safari does not apply its 7-day storage limit to web apps on the home screen. Not tested on a
 * device: how much the Cache API may hold there.
 */

/**
 * missing: this build has no such file (the source failed at build time, or the feature's data
 * was never built). unreachable: the network failed or the server refused. invalid: the file is
 * damaged.
 */
export type ReferenceProblem = 'missing' | 'unreachable' | 'invalid';

export class ReferenceUnavailableError extends Error {
  override name = 'ReferenceUnavailableError';
  readonly path: string;
  readonly problem: ReferenceProblem;

  constructor(path: string, problem: ReferenceProblem, detail: string) {
    super(`data/${path}: ${problem} (${detail})`);
    this.path = path;
    this.problem = problem;
  }
}

export interface KeptData {
  data: unknown;
  /** The file the data came from. */
  file: string;
  /** True when the current file could not be fetched and an older kept copy stands in. */
  stale: boolean;
}

export interface DataStore {
  /** Reads a core file, data/<path>, as JSON. */
  json(path: string): Promise<unknown>;
  /** Reads data/<file> as JSON and keeps a copy under slot for offline use. */
  kept(slot: string, file: string): Promise<KeptData>;
  /** Kept copies whose slot starts with prefix: slot to the file each came from. */
  keptFiles(prefix: string): Promise<Map<string, string>>;
  /** Removes kept copies whose slot starts with prefix and fails keep. */
  drop(prefix: string, keep?: (slot: string) => boolean): Promise<void>;
}

export const CACHE_NAME = 'rr73-reference';
/** Response header recording which file a kept copy came from. */
const FILE_HEADER = 'x-rr73-file';

export interface HttpStoreOptions {
  fetch?: typeof fetch;
  /** The Cache API; null where there is none (Node, insecure origins). */
  caches?: CacheStorage | null;
  cacheName?: string;
}

/** Reads data/ from the app's own origin. base ends with "/": "/RR73/data/". */
export class HttpStore implements DataStore {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly cacheStorage: CacheStorage | null;
  private readonly cacheName: string;

  constructor(base: string, opts: HttpStoreOptions = {}) {
    this.base = base.endsWith('/') ? base : `${base}/`;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.cacheStorage = opts.caches !== undefined ? opts.caches : typeof caches === 'undefined' ? null : caches;
    this.cacheName = opts.cacheName ?? CACHE_NAME;
  }

  private url(path: string): string {
    return this.base + path;
  }

  private async cache(): Promise<Cache | null> {
    if (!this.cacheStorage) return null;
    try {
      return await this.cacheStorage.open(this.cacheName);
    } catch {
      return null;
    }
  }

  private async fetchText(path: string): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url(path));
    } catch (e) {
      throw new ReferenceUnavailableError(path, 'unreachable', e instanceof Error ? e.message : String(e));
    }
    // A dev server answers a missing file with the app's index.html.
    if (res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')) {
      throw new ReferenceUnavailableError(path, 'missing', `HTTP ${res.status}`);
    }
    if (!res.ok) throw new ReferenceUnavailableError(path, 'unreachable', `HTTP ${res.status}`);
    return res.text();
  }

  async json(path: string): Promise<unknown> {
    return parse(await this.fetchText(path), path);
  }

  async kept(slot: string, file: string): Promise<KeptData> {
    const cache = await this.cache();
    const key = this.url(slot);
    const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
    const hitFile = hit?.headers.get(FILE_HEADER) ?? null;
    let old: { text: string; file: string } | null = null;
    if (hit && hitFile) {
      const text = await hit.text().catch(() => null);
      if (text !== null && hitFile === file) {
        try {
          return { data: parse(text, file), file, stale: false };
        } catch {
          await cache?.delete(key).catch(() => false);
        }
      } else if (text !== null) old = { text, file: hitFile };
    }
    let text: string;
    try {
      text = await this.fetchText(file);
    } catch (e) {
      if (old && e instanceof ReferenceUnavailableError) {
        try {
          return { data: parse(old.text, old.file), file: old.file, stale: true };
        } catch {
          // A damaged old copy is no fallback; report the fetch failure.
        }
      }
      throw e;
    }
    const data = parse(text, file);
    // A full store loses the offline copy, not the lookup.
    await cache?.put(key, new Response(text, { headers: { 'content-type': 'application/json', [FILE_HEADER]: file } })).catch(() => undefined);
    return { data, file, stale: false };
  }

  async keptFiles(prefix: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const cache = await this.cache();
    if (!cache) return out;
    for (const req of await cache.keys()) {
      const slot = this.slotOf(req.url);
      if (slot === null || !slot.startsWith(prefix)) continue;
      const file = (await cache.match(req).catch(() => undefined))?.headers.get(FILE_HEADER);
      if (file) out.set(slot, file);
    }
    return out;
  }

  async drop(prefix: string, keep: (slot: string) => boolean = () => false): Promise<void> {
    const cache = await this.cache();
    if (!cache) return;
    for (const req of await cache.keys()) {
      const slot = this.slotOf(req.url);
      if (slot !== null && slot.startsWith(prefix) && !keep(slot)) await cache.delete(req);
    }
  }

  /** The slot a cached request URL stands for, or null when it is outside data/. */
  private slotOf(url: string): string | null {
    const base = new URL(this.base, 'http://origin.invalid/').pathname;
    const path = new URL(url, 'http://origin.invalid/').pathname;
    return path.startsWith(base) ? path.slice(base.length) : null;
  }
}

function parse(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new ReferenceUnavailableError(path, 'invalid', e instanceof Error ? e.message : String(e));
  }
}
