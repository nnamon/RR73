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
