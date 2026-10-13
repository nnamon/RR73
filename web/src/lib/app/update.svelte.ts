/**
 * Updates. The service worker (vite-plugin-pwa, prompt) installs a new version in the background
 * and waits: this page keeps running its own build, served by the old worker together with every
 * file it may still load (the decoder worker, the WebAssembly). A reload stops the audio, so the
 * new version takes over at a safe moment: at the next change of screen while nothing is
 * capturing or playing, or when the operator reloads. This page then tells the waiting worker to
 * take over (SKIP_WAITING) and reloads. After the reload, the new version compares itself with the
 * last version this phone ran and shows "Updated to 0.1.1" once.
 *
 * Another copy of RR73 can apply an update while this one runs. The files of this build then
 * leave the cache and the server, and the next one it loads fails. A failed load checks the
 * server's index.html: when it names another build, this page is stale, says so in one line and
 * reloads at the next safe moment.
 */

import { compareVersions } from './changelog';

const LAST_KEY = 'rr73.lastVersion';

export const update = $state<{
  notice: string | null;
  /** A new version is waiting or has taken over: reload at the next safe moment. */
  ready: boolean;
  /** This build's files are gone from the server: loads fail until the page reloads. */
  stale: boolean;
}>({ notice: null, ready: false, stale: false });

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

/** The parts of navigator.serviceWorker used here; injected so tests can drive it. */
export interface WorkerContainer {
  readonly controller: ServiceWorker | null;
  register(url: string, options: RegistrationOptions): Promise<ServiceWorkerRegistration>;
  addEventListener(type: 'controllerchange', fn: () => void): void;
}

/** The phone looks for a newer version when RR73 comes back to the screen this long after the last look, ms. */
export const CHECK_INTERVAL_MS = 60 * 60_000;
/** Longest wait for a new version to take over after SKIP_WAITING before reloading anyway, ms. */
const TAKEOVER_MS = 3000;

let registration: ServiceWorkerRegistration | null = null;
let applying = false;
let doReload: () => void = () => location.reload();

function browserContainer(): WorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
}

/**
 * Registers the service worker and watches for new versions: one waiting to take over, or one
 * another copy of RR73 let take over. Looks for a newer version when the app comes back to the
 * screen, at most once per CHECK_INTERVAL_MS.
 */
export async function registerServiceWorker(
  container: WorkerContainer | null = browserContainer(),
  base: string = import.meta.env.BASE_URL,
  reload: () => void = () => location.reload(),
): Promise<void> {
  if (!container) return;
  doReload = reload;
  const hadController = container.controller !== null;
  container.addEventListener('controllerchange', () => {
    if (applying) return doReload();
    // Another copy applied an update: this page now runs an older build than its worker serves.
    if (hadController) update.ready = true;
  });
  let reg: ServiceWorkerRegistration;
  try {
    reg = await container.register(`${base}sw.js`, { scope: base });
  } catch {
    // No service worker (development, a private window): the network serves every load.
    return;
  }
  registration = reg;
  const watch = (w: ServiceWorker | null) => {
    if (!w) return;
    // Installed with a controller in place means waiting; the first install takes over at once.
    const check = () => {
      if (w.state === 'installed' && container.controller) update.ready = true;
    };
    w.addEventListener('statechange', check);
    check();
  };
  watch(reg.waiting);
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));

  if (typeof document === 'undefined') return;
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    void reg.update().catch(() => undefined);
  });
}

/** Loads the new version: a waiting worker takes over first, then the page reloads. */
export function applyUpdate(reg: Pick<ServiceWorkerRegistration, 'waiting'> | null = registration, reload: () => void = doReload): void {
  const waiting = reg?.waiting;
  if (!waiting) return reload();
  applying = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // controllerchange reloads as soon as it takes over; this covers a worker that never does.
  setTimeout(reload, TAKEOVER_MS);
}

/** Reloads into the new version if one is ready and nothing is running. True when it reloads. */
export function reloadIfIdle(busy: boolean, reload: () => void = () => applyUpdate()): boolean {
  if ((!update.ready && !update.stale) || busy) return false;
  reload();
  return true;
}

/** The main script of this build, "/assets/index-BflCaAqF.js"; null in development and tests. */
function ownEntry(): string | null {
  return entryIn(import.meta.url);
}

const ENTRY = /\/assets\/index-[\w-]+\.js/;

function entryIn(text: string): string | null {
  return ENTRY.exec(text)?.[0] ?? null;
}

/**
 * True when the index.html the app gets now (from the service worker, or the server without
 * one) names another build than this page runs.
 */
export async function isStale(
  entry: string | null = ownEntry(),
  get: (url: string) => Promise<Pick<Response, 'ok' | 'text'>> = (url) => fetch(url, { cache: 'no-store' }),
  base: string = import.meta.env.BASE_URL,
): Promise<boolean> {
  if (!entry) return false;
  try {
    const res = await get(`${base}index.html`);
    if (!res.ok) return false;
    const now = entryIn(await res.text());
    return now !== null && now !== entry;
  } catch {
    return false;
  }
}

let checking: Promise<void> | null = null;

/**
 * A script, worker, worklet or WebAssembly file of this build failed to load. When the reason
 * is a newer build on the server, marks this page stale: a notice says so, and the next safe
 * moment reloads.
 */
export function noteLoadFailure(check: () => Promise<boolean> = () => isStale()): Promise<void> {
  checking ??= check()
    .then((stale) => {
      if (!stale) return;
      update.stale = true;
      update.ready = true;
    })
    .finally(() => (checking = null));
  return checking;
}

/** What reloading needs from the browser; injected so tests can drive it. */
export interface ReloadDeps {
  registration(): Promise<ServiceWorkerRegistration | undefined>;
  registrations(): Promise<readonly ServiceWorkerRegistration[]>;
  cacheKeys(): Promise<string[]>;
  deleteCache(key: string): Promise<boolean>;
  reload(): void;
  /** Longest wait for a new version to install, then to take over, ms. */
  timeoutMs: number;
}

export function browserReloadDeps(): ReloadDeps {
  const sw = browserContainer() as ServiceWorkerContainer | null;
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

/** Resolves when `worker` reaches one of `states` (or is gone), or after `timeoutMs`. */
function reached(worker: ServiceWorker, states: readonly ServiceWorkerState[], timeoutMs: number): Promise<void> {
  const done = () => states.includes(worker.state) || worker.state === 'redundant';
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (done()) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', onChange);
  });
}

/**
 * Asks the service worker for a newer build, lets it take over, then reloads. Offline, or
 * without a service worker, it reloads the build already on the phone.
 */
export async function reloadApp(deps: ReloadDeps = browserReloadDeps()): Promise<void> {
  const reg = await deps.registration().catch(() => undefined);
  if (reg) {
    try {
      await reg.update();
    } catch {
      // Offline or the server is unreachable: reload what the phone has.
    }
    const installing = reg.installing;
    if (installing) await reached(installing, ['installed', 'activated'], deps.timeoutMs);
    const waiting = reg.waiting;
    if (waiting) {
      applying = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
      await reached(waiting, ['activated'], deps.timeoutMs);
    }
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
