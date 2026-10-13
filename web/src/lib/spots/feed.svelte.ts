/**
 * The spot feed: polls each enabled source while someone watches it, the page is visible and the
 * phone is online, keeps every source's last good list, and merges them.
 *
 * Sources start disabled. A disabled source makes no requests and holds no timer; disabling one
 * abandons its request in flight and hides its spots, and enabling it again asks at once unless
 * it was asked within the last minute.
 *
 * Load on the services: at most one request per source per interval (60 s), counted from the
 * start of the last request, across pauses, screen changes and reconnects. Nothing is requested
 * while the page is hidden or offline. After a failure the wait doubles, up to 15 min for server
 * errors and 4 min when the network failed (no request reaches the server then, and the phone may
 * not announce that it is back online). A request in flight when polling pauses still completes,
 * and its spots are kept.
 *
 * The last good lists are saved on the phone, so the list shows offline and after a reload with
 * the time it was fetched. Lists older than 60 min are not loaded.
 */

import { kvSpotCache, reviveCache, type CachedSpots, type SpotCache } from './cache';
import { hamqthSource } from './hamqth';
import { isAbort } from './http';
import { mergeSpots } from './merge';
import { potaSource } from './pota';
import { SPOT_CLASSES, SpotFetchError, type SourceId, type Spot, type SpotClass, type SpotErrorKind, type SpotSource } from './types';

/** What the feed needs from the browser; tests drive a fake. */
export interface FeedEnv {
  /** UTC ms. */
  now(): number;
  visible(): boolean;
  online(): boolean;
  /** Calls `onChange` when visibility or connectivity may have changed; returns the unsubscribe. */
  watch(onChange: () => void): () => void;
}

export function browserEnv(): FeedEnv {
  return {
    now: () => Date.now(),
    visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    watch(onChange) {
      if (typeof window === 'undefined') return () => {};
      document.addEventListener('visibilitychange', onChange);
      for (const t of ['online', 'offline', 'pageshow'] as const) window.addEventListener(t, onChange);
      return () => {
        document.removeEventListener('visibilitychange', onChange);
        for (const t of ['online', 'offline', 'pageshow'] as const) window.removeEventListener(t, onChange);
      };
    },
  };
}

export interface SourceError {
  kind: SpotErrorKind;
  /** HTTP status for kind http. */
  status: number | null;
  /** The timeout that expired for kind timeout, ms. */
  afterMs: number | null;
}

export interface SourceStatus {
  id: SourceId;
  name: string;
  enabled: boolean;
  /** When the source last answered with spots, UTC ms. */
  updatedAt: number | null;
  /** When the last request started, UTC ms. */
  attemptedAt: number | null;
  fetching: boolean;
  /** Failed requests since the last success. */
  failures: number;
  /** Why the last request failed; null after a success. */
  error: SourceError | null;
  /** When the next request is due, UTC ms; null while paused, disabled or fetching. */
  nextAt: number | null;
}

export interface FailingSource extends SourceError {
  source: SourceId;
  name: string;
  /** When the next request is due, UTC ms; null while paused. */
  retryAt: number | null;
}

/** The feed's state as the Spots screen shows it. Only enabled sources count. */
export interface SpotFeedView {
  /** Enabled sources, in order of preference. */
  sources: readonly { id: SourceId; name: string }[];
  /** Classes the enabled sources can supply, for the chips. */
  classes: readonly SpotClass[];
  online: boolean;
  /** The oldest of the sources' last answers, UTC ms: every list shown is at least this fresh. */
  updatedAt: number | null;
  /** True while the first request runs and there is no list yet. */
  loading: boolean;
  failing: readonly FailingSource[];
  /** Lines the sources ask apps to show. */
  credits: readonly string[];
}

export type Enabled = Partial<Record<SourceId, boolean>>;

export interface SpotFeedOptions {
  /** Sources in order of preference: a station's spot from an earlier one wins when merging. */
  sources: readonly SpotSource[];
  /** Sources to enable at once; the rest start disabled. */
  enabled?: Enabled;
  env?: FeedEnv;
  /** Where the last good lists are kept; null keeps them in memory only. */
  cache?: SpotCache | null;
  /** Time between requests to one source, ms. */
  intervalMs?: number;
  /** Longest wait after server errors, ms. */
  maxBackoffMs?: number;
  /** Longest wait after network errors, ms. */
  maxNetworkBackoffMs?: number;
  /** Oldest saved list loaded at start, ms. */
  maxCacheAgeMs?: number;
}

const MINUTE = 60_000;

interface Runtime {
  source: SpotSource;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: AbortController | null;
}

export class SpotFeed {
  /** The enabled sources' last good spots, merged, newest first. */
  spots = $state.raw<Spot[]>([]);
  status = $state<SourceStatus[]>([]);
  online = $state(true);
  visible = $state(true);

  readonly #env: FeedEnv;
  readonly #cache: SpotCache | null;
  readonly #intervalMs: number;
  readonly #maxBackoffMs: number;
  readonly #maxNetworkBackoffMs: number;
  readonly #maxCacheAgeMs: number;
  readonly #runtime = new Map<SourceId, Runtime>();
  readonly #lists = new Map<SourceId, Spot[]>();
  #users = 0;
  #unwatch: (() => void) | null = null;
  #cacheLoad: Promise<void> | null = null;

  constructor(opts: SpotFeedOptions) {
    this.#env = opts.env ?? browserEnv();
    this.#cache = opts.cache === undefined ? kvSpotCache : opts.cache;
    this.#intervalMs = opts.intervalMs ?? MINUTE;
    this.#maxBackoffMs = opts.maxBackoffMs ?? 15 * MINUTE;
    this.#maxNetworkBackoffMs = opts.maxNetworkBackoffMs ?? 4 * MINUTE;
    this.#maxCacheAgeMs = opts.maxCacheAgeMs ?? 60 * MINUTE;
    for (const source of opts.sources) {
      if (this.#runtime.has(source.id)) throw new Error(`Two sources named ${source.id}.`);
      this.#runtime.set(source.id, { source, timer: null, inFlight: null });
    }
    this.status = opts.sources.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: opts.enabled?.[s.id] === true,
      updatedAt: null,
      attemptedAt: null,
      fetching: false,
      failures: 0,
      error: null,
      nextAt: null,
    }));
  }

  get view(): SpotFeedView {
    const on = this.status.filter((s) => s.enabled);
    const sources = on.map((s) => this.#runtime.get(s.id)!.source);
    const answered = on.flatMap((s) => (s.updatedAt === null ? [] : [s.updatedAt]));
    return {
      sources: on.map((s) => ({ id: s.id, name: s.name })),
      classes: SPOT_CLASSES.filter((c) => sources.some((s) => s.classes.includes(c))),
      online: this.online,
      updatedAt: answered.length ? Math.min(...answered) : null,
      loading: answered.length === 0 && on.some((s) => s.fetching),
      failing: on.flatMap((s) => (s.error ? [{ source: s.id, name: s.name, ...s.error, retryAt: s.nextAt }] : [])),
      credits: [...new Set(sources.flatMap((s) => (s.credit ? [s.credit] : [])))],
    };
  }

  /**
   * Enables and disables sources, such as from the Optional features switches. Sources left out
   * keep their state; ids without a source are ignored.
   */
  setEnabled(enabled: Enabled) {
    let changed = false;
    for (const s of this.status) {
      const want = enabled[s.id];
      if (want === undefined || want === s.enabled) continue;
      changed = true;
      s.enabled = want;
      if (want) {
        this.#schedule(s.id);
        continue;
      }
      const rt = this.#runtime.get(s.id)!;
      if (rt.timer) clearTimeout(rt.timer);
      rt.timer = null;
      rt.inFlight?.abort();
      rt.inFlight = null;
      s.fetching = false;
      s.nextAt = null;
      s.failures = 0;
      s.error = null;
    }
    if (changed) this.#merge();
  }

  /**
   * Starts polling for one watcher, such as the Spots screen while it is shown, and returns the
   * function that stops it. Polling runs while at least one watcher remains.
   */
  start(): () => void {
    this.#users++;
    if (this.#users === 1) {
      this.#unwatch = this.#env.watch(() => this.#onEnv());
      this.#readEnv();
      this.#loadCache();
      this.#scheduleAll();
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#users--;
      if (this.#users === 0) {
        this.#unwatch?.();
        this.#unwatch = null;
        this.#pause();
      }
    };
  }

  /** Stops polling and abandons requests in flight. */
  dispose() {
    this.#users = 0;
    this.#unwatch?.();
    this.#unwatch = null;
    this.#pause();
    for (const [id, rt] of this.#runtime) {
      rt.inFlight?.abort();
      rt.inFlight = null;
      this.#st(id).fetching = false;
    }
  }

  /** Resolves when the saved lists have been read (tests). */
  cacheLoaded(): Promise<void> {
    return this.#cacheLoad ?? Promise.resolve();
  }

  #st(id: SourceId): SourceStatus {
    return this.status.find((s) => s.id === id)!;
  }

  #canRun(id: SourceId): boolean {
    return this.#users > 0 && this.visible && this.online && this.#st(id).enabled;
  }

  #readEnv() {
    this.visible = this.#env.visible();
    this.online = this.#env.online();
  }

  #onEnv() {
    const wasOnline = this.online;
    this.#readEnv();
    if (!this.visible || !this.online) {
      this.#pause();
      return;
    }
    // Back online: a network failure says nothing about the server, so the wait starts afresh.
    if (!wasOnline) for (const s of this.status) if (s.error?.kind === 'network') s.failures = 0;
    this.#scheduleAll();
  }

  #pause() {
    for (const [id, rt] of this.#runtime) {
      if (rt.timer) clearTimeout(rt.timer);
      rt.timer = null;
      this.#st(id).nextAt = null;
    }
  }

  #scheduleAll() {
    for (const id of this.#runtime.keys()) this.#schedule(id);
  }

  /** Time to wait after the last request, ms. */
  #wait(s: SourceStatus): number {
    if (s.failures === 0) return this.#intervalMs;
    const cap = s.error?.kind === 'network' ? this.#maxNetworkBackoffMs : this.#maxBackoffMs;
    return Math.max(this.#intervalMs, Math.min(this.#intervalMs * 2 ** s.failures, cap));
  }

  #schedule(id: SourceId) {
    const rt = this.#runtime.get(id)!;
    const s = this.#st(id);
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    if (!this.#canRun(id) || rt.inFlight) {
      s.nextAt = null;
      return;
    }
    const now = this.#env.now();
    const due = s.attemptedAt === null ? now : s.attemptedAt + this.#wait(s);
    s.nextAt = Math.max(due, now);
    rt.timer = setTimeout(() => void this.#run(id), s.nextAt - now);
  }

  async #run(id: SourceId) {
    const rt = this.#runtime.get(id)!;
    const s = this.#st(id);
    rt.timer = null;
    if (!this.#canRun(id) || rt.inFlight) return;
    const ctl = new AbortController();
    rt.inFlight = ctl;
    s.attemptedAt = this.#env.now();
    s.fetching = true;
    s.nextAt = null;
    try {
      const spots = await rt.source.fetch(ctl.signal);
      if (ctl.signal.aborted) return;
      s.updatedAt = this.#env.now();
      s.failures = 0;
      s.error = null;
      this.#lists.set(id, spots);
      this.#merge();
      void this.#save();
    } catch (e) {
      if (ctl.signal.aborted || isAbort(e)) return;
      s.failures++;
      // Anything else thrown while reading the answer counts as an unreadable answer.
      s.error = e instanceof SpotFetchError ? { kind: e.kind, status: e.status, afterMs: e.afterMs } : { kind: 'format', status: null, afterMs: null };
    } finally {
      if (rt.inFlight === ctl) {
        rt.inFlight = null;
        s.fetching = false;
        this.#schedule(id);
      }
    }
  }

  #merge() {
    this.spots = mergeSpots(this.status.filter((s) => s.enabled).map((s) => this.#lists.get(s.id) ?? []));
  }

  async #save() {
    if (!this.#cache) return;
    const out: CachedSpots = {};
    for (const s of this.status) {
      const spots = this.#lists.get(s.id);
      if (spots && s.updatedAt !== null) out[s.id] = { updatedAt: s.updatedAt, spots };
    }
    try {
      await this.#cache.save(out);
    } catch {
      // No IndexedDB (a private window): the list lasts until the page closes.
    }
  }

  /** Loads the saved lists once, for sources that have not answered since. */
  #loadCache() {
    const cache = this.#cache;
    if (!cache || this.#cacheLoad) return;
    this.#cacheLoad = (async () => {
      let saved: CachedSpots;
      try {
        saved = reviveCache(await cache.load());
      } catch {
        return;
      }
      const now = this.#env.now();
      for (const s of this.status) {
        const c = saved[s.id];
        if (!c || now - c.updatedAt > this.#maxCacheAgeMs) continue;
        if (s.updatedAt !== null && s.updatedAt >= c.updatedAt) continue;
        s.updatedAt = c.updatedAt;
        this.#lists.set(s.id, c.spots);
      }
      this.#merge();
    })();
  }
}

/**
 * The app's feed: the POTA API, then HamQTH's DX cluster feed, both disabled until the Optional
 * features switches enable them. SOTA's own source is not implemented (sota.ts).
 */
export const spotFeed = new SpotFeed({ sources: [potaSource(), hamqthSource()] });
