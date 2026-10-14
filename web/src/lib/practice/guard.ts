/**
 * The network guard: while practice is on, fetch refuses every request except this app's own
 * files (same origin, GET or HEAD). Spots, Wavelog and any later reporting go through fetch, so
 * one wrapper here keeps practice QSOs and practice traffic on the phone. The practice log's
 * Wavelog is a stand-in on the phone (wavelog-stand-in.ts) and never reaches this.
 */

export type Fetch = typeof globalThis.fetch;

export const BLOCKED_MESSAGE = 'Practice band is on: RR73 sends nothing over the network.';

/** True when the request may go out while practice is on: one of this app's own files. */
export function allowedInPractice(url: string, method: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  return u.origin === origin && (method === 'GET' || method === 'HEAD');
}

/** `inner` with requests refused while `blocked()` is true, except the app's own files. */
export function guardFetch(inner: Fetch, blocked: () => boolean, origin: string): Fetch {
  return (input, init) => {
    if (blocked()) {
      const req = input instanceof Request ? input : null;
      const url = req ? req.url : input instanceof URL ? input.href : String(input);
      const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
      if (!allowedInPractice(url, method, origin)) return Promise.reject(new TypeError(BLOCKED_MESSAGE));
    }
    return inner(input, init);
  };
}

let installed = false;

/** Wraps the page's fetch once. Requests made before the wrap keep the browser's fetch. */
export function installNetworkGuard(blocked: () => boolean) {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  window.fetch = guardFetch(window.fetch.bind(window), blocked, window.location.origin);
}
