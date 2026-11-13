/**
 * The desktop app's update notice (docs/design/desktop.md, Updates). The PWA updates itself
 * through its service worker; the desktop app comes as an unsigned installer, so it only says
 * when a newer release exists and links to its page.
 *
 * At start and every RELEASE_INTERVAL_MS the app reads the project's latest GitHub release. A
 * newer version than this build's sets `release.latest`: Settings › About shows it as a row, and
 * a notice floats over the screen once for each version. A failed check changes nothing and the
 * next interval tries again. With Check for new versions off, nothing is read and no notice shows.
 */

import { compareVersions } from '../app/changelog';
import { desktopBridge, type DesktopBridge } from '../app/desktop';
import { settings } from './settings.svelte';

/** Time between checks, ms. */
export const RELEASE_INTERVAL_MS = 24 * 60 * 60_000;
/** The project's release pages; a version's page is `${RELEASES_URL}/tag/v${version}`. */
export const RELEASES_URL = 'https://github.com/nnamon/RR73/releases';

/** The last version the floating notice showed, so it shows once for each release. */
const SHOWN_KEY = 'rr73.releaseShown';

export const release = $state<{
  /** A newer release than this build, or null. */
  latest: string | null;
  /** Show the floating notice for `latest`. */
  notice: boolean;
}>({ latest: null, notice: false });

/** The release page of `version`. */
export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * The version of a GitHub release (`GET /repos/{owner}/{repo}/releases/latest`), from its tag
 * `v1.2.3`; null for anything else, a draft or a pre-release.
 */
export function releaseVersion(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') return null;
  const v = r.tag_name.replace(/^v/, '');
  return VERSION.test(v) ? v : null;
}

interface Deps {
  bridge(): Promise<DesktopBridge>;
  fetch: typeof fetch;
  later(fn: () => void, ms: number): void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  current: string;
}

let deps: Deps | null = null;
let run = 0;

/** Reads the latest release once; true when the feed answered with a release. */
export async function checkRelease(d: Pick<Deps, 'bridge' | 'fetch' | 'storage' | 'current'>): Promise<boolean> {
  let version: string | null = null;
  try {
    const bridge = await d.bridge();
    const feed = await bridge.invoke<string>('release_feed');
    const res = await d.fetch(feed, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!res.ok) return false;
    version = releaseVersion(await res.json());
  } catch {
    return false;
  }
  if (!version) return false;
  if (compareVersions(version, d.current) <= 0) {
    release.latest = null;
    release.notice = false;
    return true;
  }
  release.latest = version;
  if (shown(d.storage) !== version) {
    release.notice = true;
    remember(d.storage, version);
  }
  return true;
}

/** Starts the checks: at once, then every RELEASE_INTERVAL_MS while Check for new versions is on. */
export function initReleaseCheck(over?: Partial<Deps>) {
  deps = {
    bridge: desktopBridge,
    fetch: (...a) => fetch(...a),
    later: (fn, ms) => void setTimeout(fn, ms),
    storage: safeStorage(),
    current: __APP_VERSION__,
    ...over,
  };
  restartReleaseCheck();
}

/** Checks again with the current setting, as after Check for new versions changes. */
export function restartReleaseCheck() {
  const d = deps;
  if (!d) return;
  const id = ++run;
  const cycle = async () => {
    if (id !== run) return;
    if (!settings.releaseCheck) {
      release.latest = null;
      release.notice = false;
      return;
    }
    await checkRelease(d);
    if (id === run) d.later(() => void cycle(), RELEASE_INTERVAL_MS);
  };
  void cycle();
}

/** Hides the floating notice; Settings › About keeps the row. */
export function dismissRelease() {
  release.notice = false;
}

/** Opens the release page of `release.latest` in the system's browser. */
export async function openRelease(bridge: () => Promise<DesktopBridge> = desktopBridge) {
  const v = release.latest;
  release.notice = false;
  if (!v) return;
  try {
    await (await bridge()).invoke('plugin:opener|open_url', { url: releaseUrl(v) });
  } catch {
    // No browser to open: the row stays in Settings › About.
  }
}

function shown(storage: Deps['storage']): string | null {
  try {
    return storage?.getItem(SHOWN_KEY) ?? null;
  } catch {
    return null;
  }
}

function remember(storage: Deps['storage'], version: string) {
  try {
    storage?.setItem(SHOWN_KEY, version);
  } catch {
    // Storage refused: the notice shows again at the next start.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
