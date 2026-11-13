import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopBridge } from '../app/desktop';
import { RELEASE_INTERVAL_MS, checkRelease, dismissRelease, initReleaseCheck, openRelease, release, releaseUrl, releaseVersion, restartReleaseCheck } from './release.svelte';
import { settings } from './settings.svelte';

const FEED = 'https://feed.test/releases/latest';

function fakeBridge() {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  const bridge: DesktopBridge = {
    invoke: async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ cmd, args });
      return (cmd === 'release_feed' ? FEED : undefined) as T;
    },
    channel: (fn) => ({ onmessage: fn }),
    listen: async () => () => undefined,
  };
  return { bridge: async () => bridge, calls };
}

/** A fetch that answers each call with the next answer: a release body, a status code or an error. */
function fakeFetch(answers: (object | number | Error)[]) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const a = answers.shift();
    if (a === undefined || a instanceof Error) throw a ?? new Error('no answer');
    if (typeof a === 'number') return new Response('', { status: a });
    return new Response(JSON.stringify(a), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, urls };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const tag = (t: string, extra: object = {}) => ({ tag_name: t, draft: false, prerelease: false, ...extra });

afterEach(() => {
  settings.releaseCheck = true;
  release.latest = null;
  release.notice = false;
});

describe('releaseVersion', () => {
  it('reads the version from the tag', () => {
    expect(releaseVersion(tag('v0.29.0'))).toBe('0.29.0');
    expect(releaseVersion(tag('1.2.3-rc.1'))).toBe('1.2.3-rc.1');
  });

  it('refuses drafts, pre-releases and other tags', () => {
    expect(releaseVersion(tag('v0.29.0', { draft: true }))).toBeNull();
    expect(releaseVersion(tag('v0.29.0', { prerelease: true }))).toBeNull();
    expect(releaseVersion(tag('nightly'))).toBeNull();
    expect(releaseVersion(tag('v0.29'))).toBeNull();
    expect(releaseVersion({ message: 'Not Found' })).toBeNull();
    expect(releaseVersion(null)).toBeNull();
  });
});

describe('checkRelease', () => {
  it('shows a newer release once, from the feed the app names', async () => {
    const { bridge } = fakeBridge();
    const storage = memoryStorage();
    const { fetch, urls } = fakeFetch([tag('v0.29.0'), tag('v0.29.0')]);
    expect(await checkRelease({ bridge, fetch, storage, current: '0.28.3' })).toBe(true);
    expect(urls).toEqual([FEED]);
    expect(release).toEqual({ latest: '0.29.0', notice: true });
    dismissRelease();
    await checkRelease({ bridge, fetch, storage, current: '0.28.3' });
    expect(release).toEqual({ latest: '0.29.0', notice: false });
  });

  it('compares by semantic versioning', async () => {
    const { bridge } = fakeBridge();
    const { fetch } = fakeFetch([tag('v0.10.0'), tag('v0.28.3'), tag('v0.28.2')]);
    await checkRelease({ bridge, fetch, storage: null, current: '0.9.12' });
    expect(release.latest).toBe('0.10.0');
    await checkRelease({ bridge, fetch, storage: null, current: '0.28.3' });
    expect(release.latest).toBeNull();
    await checkRelease({ bridge, fetch, storage: null, current: '0.28.3' });
    expect(release.latest).toBeNull();
  });

  it('stays silent and keeps what it had when the check fails', async () => {
    const { bridge } = fakeBridge();
    const { fetch } = fakeFetch([tag('v0.29.0'), 403, new Error('offline'), { message: 'rate limit' }]);
    await checkRelease({ bridge, fetch, storage: null, current: '0.28.3' });
    dismissRelease();
    for (let i = 0; i < 3; i++) expect(await checkRelease({ bridge, fetch, storage: null, current: '0.28.3' })).toBe(false);
    expect(release).toEqual({ latest: '0.29.0', notice: false });
  });
});

describe('initReleaseCheck', () => {
  it('checks at start and once a day, retrying after a failure at the next interval', async () => {
    const { bridge } = fakeBridge();
    const { fetch, urls } = fakeFetch([new Error('offline'), tag('v0.29.0')]);
    const timers: { fn: () => void; ms: number }[] = [];
    initReleaseCheck({ bridge, fetch, storage: null, current: '0.28.3', later: (fn, ms) => void timers.push({ fn, ms }) });
    await flush();
    expect(urls.length).toBe(1);
    expect(release.latest).toBeNull();
    expect(timers.map((t) => t.ms)).toEqual([RELEASE_INTERVAL_MS]);
    timers.shift()!.fn();
    await flush();
    expect(urls.length).toBe(2);
    expect(release.latest).toBe('0.29.0');
    expect(timers.map((t) => t.ms)).toEqual([RELEASE_INTERVAL_MS]);
  });

  it('reads nothing and hides the notice with Check for new versions off', async () => {
    const { bridge } = fakeBridge();
    const { fetch, urls } = fakeFetch([tag('v0.29.0'), tag('v0.29.0')]);
    const timers: (() => void)[] = [];
    initReleaseCheck({ bridge, fetch, storage: null, current: '0.28.3', later: (fn) => void timers.push(fn) });
    await flush();
    expect(release.latest).toBe('0.29.0');
    settings.releaseCheck = false;
    restartReleaseCheck();
    await flush();
    expect(release).toEqual({ latest: null, notice: false });
    // The first cycle's timer belongs to a stopped cycle: it reads nothing.
    for (const t of timers.splice(0)) t();
    await flush();
    expect(urls.length).toBe(1);
    settings.releaseCheck = true;
    restartReleaseCheck();
    await flush();
    expect(urls.length).toBe(2);
  });
});

describe('openRelease', () => {
  it('opens the release page in the system browser and hides the notice', async () => {
    const { bridge, calls } = fakeBridge();
    release.latest = '0.29.0';
    release.notice = true;
    await openRelease(bridge);
    expect(calls).toEqual([{ cmd: 'plugin:opener|open_url', args: { url: 'https://github.com/nnamon/RR73/releases/tag/v0.29.0' } }]);
    expect(release.notice).toBe(false);
    expect(releaseUrl('0.29.0')).toBe('https://github.com/nnamon/RR73/releases/tag/v0.29.0');
  });
});

/** Lets the awaited bridge, fetch and JSON calls finish. */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
