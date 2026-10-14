import { describe, expect, it } from 'vitest';
import { AudioClockMapper, outputLatencyMs, plausibleTimestamp } from './mapping';
import recorded from '../../../../fixtures/clock/output-timestamps.json';
import { prng } from '../testing/signal';

// A simulated pair of clocks: performance.now() starts at 0 at `origin` (UTC ms), and the audio
// clock started `audioStart` ms of performance time later and runs at `rate` relative to it.
function clocks(origin: number, audioStart: number, rate = 1) {
  return {
    perfAt: (contextTime: number) => audioStart + (contextTime * 1000) / rate,
    utcAt: (perf: number) => origin + perf,
  };
}

describe('AudioClockMapper', () => {
  const origin = Date.UTC(2026, 9, 13, 13, 14, 0);

  it('maps the audio clock to UTC from output timestamps', () => {
    const c = clocks(origin, 1234.5);
    const m = new AudioClockMapper();
    expect(m.ready).toBe(false);
    for (let t = 1; t < 3; t += 0.05) {
      const perf = c.perfAt(t);
      const perfNow = perf + 20; // read 20 ms after the timestamp's instant
      expect(m.observe({ contextTime: t, performanceTime: perf }, perfNow, c.utcAt(perfNow))).toBe(true);
    }
    expect(m.ready).toBe(true);
    expect(m.toUtcMs(10)).toBeCloseTo(c.utcAt(c.perfAt(10)), 6);
    expect(m.toContextTime(m.toUtcMs(42.5))).toBeCloseTo(42.5, 9);
  });

  it('rejects jitter in single timestamps', () => {
    const c = clocks(origin, 500);
    const r = prng(3);
    const m = new AudioClockMapper();
    for (let i = 0; i < 200; i++) {
      const t = 1 + i * 0.043;
      const perf = c.perfAt(t) + (r() - 0.5) * 6; // ±3 ms jitter
      const spike = i % 17 === 0 ? 80 : 0; // a late callback now and then
      const perfNow = c.perfAt(t) + 5;
      m.observe({ contextTime: t, performanceTime: perf + spike }, perfNow, c.utcAt(perfNow));
    }
    expect(Math.abs(m.toUtcMs(20) - c.utcAt(c.perfAt(20)))).toBeLessThan(1.5);
  });

  it('follows drift between the sound card and the system clock', () => {
    const c = clocks(origin, 0, 1.0001); // audio clock 100 ppm fast
    const m = new AudioClockMapper();
    for (let t = 1; t < 600; t += 0.043) {
      const perf = c.perfAt(t);
      m.observe({ contextTime: t, performanceTime: perf }, perf, c.utcAt(perf));
    }
    expect(Math.abs(m.toUtcMs(599.9) - c.utcAt(c.perfAt(599.9)))).toBeLessThan(1);
  });

  it('ignores timestamps from a context that is not playing yet', () => {
    const m = new AudioClockMapper();
    expect(m.observe({ contextTime: 0, performanceTime: 0 }, 100, origin)).toBe(false);
    expect(m.ready).toBe(false);
    expect(() => m.toUtcMs(1)).toThrow();
  });

  it('applies the input offset to captured audio and never to transmit times', () => {
    const c = clocks(origin, 0);
    const m = new AudioClockMapper();
    m.observe({ contextTime: 1, performanceTime: c.perfAt(1) }, c.perfAt(1), c.utcAt(c.perfAt(1)));
    const heard = m.toUtcMs(5);
    m.inputOffsetS = -0.3;
    expect(m.captureUtcMs(5)).toBeCloseTo(heard - 300, 9);
    expect(m.toUtcMs(5)).toBe(heard);
    expect(m.toContextTime(heard)).toBeCloseTo(5, 9);
  });

  it('estimates the drift of an audio clock that runs 1000 ppm slow', () => {
    const c = clocks(origin, 250, 1 - 1000e-6);
    const m = new AudioClockMapper();
    for (let t = 1; t < 200; t += 0.0427) {
      const perf = c.perfAt(t);
      m.observe({ contextTime: t, performanceTime: perf }, perf + 10, c.utcAt(perf + 10));
      if (t < 50) expect(m.driftPpm).toBeNull();
    }
    expect(m.driftPpm).toBeCloseTo(1000, -1);
    m.reset();
    expect(m.driftPpm).toBeNull();
  });

  it('starts over after reset', () => {
    const m = new AudioClockMapper();
    m.observe({ contextTime: 1, performanceTime: 1000 }, 1000, origin + 1000);
    m.reset();
    expect(m.ready).toBe(false);
    m.observe({ contextTime: 1, performanceTime: 9000 }, 9000, origin + 9000);
    expect(m.toUtcMs(1)).toBe(origin + 9000);
  });

  it('accepts the output timestamps Chromium gives and rejects those of Playwright\'s WebKit', () => {
    const check = (rows: number[][]) =>
      rows.map(([contextTime, performanceTime, perfNow, , currentTime]) => ({
        latency: outputLatencyMs({ contextTime, performanceTime }, currentTime, perfNow),
        ok: plausibleTimestamp({ contextTime, performanceTime }, currentTime, perfNow),
      }));
    // Chromium: 28 to 43 ms of output latency throughout.
    for (const r of check(recorded.chromium)) {
      expect(r.latency).toBeGreaterThan(25);
      expect(r.latency).toBeLessThan(50);
      expect(r.ok).toBe(true);
    }
    // WebKit: performanceTime advances 2 s per second, so the latency grows with the time audio has run.
    const webkit = check(recorded.webkit);
    expect(webkit.at(-1)!.latency).toBeGreaterThan(29_000);
    expect(webkit.filter((r) => r.latency > 500).every((r) => !r.ok)).toBe(true);
    expect(webkit.slice(8).every((r) => !r.ok)).toBe(true);
  });
});
