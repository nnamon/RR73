import { describe, expect, it, vi } from 'vitest';
import { clearCacheAndReload, reloadApp, type ReloadDeps } from './update.svelte';

class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  constructor(public state: ServiceWorkerState) {
    super();
  }
  postMessage(m: unknown) {
    this.messages.push(m);
  }
  to(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
  activate() {
    this.to('activated');
  }
}

function deps(over: Partial<ReloadDeps> = {}) {
  const order: string[] = [];
  const d: ReloadDeps = {
    registration: async () => undefined,
    registrations: async () => [],
    cacheKeys: async () => [],
    deleteCache: async () => true,
    reload: vi.fn(() => order.push('reload')),
    timeoutMs: 1000,
    ...over,
  };
  return { d, order };
}

describe('reloadApp', () => {
  it('reloads straight away without a service worker', async () => {
    const { d } = deps();
    await reloadApp(d);
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it('asks for an update, lets the waiting version take over and reloads only after it has', async () => {
    const worker = new FakeWorker('installed');
    const reg = { installing: null, waiting: worker, update: vi.fn(async () => undefined) };
    const { d, order } = deps({ registration: async () => reg as unknown as ServiceWorkerRegistration });
    const done = reloadApp(d);
    await vi.waitFor(() => expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]));
    expect(reg.update).toHaveBeenCalledOnce();
    expect(d.reload).not.toHaveBeenCalled();
    order.push('activated');
    worker.activate();
    await done;
    expect(order).toEqual(['activated', 'reload']);
  });

  it('waits for a version still installing, then lets it take over', async () => {
    const worker = new FakeWorker('installing');
    const reg = { installing: worker as FakeWorker | null, waiting: null as FakeWorker | null, update: vi.fn(async () => undefined) };
    const { d } = deps({ registration: async () => reg as unknown as ServiceWorkerRegistration });
    const done = reloadApp(d);
    await vi.waitFor(() => expect(reg.update).toHaveBeenCalledOnce());
    expect(worker.messages).toEqual([]);
    reg.installing = null;
    reg.waiting = worker;
    worker.to('installed');
    await vi.waitFor(() => expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]));
    expect(d.reload).not.toHaveBeenCalled();
    worker.activate();
    await done;
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it('reloads the build on the phone when the update check fails offline', async () => {
    const reg = { installing: null, waiting: null, update: vi.fn(async () => Promise.reject(new TypeError('offline'))) };
    const { d } = deps({ registration: async () => reg as unknown as ServiceWorkerRegistration });
    await reloadApp(d);
    expect(d.reload).toHaveBeenCalledOnce();
  });

  it('gives up waiting after the timeout and reloads', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker('installing');
    const reg = { installing: worker, waiting: null, update: vi.fn(async () => undefined) };
    const { d } = deps({ registration: async () => reg as unknown as ServiceWorkerRegistration });
    const done = reloadApp(d);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(d.reload).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('clearCacheAndReload', () => {
  it('unregisters every service worker and deletes every cache before reloading', async () => {
    const order: string[] = [];
    const regs = [1, 2].map((n) => ({ unregister: vi.fn(async () => (order.push(`unregister ${n}`), true)) }));
    const { d } = deps({
      registrations: async () => regs as unknown as ServiceWorkerRegistration[],
      cacheKeys: async () => ['workbox-precache', 'runtime'],
      deleteCache: vi.fn(async (k: string) => (order.push(`delete ${k}`), true)),
      reload: () => order.push('reload'),
    });
    await clearCacheAndReload(d);
    expect(order).toEqual(['unregister 1', 'unregister 2', 'delete workbox-precache', 'delete runtime', 'reload']);
  });

  it('still reloads when the browser refuses', async () => {
    const { d } = deps({ registrations: async () => Promise.reject(new Error('denied')), cacheKeys: async () => Promise.reject(new Error('denied')) });
    await clearCacheAndReload(d);
    expect(d.reload).toHaveBeenCalledOnce();
  });
});
