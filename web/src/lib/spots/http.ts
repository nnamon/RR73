// One GET with a timeout, sorted into the failures a screen can explain.

import { SpotFetchError } from './types';

/** Longest wait for a spot source to answer, ms. */
export const REQUEST_TIMEOUT_MS = 15_000;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** The page's fetch, looked up at call time so tests can replace it. */
export const pageFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

/**
 * Fetches `url` and returns its body. Rejects with SpotFetchError (network, timeout or http), or
 * with an AbortError when `signal` aborts first. No credentials are sent and the HTTP cache is
 * bypassed, so each poll sees the current list.
 */
export async function getText(url: string, signal: AbortSignal, fetchFn: FetchFn = pageFetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  if (signal.aborted) throw abortError();
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  const onAbort = () => ctl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetchFn(url, { signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new SpotFetchError('http', res.status);
    const body = await res.text();
    if (signal.aborted) throw abortError();
    return body;
  } catch (e) {
    if (e instanceof SpotFetchError) throw e;
    if (signal.aborted) throw abortError();
    if (timedOut) throw new SpotFetchError('timeout', null, timeoutMs);
    throw new SpotFetchError('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** As getText, then parses the body as JSON; a body that is not JSON is a format error. */
export async function getJson(url: string, signal: AbortSignal, fetchFn: FetchFn = pageFetch, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const body = await getText(url, signal, fetchFn, timeoutMs);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SpotFetchError('format');
  }
}

/** The error fetch raises for an aborted request. */
export function abortError(): Error {
  return new DOMException('The request was stopped.', 'AbortError');
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}
