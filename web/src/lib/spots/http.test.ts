import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, isAbort, REQUEST_TIMEOUT_MS, type FetchFn } from './http';
import { SpotFetchError } from './types';

const signal = () => new AbortController().signal;

/** A fetch that never answers but stops when its signal aborts, as browsers do. */
const hanging: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('getJson', () => {
  it('parses the body', async () => {
    await expect(getJson('u', signal(), async () => new Response('[1,2]'))).resolves.toEqual([1, 2]);
  });

  it('sorts failures into network, http and format', async () => {
    await expect(getJson('u', signal(), () => Promise.reject(new TypeError('Load failed')))).rejects.toMatchObject({ kind: 'network', status: null });
    await expect(getJson('u', signal(), async () => new Response('', { status: 502 }))).rejects.toMatchObject({ kind: 'http', status: 502 });
    await expect(getJson('u', signal(), async () => new Response('<html>'))).rejects.toMatchObject({ kind: 'format' });
    await expect(getJson('u', signal(), async () => new Response(''))).rejects.toMatchObject({ kind: 'format' });
  });

  it('times out after 15 s, counting the body', async () => {
    vi.useFakeTimers();
    let settled = false;
    const seen = getJson('u', signal(), hanging).catch((e: unknown) => e);
    void seen.finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const e = await seen;
    expect(e).toBeInstanceOf(SpotFetchError);
    expect(e).toMatchObject({ kind: 'timeout', status: null, afterMs: 15_000 });
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);

    const slowBody: FetchFn = async (_u, init) =>
      ({
        ok: true,
        status: 200,
        text: () => hanging('', init),
      }) as unknown as Response;
    const q = getJson('u', signal(), slowBody, 1000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await q).toMatchObject({ kind: 'timeout', afterMs: 1000 });
  });

  it('rejects with an AbortError when the caller aborts', async () => {
    const ctl = new AbortController();
    const p = getJson('u', ctl.signal, hanging).catch((e: unknown) => e);
    ctl.abort();
    expect(isAbort(await p)).toBe(true);
    const done = new AbortController();
    done.abort();
    expect(isAbort(await getJson('u', done.signal, hanging).catch((e: unknown) => e))).toBe(true);
  });

  it('clears its timer after an answer', async () => {
    vi.useFakeTimers();
    await getJson('u', signal(), async () => new Response('{}'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
