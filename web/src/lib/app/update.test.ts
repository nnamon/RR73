import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, checkUpdated, dismissNotice, isStale, noteLoadFailure, registerServiceWorker, reloadIfIdle, update, type WorkerContainer } from './update.svelte';

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('update notice', () => {
  beforeEach(() => {
    update.notice = null;
    update.ready = false;
    update.stale = false;
  });

  it('says nothing on the first run and records the version', () => {
    const s = store();
    checkUpdated('0.1.0', s);
    expect(update.notice).toBeNull();
    expect(s.m.get('rr73.lastVersion')).toBe('0.1.0');
  });

  it('announces a newer version once', () => {
    const s = store({ 'rr73.lastVersion': '0.1.0' });
    checkUpdated('0.1.1', s);
    expect(update.notice).toBe('0.1.1');
    dismissNotice();
    checkUpdated('0.1.1', s);
    expect(update.notice).toBeNull();
  });

  it('says nothing after a downgrade', () => {
    checkUpdated('0.1.0', store({ 'rr73.lastVersion': '0.2.0' }));
    expect(update.notice).toBeNull();
  });

  it('reloads into a ready update only when idle', () => {
    const reload = vi.fn();
    expect(reloadIfIdle(false, reload)).toBe(false);
    update.ready = true;
    expect(reloadIfIdle(true, reload)).toBe(false);
    expect(reloadIfIdle(false, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});

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
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
}

class FakeContainer extends EventTarget {
  constructor(
    public controller: ServiceWorker | null,
    public reg: FakeRegistration,
  ) {
    super();
  }
  register = vi.fn(async () => this.reg as unknown as ServiceWorkerRegistration);
}

const page = (entry: string) => `<script type="module" crossorigin src="/RR73${entry}"></script>`;
const answer = (body: string, ok = true) => async () => ({ ok, text: async () => body });

describe('service worker updates', () => {
  beforeEach(() => {
    update.ready = false;
    update.stale = false;
  });

  it('registers the worker at the base path and marks an update ready once a new version waits', async () => {
    const reg = new FakeRegistration();
    const c = new FakeContainer({} as ServiceWorker, reg);
    await registerServiceWorker(c as unknown as WorkerContainer, '/RR73/', vi.fn());
    expect(c.register).toHaveBeenCalledWith('/RR73/sw.js', { scope: '/RR73/' });
    expect(update.ready).toBe(false);
    const next = new FakeWorker('installing');
    reg.installing = next;
    reg.dispatchEvent(new Event('updatefound'));
    expect(update.ready).toBe(false);
    next.to('installed');
    expect(update.ready).toBe(true);
  });

  it('does not wait for anything on the first install', async () => {
    const reg = new FakeRegistration();
    reg.installing = new FakeWorker('installing');
    const c = new FakeContainer(null, reg);
    await registerServiceWorker(c as unknown as WorkerContainer, '/', vi.fn());
    reg.installing.to('installed');
    expect(update.ready).toBe(false);
  });

  it('marks an update ready when another copy lets a new version take over', async () => {
    const c = new FakeContainer({} as ServiceWorker, new FakeRegistration());
    const reload = vi.fn();
    await registerServiceWorker(c as unknown as WorkerContainer, '/', reload);
    c.dispatchEvent(new Event('controllerchange'));
    expect(update.ready).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('lets the waiting version take over, then reloads when it has', async () => {
    const reg = new FakeRegistration();
    reg.waiting = new FakeWorker('installed');
    const c = new FakeContainer({} as ServiceWorker, reg);
    const reload = vi.fn();
    await registerServiceWorker(c as unknown as WorkerContainer, '/', reload);
    applyUpdate(reg as unknown as ServiceWorkerRegistration, reload);
    expect(reg.waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(reload).not.toHaveBeenCalled();
    c.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads at once when no version waits', () => {
    const reload = vi.fn();
    applyUpdate(null, reload);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('a stale build', () => {
  beforeEach(() => {
    update.ready = false;
    update.stale = false;
  });

  it('is one whose index.html now names another main script', async () => {
    expect(await isStale('/assets/index-BflCaAqF.js', answer(page('/assets/index--MzYV1lU.js')))).toBe(true);
    expect(await isStale('/assets/index-BflCaAqF.js', answer(page('/assets/index-BflCaAqF.js')))).toBe(false);
  });

  it('is not assumed when the check cannot tell', async () => {
    expect(await isStale(null, answer(page('/assets/index-X.js')))).toBe(false);
    expect(await isStale('/assets/index-A.js', answer('<p>404</p>', false))).toBe(false);
    expect(await isStale('/assets/index-A.js', answer('<p>no script</p>'))).toBe(false);
    expect(await isStale('/assets/index-A.js', async () => Promise.reject(new TypeError('offline')))).toBe(false);
  });

  it('after a failed load marks the page stale and ready to reload, only when it is', async () => {
    await noteLoadFailure(async () => false);
    expect(update).toMatchObject({ stale: false, ready: false });
    await noteLoadFailure(async () => true);
    expect(update).toMatchObject({ stale: true, ready: true });
  });

  it('reloads at the next change of screen, never while audio runs', () => {
    const reload = vi.fn();
    update.stale = true;
    expect(reloadIfIdle(true, reload)).toBe(false);
    expect(reloadIfIdle(false, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
