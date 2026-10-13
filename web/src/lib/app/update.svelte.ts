/**
 * Updates. The service worker (vite-plugin-pwa, autoUpdate) installs a new version in the
 * background and takes over. This page keeps running the old build until a safe moment, because
 * a reload stops the audio: when nothing is capturing or playing, at the next change of screen.
 * After the reload, the new version compares itself with the last version this phone ran and
 * shows "Updated to 0.1.1" once.
 */

import { compareVersions } from './changelog';

const LAST_KEY = 'rr73.lastVersion';

export const update = $state<{ notice: string | null; ready: boolean }>({ notice: null, ready: false });

/** Shows the notice when this version is newer than the last one run here, and records it. */
export function checkUpdated(current: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
  if (!storage) return;
  try {
    const last = storage.getItem(LAST_KEY);
    if (last && compareVersions(current, last) > 0) update.notice = current;
    storage.setItem(LAST_KEY, current);
  } catch {
    // Storage refused (a private window): no notice.
  }
}

export function dismissNotice() {
  update.notice = null;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Marks an update as ready when a new service worker takes over from an old one. */
export function watchServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    update.ready = true;
  });
}

/** Reloads into the new version if one is ready and nothing is running. True when it reloads. */
export function reloadIfIdle(busy: boolean, reload: () => void = () => location.reload()): boolean {
  if (!update.ready || busy) return false;
  reload();
  return true;
}

/** What reloading needs from the browser; injected so tests can drive it. */
export interface ReloadDeps {
  registration(): Promise<ServiceWorkerRegistration | undefined>;
  registrations(): Promise<readonly ServiceWorkerRegistration[]>;
  cacheKeys(): Promise<string[]>;
  deleteCache(key: string): Promise<boolean>;
  reload(): void;
  /** Longest wait for a new version to take over, ms. */
  timeoutMs: number;
}

export function browserReloadDeps(): ReloadDeps {
  const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  const store = typeof caches !== 'undefined' ? caches : null;
  return {
    registration: async () => (sw ? sw.getRegistration() : undefined),
    registrations: async () => (sw ? sw.getRegistrations() : []),
    cacheKeys: async () => (store ? store.keys() : []),
    deleteCache: async (key) => (store ? store.delete(key) : false),
    reload: () => location.reload(),
    timeoutMs: 15_000,
  };
}

/** Resolves when `worker` is active (or gone), or after `timeoutMs`. */
function settled(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  if (worker.state === 'activated' || worker.state === 'redundant') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') done();
    };
    const timer = setTimeout(done, timeoutMs);
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Asks the service worker for a newer build, waits for it to take over, then reloads. Offline,
 * or without a service worker, it reloads the build already on the phone.
 */
export async function reloadApp(deps: ReloadDeps = browserReloadDeps()): Promise<void> {
  const reg = await deps.registration().catch(() => undefined);
  if (reg) {
    try {
      await reg.update();
    } catch {
      // Offline or the server is unreachable: reload what the phone has.
    }
    const incoming = reg.installing ?? reg.waiting;
    if (incoming) await settled(incoming, deps.timeoutMs);
  }
  deps.reload();
}

/**
 * Removes the service worker and every cache, then reloads, so the next load comes from the
 * network. IndexedDB (settings, saved slots, the log) is left alone.
 */
export async function clearCacheAndReload(deps: ReloadDeps = browserReloadDeps()): Promise<void> {
  for (const r of await deps.registrations().catch(() => [])) await r.unregister().catch(() => false);
  for (const key of await deps.cacheKeys().catch(() => [])) await deps.deleteCache(key).catch(() => false);
  deps.reload();
}
