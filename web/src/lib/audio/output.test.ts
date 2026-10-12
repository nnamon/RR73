import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUNE, TransmitOutput } from './output';

/** A context whose clock the test moves, recording what the nodes are told. */
function fakeContext() {
  const log: string[] = [];
  const ctx = {
    currentTime: 1,
    destination: { name: 'destination' },
    createOscillator() {
      const osc = {
        context: ctx,
        type: '',
        frequency: { value: 0 },
        onended: null as (() => void) | null,
        connect: (n: { name?: string }) => {
          log.push(`osc -> ${n.name ?? 'gain'}`);
          return gain;
        },
        start: (t: number) => log.push(`start ${t.toFixed(3)}`),
        stop: (t: number) => log.push(`stop ${t.toFixed(3)}`),
        disconnect: () => log.push('osc disconnect'),
      };
      oscs.push(osc);
      return osc;
    },
    createGain() {
      return gain;
    },
  };
  const gain = {
    name: 'gain',
    gain: {
      value: 0.5,
      setValueAtTime: () => undefined,
      linearRampToValueAtTime: (v: number, t: number) => log.push(`ramp ${v} at ${t.toFixed(3)}`),
      cancelScheduledValues: () => undefined,
    },
    connect: (n: { name?: string }) => {
      log.push(`gain -> ${n.name}`);
      return n;
    },
    disconnect: () => log.push('gain disconnect'),
  };
  const oscs: { onended: (() => void) | null }[] = [];
  return { ctx: ctx as unknown as AudioContext, log, oscs, clock: ctx };
}

describe('TransmitOutput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the Tune tone through one oscillator and gain to the output', () => {
    const { ctx, log } = fakeContext();
    const out = new TransmitOutput();
    out.tune(ctx);
    expect(out.active).toBe(true);
    expect(log).toEqual(['ramp 0.5 at 1.025', 'ramp 0 at 11.020', 'osc -> gain', 'gain -> destination', 'start 1.020', 'stop 11.021']);
    expect(TUNE).toEqual({ hz: 1500, seconds: 10, level: 0.5 });
  });

  it('halts at once: 3 ms ramp, stop 4 ms later, then disconnects', async () => {
    const { ctx, log } = fakeContext();
    const out = new TransmitOutput();
    const h = out.tune(ctx);
    log.length = 0;
    (ctx as unknown as { currentTime: number }).currentTime = 3;
    out.halt();
    expect(out.active).toBe(false);
    expect(log).toEqual(['ramp 0 at 3.003', 'stop 3.004']);
    await expect(h.done).resolves.toBe('halted');
    vi.advanceTimersByTime(60);
    expect(log).toContain('osc disconnect');
    expect(log).toContain('gain disconnect');
  });

  it('finishes when the oscillator ends', async () => {
    const { ctx, oscs } = fakeContext();
    const out = new TransmitOutput();
    const h = out.tune(ctx);
    oscs[0].onended?.();
    await expect(h.done).resolves.toBe('finished');
    expect(out.active).toBe(false);
  });

  it('stops by the wall clock 300 ms after the end when the audio clock runs slow', async () => {
    const { ctx, log } = fakeContext();
    const out = new TransmitOutput();
    const h = out.tune(ctx);
    vi.advanceTimersByTime(10_000 + 20 + 299);
    expect(out.active).toBe(true);
    vi.advanceTimersByTime(2);
    expect(out.active).toBe(false);
    expect(log.at(-1)).toMatch(/^stop /);
    await expect(h.done).resolves.toBe('finished');
  });

  it('tells listeners when output starts and stops, and ignores Halt when silent', () => {
    const { ctx } = fakeContext();
    const out = new TransmitOutput();
    const seen: boolean[] = [];
    out.onChange((a) => seen.push(a));
    out.halt();
    out.tune(ctx);
    out.halt();
    expect(seen).toEqual([true, false]);
  });
});
