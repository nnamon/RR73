/**
 * Timers that keep time while the page is hidden, for what starts a transmission on time: the
 * transmit schedulers' wait for the pre-roll and the 1 s ticks of the sequencer, the WSPR beacon
 * and the keyboard modes.
 *
 * Desktop Chromium keeps receiving in a hidden page (lib/app/platform.ts) and throttles the page's
 * timers there: they fire on whole seconds, and after 5 minutes hidden, chained ones once a
 * minute. A dedicated worker's timers are not throttled, so each timeout also runs in a worker
 * and its message wakes the page (docs/decisions/0010-hidden-window.md has the measurements).
 *
 * Every timeout runs on the page's clock too, and whichever falls due first runs the callback,
 * once. Without a worker (unit tests, a worker file a newer build removed) the page's clock alone
 * runs it.
 */

export type ToWake = { type: 'set'; id: number; ms: number } | { type: 'clear'; id: number };
export type FromWake = { type: 'due'; id: number };

/** The parts of a Worker the timers use. */
export interface WakeWorker {
  postMessage(m: ToWake): void;
  onmessage: ((e: MessageEvent<FromWake>) => void) | null;
  onerror: ((e: Event) => void) | null;
}

function workerOrNull(): WakeWorker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./wake.worker.ts', import.meta.url), { type: 'module' }) as unknown as WakeWorker;
  } catch {
    return null;
  }
}

export class WakeTimers {
  private readonly create: () => WakeWorker | null;
  /** The worker, null without one, undefined until the first timeout asks for it. */
  private worker: WakeWorker | null | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, { fn: () => void; page: ReturnType<typeof setTimeout> }>();

  constructor(create: () => WakeWorker | null = workerOrNull) {
    this.create = create;
  }

  /** Runs `fn` once, `ms` from now. Returns the handle for clear(). */
  set(fn: () => void, ms: number): number {
    const id = this.nextId++;
    const page = setTimeout(() => this.due(id), ms);
    this.pending.set(id, { fn, page });
    this.post({ type: 'set', id, ms });
    return id;
  }

  /** Cancels a timeout that has not run. Unknown and spent handles are ignored. */
  clear(id: unknown) {
    if (typeof id !== 'number') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.page);
    this.post({ type: 'clear', id });
  }

  /** Runs `fn` every `ms` until the returned function is called. */
  every(fn: () => void, ms: number): () => void {
    let handle = 0;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      handle = this.set(run, ms);
      fn();
    };
    handle = this.set(run, ms);
    return () => {
      stopped = true;
      this.clear(handle);
    };
  }

  private due(id: number) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.page);
    p.fn();
  }

  private post(m: ToWake) {
    if (this.worker === undefined) {
      this.worker = this.create();
      if (this.worker) {
        this.worker.onmessage = (e) => this.due(e.data.id);
        // A worker that fails leaves the page's clock to run every timeout.
        this.worker.onerror = () => {
          this.worker = null;
        };
      }
    }
    this.worker?.postMessage(m);
  }
}

/** The app's wake timers. */
export const wake = new WakeTimers();
