import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedSpots, SpotCache } from './cache';
import { SpotFeed, spotFeed, type FeedEnv } from './feed.svelte';
import { SPOT_CLASSES, SpotFetchError, type SourceId, type Spot, type SpotSource } from './types';
import { dxSpot, NOW, spot } from '../testing/spots';

const MIN = 60_000;

/** A page whose visibility and connectivity the test sets. */
function fakePage() {
  const state = { visible: true, online: true };
  const listeners = new Set<() => void>();
  const env: FeedEnv = {
    now: () => Date.now(),
    visible: () => state.visible,
    online: () => state.online,
    watch(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const set = (k: 'visible' | 'online', v: boolean) => {
    state[k] = v;
    for (const l of [...listeners]) l();
  };
  return {
    env,
    listeners,
    hide: () => set('visible', false),
    show: () => set('visible', true),
    offline: () => set('online', false),
    online: () => set('online', true),
    /** A change notice with nothing changed, as pageshow gives. */
    poke: () => {
      for (const l of [...listeners]) l();
    },
  };
}

type Answer = Spot[] | Error;

/** A source that answers from a script, the last answer repeating, after `delayMs`. */
function scripted(id: SourceId, answers: Answer[], delayMs = 0) {
  const calls: number[] = [];
  const signals: AbortSignal[] = [];
  let i = 0;
  const source: SpotSource = {
    id,
    name: id === 'pota' ? 'POTA' : 'HamQTH',
    classes: id === 'pota' ? ['POTA'] : SPOT_CLASSES,
    credit: id === 'hamqth' ? 'DX cluster data provided by HamQTH.com.' : null,
    async fetch(signal) {
      calls.push(Date.now());
      signals.push(signal);
      const a = answers[Math.min(i++, answers.length - 1)];
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { source, calls, signals };
}

function memoryCache(initial?: unknown, loadDelayMs = 0) {
  let stored: unknown = initial;
  const saves: CachedSpots[] = [];
  const cache: SpotCache = {
    async load() {
      if (loadDelayMs) await new Promise((r) => setTimeout(r, loadDelayMs));
      return stored;
    },
    async save(c) {
      stored = c;
      saves.push(structuredClone(c));
    },
  };
  return { cache, saves };
}

/** Request times in minutes after NOW. */
const mins = (calls: number[]) => calls.map((t) => Math.round(((t - NOW) / MIN) * 100) / 100);
const calls = (xs: readonly Spot[]) => xs.map((s) => s.activator);

const http503 = () => new SpotFetchError('http', 503);
const offlineError = () => new SpotFetchError('network');
const K1 = [spot({ activator: 'K1ABC' })];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('polling', () => {
  it('asks at start, then once a minute while visible and online', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(feed.view).toEqual({ sources: [{ id: 'pota', name: 'POTA' }], classes: ['POTA'], online: true, updatedAt: NOW, loading: false, failing: [], credits: [] });
    expect(feed.status[0].nextAt).toBe(NOW + MIN);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(mins(a.calls)).toEqual([0, 1, 2, 3, 4, 5]);
    stop();
  });

  it('asks nothing while hidden, and on return waits out the minute', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(10_000);
    page.hide();
    expect(feed.visible).toBe(false);
    expect(feed.status[0].nextAt).toBeNull();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(mins(a.calls)).toEqual([0]);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(mins(a.calls)).toEqual([0, 10.17]);
    // Back again 20 s later: the next request still waits for the minute.
    await vi.advanceTimersByTimeAsync(10_000);
    page.hide();
    await vi.advanceTimersByTimeAsync(10_000);
    page.show();
    await vi.advanceTimersByTimeAsync(39_000);
    expect(a.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mins(a.calls)).toEqual([0, 10.17, 11.17]);
  });

  it('waits for a visible page before the first request', async () => {
    const page = fakePage();
    page.hide();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(a.calls).toEqual([]);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(mins(a.calls)).toEqual([5]);
  });

  it('pauses offline with the list kept, and asks again when back online', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(30_000);
    page.offline();
    expect(feed.view.online).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(mins(a.calls)).toEqual([0]);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(feed.view.updatedAt).toBe(NOW);
    page.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(mins(a.calls)).toEqual([0, 5.5]);
  });

  it('never asks one source twice within a minute, however often the page changes', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    for (let t = 0; t < 10 * MIN; t += 7_000) {
      if ((t / 7_000) % 3 === 0) {
        page.hide();
        page.show();
      } else if ((t / 7_000) % 3 === 1) {
        page.offline();
        page.online();
      } else {
        page.poke();
      }
      await vi.advanceTimersByTimeAsync(7_000);
    }
    const gaps = a.calls.slice(1).map((t, i) => t - a.calls[i]);
    expect(a.calls.length).toBeLessThanOrEqual(11);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN);
  });
});

describe('backoff', () => {
  it('waits 2, 4, 8 and then 15 min after server errors, and a minute after a success', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1, http503(), http503(), http503(), http503(), http503(), K1, K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(feed.view.failing).toEqual([{ source: 'pota', name: 'POTA', kind: 'http', status: 503, afterMs: null, retryAt: NOW + 3 * MIN }]);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(feed.view.updatedAt).toBe(NOW);
    await vi.advanceTimersByTimeAsync(45 * MIN);
    expect(mins(a.calls)).toEqual([0, 1, 3, 7, 15, 30, 45, 46]);
    expect(feed.view.failing).toEqual([]);
    expect(feed.status[0].failures).toBe(0);
  });

  it('waits at most 4 min after network errors', async () => {
    const page = fakePage();
    const a = scripted('pota', [offlineError(), offlineError(), offlineError(), offlineError(), offlineError(), offlineError(), K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(23 * MIN);
    expect(mins(a.calls)).toEqual([0, 2, 6, 10, 14, 18, 22, 23]);
  });

  it('backs off after timeouts as after server errors', async () => {
    const page = fakePage();
    const a = scripted('pota', [new SpotFetchError('timeout', null, 15_000)]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(mins(a.calls)).toEqual([0, 2, 6, 14, 29]);
    expect(feed.view.failing[0]).toMatchObject({ kind: 'timeout', afterMs: 15_000 });
  });

  it('starts the wait afresh on reconnecting after a network error, but not after a server error', async () => {
    const page = fakePage();
    const net = scripted('pota', [K1, offlineError(), K1]);
    const feed = new SpotFeed({ sources: [net.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(1.5 * MIN);
    page.offline();
    await vi.advanceTimersByTimeAsync(MIN);
    page.online();
    await vi.advanceTimersByTimeAsync(0);
    // Without the reset the next request would wait until minute 3.
    expect(mins(net.calls)).toEqual([0, 1, 2.5]);
    feed.dispose();

    vi.setSystemTime(NOW);
    const page2 = fakePage();
    const srv = scripted('pota', [K1, http503(), K1]);
    const feed2 = new SpotFeed({ sources: [srv.source], enabled: { pota: true }, env: page2.env, cache: null });
    feed2.start();
    await vi.advanceTimersByTimeAsync(1.5 * MIN);
    page2.offline();
    await vi.advanceTimersByTimeAsync(MIN);
    page2.online();
    await vi.advanceTimersByTimeAsync(0.5 * MIN);
    expect(mins(srv.calls)).toEqual([0, 1, 3]);
  });

  it('counts anything else thrown as an unreadable answer', async () => {
    const page = fakePage();
    const a = scripted('pota', [new TypeError('x is undefined')]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.view.failing).toEqual([{ source: 'pota', name: 'POTA', kind: 'format', status: null, afterMs: null, retryAt: NOW + 2 * MIN }]);
  });
});

describe('watchers', () => {
  it('polls while any watcher remains and listens to the page only then', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    const stopA = feed.start();
    const stopB = feed.start();
    expect(page.listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    stopA();
    stopA();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(mins(a.calls)).toEqual([0, 1]);
    stopB();
    expect(page.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(a.calls).toHaveLength(2);
  });

  it('keeps the spots of a request that completes after the last watcher left', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1], 5_000);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.view.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(feed.view.loading).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(a.calls).toHaveLength(1);
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mins(a.calls)).toEqual([0, 5.08]);
  });

  it('abandons a request in flight on dispose', async () => {
    const page = fakePage();
    const a = scripted('pota', [K1], 5_000);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(1_000);
    feed.dispose();
    expect(a.signals[0].aborted).toBe(true);
    expect(feed.status[0].fetching).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(feed.spots).toEqual([]);
    expect(feed.view.failing).toEqual([]);
    expect(page.listeners.size).toBe(0);
  });
});

describe('several sources', () => {
  it('merges lists newest first, dates the list by the older answer and credits HamQTH', async () => {
    const page = fakePage();
    const pota = scripted('pota', [[spot({ activator: 'K1ABC', spottedAt: NOW - 60_000 })]]);
    const cluster = scripted('hamqth', [[dxSpot({ activator: 'K2ABC', spottedAt: NOW - 30_000 })], http503()], 2_000);
    const feed = new SpotFeed({ sources: [pota.source, cluster.source], enabled: { pota: true, hamqth: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.view.loading).toBe(false);
    expect(feed.view.updatedAt).toBe(NOW);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls(feed.spots)).toEqual(['K2ABC', 'K1ABC']);
    expect(feed.view.updatedAt).toBe(NOW);
    expect(feed.view.sources.map((s) => s.name)).toEqual(['POTA', 'HamQTH']);
    expect(feed.view.classes).toEqual(SPOT_CLASSES);
    expect(feed.view.credits).toEqual(['DX cluster data provided by HamQTH.com.']);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(feed.view.failing.map((f) => f.name)).toEqual(['HamQTH']);
    expect(calls(feed.spots)).toEqual(['K2ABC', 'K1ABC']);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(mins(pota.calls)).toEqual([0, 1, 2, 3]);
    expect(mins(cluster.calls)).toEqual([0, 1, 3]);
  });

  it('folds a cluster spot into the POTA spot of the same station and band', async () => {
    const page = fakePage();
    const pota = scripted('pota', [[spot({ activator: 'ZL1KS', spottedAt: NOW - 60_000 })]]);
    const cluster = scripted('hamqth', [[dxSpot({ activator: 'ZL1KS', spottedAt: NOW - 30_000, refs: [{ programme: 'IOTA', ref: 'OC-134', name: '' }] })]]);
    const feed = new SpotFeed({ sources: [pota.source, cluster.source], enabled: { pota: true, hamqth: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.spots).toHaveLength(1);
    expect(feed.spots[0]).toMatchObject({ source: 'pota', refs: [{ ref: 'VK-0921' }, { ref: 'OC-134' }] });
  });

  it('refuses two sources with one id', () => {
    const a = scripted('pota', [K1]);
    expect(() => new SpotFeed({ sources: [a.source, a.source], env: fakePage().env, cache: null })).toThrow('2 sources named pota.');
  });
});

describe('enabling sources', () => {
  it('starts with every source disabled: no requests, no timers, no listeners kept busy', async () => {
    const page = fakePage();
    const pota = scripted('pota', [K1]);
    const cluster = scripted('hamqth', [K1]);
    const feed = new SpotFeed({ sources: [pota.source, cluster.source], env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(pota.calls).toEqual([]);
    expect(cluster.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(feed.view).toMatchObject({ sources: [], classes: [], updatedAt: null, loading: false, failing: [], credits: [] });
  });

  it('asks at once when enabled while watched, and only then', async () => {
    const page = fakePage();
    const pota = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [pota.source], env: page.env, cache: null });
    feed.setEnabled({ pota: true });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(pota.calls).toEqual([]);
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mins(pota.calls)).toEqual([1]);
  });

  it('disabling abandons the request in flight, clears the timer and hides the spots', async () => {
    const page = fakePage();
    const pota = scripted('pota', [K1]);
    const cluster = scripted('hamqth', [[dxSpot({ activator: 'K2ABC' })]], 5_000);
    const feed = new SpotFeed({ sources: [pota.source, cluster.source], enabled: { pota: true, hamqth: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    feed.setEnabled({ pota: false });
    expect(feed.spots).toEqual([]);
    expect(feed.view.updatedAt).toBeNull();
    expect(feed.view.loading).toBe(true);
    feed.setEnabled({ hamqth: false });
    expect(cluster.signals[0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // the cluster fake's own delay
    await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(pota.calls).toHaveLength(1);
    expect(cluster.calls).toHaveLength(1);
    expect(feed.spots).toEqual([]);
    expect(feed.status.map((s) => [s.id, s.enabled, s.fetching, s.nextAt])).toEqual([
      ['pota', false, false, null],
      ['hamqth', false, false, null],
    ]);
  });

  it('shows the kept list again on enabling, and asks no sooner than a minute after the last request', async () => {
    const page = fakePage();
    const pota = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [pota.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(10_000);
    feed.setEnabled({ pota: false });
    await vi.advanceTimersByTimeAsync(10_000);
    feed.setEnabled({ pota: true });
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(pota.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mins(pota.calls)).toEqual([0, 1]);
  });

  it('forgets failures on disabling', async () => {
    const page = fakePage();
    const pota = scripted('pota', [http503(), K1]);
    const feed = new SpotFeed({ sources: [pota.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.view.failing).toHaveLength(1);
    feed.setEnabled({ pota: false });
    feed.setEnabled({ pota: true });
    expect(feed.view.failing).toEqual([]);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(mins(pota.calls)).toEqual([0, 1]);
  });

  it('ignores ids without a source and unchanged values', async () => {
    const page = fakePage();
    const pota = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [pota.source], enabled: { pota: true }, env: page.env, cache: null });
    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    feed.setEnabled({ pota: true, sota: true, hamqth: true });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pota.calls).toHaveLength(1);
    expect(feed.view.sources).toEqual([{ id: 'pota', name: 'POTA' }]);
  });
});

describe('saved lists', () => {
  const saved = (ageMs: number): CachedSpots => ({ pota: { updatedAt: NOW - ageMs, spots: [spot({ activator: 'K9OLD' })] } });

  it('shows a saved list at start, then replaces and saves the new one', async () => {
    const page = fakePage();
    const m = memoryCache(saved(10 * MIN));
    const a = scripted('pota', [K1], 3_000);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: m.cache });
    feed.start();
    await feed.cacheLoaded();
    expect(calls(feed.spots)).toEqual(['K9OLD']);
    expect(feed.view.updatedAt).toBe(NOW - 10 * MIN);
    expect(feed.view.loading).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(m.saves).toHaveLength(1);
    expect(m.saves[0].pota?.updatedAt).toBe(NOW + 3_000);
    expect(m.saves[0].pota?.spots.map((s) => s.activator)).toEqual(['K1ABC']);
  });

  it('shows a saved list offline without asking', async () => {
    const page = fakePage();
    page.offline();
    const a = scripted('pota', [K1]);
    const feed = new SpotFeed({ sources: [a.source], enabled: { pota: true }, env: page.env, cache: memoryCache(saved(30 * MIN)).cache });
    feed.start();
    await feed.cacheLoaded();
    expect(calls(feed.spots)).toEqual(['K9OLD']);
    expect(feed.view).toMatchObject({ online: false, updatedAt: NOW - 30 * MIN });
    expect(a.calls).toEqual([]);
  });

  it('drops a saved list older than 60 min', async () => {
    const page = fakePage();
    page.offline();
    const feed = new SpotFeed({ sources: [scripted('pota', [K1]).source], enabled: { pota: true }, env: page.env, cache: memoryCache(saved(61 * MIN)).cache });
    feed.start();
    await feed.cacheLoaded();
    expect(feed.spots).toEqual([]);
    expect(feed.view.updatedAt).toBeNull();
  });

  it('never lets a slow read replace a newer answer', async () => {
    const page = fakePage();
    const feed = new SpotFeed({ sources: [scripted('pota', [K1]).source], enabled: { pota: true }, env: page.env, cache: memoryCache(saved(MIN), 5_000).cache });
    feed.start();
    await vi.advanceTimersByTimeAsync(5_000);
    await feed.cacheLoaded();
    expect(calls(feed.spots)).toEqual(['K1ABC']);
    expect(feed.view.updatedAt).toBe(NOW);
  });

  it('carries on when the store fails or holds something else', async () => {
    for (const cache of [
      { load: () => Promise.reject(new Error('no IndexedDB')), save: () => Promise.reject(new Error('no IndexedDB')) },
      { load: async () => 'garbage', save: async () => {} },
      { load: async () => ({ pota: { updatedAt: 'x', spots: 5 } }), save: async () => {} },
    ] satisfies SpotCache[]) {
      const feed = new SpotFeed({ sources: [scripted('pota', [K1]).source], enabled: { pota: true }, env: fakePage().env, cache });
      feed.start();
      await vi.advanceTimersByTimeAsync(0);
      await feed.cacheLoaded();
      expect(calls(feed.spots)).toEqual(['K1ABC']);
      feed.dispose();
    }
  });
});

describe('the app feed', () => {
  it('has POTA, then HamQTH, both disabled', async () => {
    expect(spotFeed.status.map((s) => [s.id, s.name, s.enabled])).toEqual([
      ['pota', 'POTA', false],
      ['hamqth', 'HamQTH', false],
    ]);
    const stop = spotFeed.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(vi.getTimerCount()).toBe(0);
    expect(spotFeed.view.sources).toEqual([]);
    stop();
  });
});
