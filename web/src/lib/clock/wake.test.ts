import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WakeTimers, type FromWake, type ToWake, type WakeWorker } from './wake';

/** A worker whose timers the test fires by hand, as a hidden page's throttled clock would leave them. */
class FakeWorker implements WakeWorker {
  sent: ToWake[] = [];
  onmessage: ((e: MessageEvent<FromWake>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  postMessage(m: ToWake) {
    this.sent.push(m);
  }
  fire(id: number) {
    this.onmessage?.({ data: { type: 'due', id } } as MessageEvent<FromWake>);
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WakeTimers', () => {
  it('runs a timeout when the worker says it is due, once, though the page clock has not got there', () => {
    const w = new FakeWorker();
    const t = new WakeTimers(() => w);
    const fn = vi.fn();
    const id = t.set(fn, 5000);
    expect(w.sent).toEqual([{ type: 'set', id, ms: 5000 }]);
    vi.advanceTimersByTime(1000);
    w.fire(id);
    expect(fn).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    w.fire(id);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('runs on the page clock when the worker is late or missing', () => {
    const w = new FakeWorker();
    const fn = vi.fn();
    new WakeTimers(() => w).set(fn, 2000);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledOnce();
    const alone = vi.fn();
    new WakeTimers(() => null).set(alone, 300);
    vi.advanceTimersByTime(300);
    expect(alone).toHaveBeenCalledOnce();
  });

  it('cancels a timeout in the page and in the worker', () => {
    const w = new FakeWorker();
    const t = new WakeTimers(() => w);
    const fn = vi.fn();
    const id = t.set(fn, 1000);
    t.clear(id);
    expect(w.sent.at(-1)).toEqual({ type: 'clear', id });
    w.fire(id);
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
    t.clear(null);
    t.clear(id);
  });

  it('repeats every interval until stopped', () => {
    const t = new WakeTimers(() => null);
    const fn = vi.fn();
    const stop = t.every(fn, 1000);
    vi.advanceTimersByTime(3500);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('falls back to the page clock after a worker error', () => {
    const w = new FakeWorker();
    const t = new WakeTimers(() => w);
    t.set(() => undefined, 1000);
    w.onerror?.(new Event('error'));
    const fn = vi.fn();
    t.set(fn, 500);
    expect(w.sent).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledOnce();
  });
});
