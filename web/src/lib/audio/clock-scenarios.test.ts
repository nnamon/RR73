// @vitest-environment jsdom
// The capture engine on a simulated audio clock: currentTime runs at a set rate against the system
// clock, stops while the context is suspended, and the output timestamps can be right, missing or
// skewed. Each scenario checks the UTC stamped on every chunk against the time its first sample was
// rendered, and the start of a transmission against slot + 0.5 s.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureEngine, type EngineDeps } from './engine';
import type { CaptureMessage } from './messages';
import { webAudioOut } from '../tx/web-audio';

vi.mock('./capture.worklet.ts?worker&url', () => ({ default: 'capture.js' }));

/** UTC at performance time 0, ms. */
const ORIGIN = Date.UTC(2026, 9, 13, 13, 30, 0);
const CHUNK_S = 512 / 12000;
/** Output latency of the simulated device, ms. */
const OUT_MS = 30;

class FakeTrack extends EventTarget {
  readyState = 'live';
  muted = false;
  label = 'Headset Microphone';
  getSettings() {
    return { deviceId: 'd1', sampleRate: 48000, channelCount: 1 };
  }
  stop() {
    this.readyState = 'ended';
  }
}

class FakeNode {
  port = { onmessage: null as ((e: { data: CaptureMessage }) => void) | null, close: vi.fn() };
  disconnect = vi.fn();
}

/** An AudioContext on a simulated clock. Rendering runs at `rate` audio-clock seconds per second. */
class SimContext {
  perf = 1000;
  state: 'suspended' | 'running' = 'suspended';
  readonly sampleRate = 48000;
  onstatechange: (() => void) | null = null;
  /** What getOutputTimestamp gives: right, nothing, or right with a skew on the next few calls. */
  stamps: 'good' | 'none' = 'good';
  skewNext = 0;
  skewMs = 150;
  /** Running stretches: from performance time perf0 the clock runs on from ctx0. */
  private segs: { perf0: number; ctx0: number }[] = [];
  private frozen = 1;

  constructor(readonly rate: number) {}

  get currentTime(): number {
    const s = this.segs[this.segs.length - 1];
    return this.state === 'running' && s ? s.ctx0 + ((this.perf - s.perf0) / 1000) * this.rate : this.frozen;
  }

  /** Performance time at which audio-clock time `c` is rendered, ms. */
  renderPerf(c: number): number {
    const s = [...this.segs].reverse().find((x) => x.ctx0 <= c) ?? this.segs[0];
    return s.perf0 + ((c - s.ctx0) / this.rate) * 1000;
  }

  resume = vi.fn(async () => {
    if (this.state === 'running') return;
    this.segs.push({ perf0: this.perf, ctx0: this.frozen });
    this.state = 'running';
    // Browsers fire statechange as a task, after the call that changed the state.
    queueMicrotask(() => this.onstatechange?.());
  });

  suspend = vi.fn(async () => {
    if (this.state !== 'running') return;
    this.frozen = this.currentTime;
    this.state = 'suspended';
    queueMicrotask(() => this.onstatechange?.());
  });

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  getOutputTimestamp() {
    if (this.stamps === 'none' || this.state !== 'running') return { contextTime: 0, performanceTime: 0 };
    // The frame heard now was rendered OUT_MS ago.
    const contextTime = this.currentTime - (OUT_MS / 1000) * this.rate;
    let performanceTime = this.perf;
    if (this.skewNext > 0) {
      this.skewNext--;
      performanceTime += this.skewMs;
    }
    return { contextTime, performanceTime };
  }
}

interface Stamp {
  /** Stamp minus the UTC at which the chunk's first sample was rendered, ms. */
  errorMs: number;
  source: string | null;
  atPerf: number;
}

async function setup(ppm: number) {
  const ctx = new SimContext(1 - ppm * 1e-6);
  const nodes: FakeNode[] = [];
  const deps: EngineDeps = {
    createContext: () => ctx as unknown as AudioContext,
    getUserMedia: async () => {
      const track = new FakeTrack();
      return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    },
    createNode: async () => {
      const n = new FakeNode();
      nodes.push(n);
      return n as unknown as AudioWorkletNode;
    },
    doc: document,
    dateNow: () => ORIGIN + ctx.perf,
    perfNow: () => ctx.perf,
    secure: () => true,
    setSession: () => 'play-and-record',
  };
  const engine = new CaptureEngine(deps);
  const stamps: Stamp[] = [];
  engine.onChunk((c) => stamps.push({ errorMs: c.utcMs - (ORIGIN + ctx.renderPerf(c.contextTime)), source: engine.clockSource, atPerf: ctx.perf }));
  await engine.start();
  let index = 0;
  return {
    ctx,
    engine,
    stamps,
    /** Runs the clock for `seconds`, with a chunk from the worklet every 42.7 ms of audio while capture runs. */
    run(seconds: number) {
      const step = (CHUNK_S / ctx.rate) * 1000;
      for (let t = 0; t < seconds * 1000; t += step) {
        ctx.perf += step;
        if (ctx.state !== 'running') continue;
        nodes[nodes.length - 1].port.onmessage?.({
          data: { type: 'chunk', samples: new Float32Array(512), index, contextTime: ctx.currentTime - CHUNK_S, peakDb: -20, rmsDb: -30 },
        });
        index += 512;
      }
    },
    /** Hides the page for `seconds` and resumes from a tap. */
    async hideAndResume(seconds: number, beforeResume?: () => void) {
      setVisibility('hidden');
      await Promise.resolve();
      ctx.perf += seconds * 1000;
      setVisibility('visible');
      beforeResume?.();
      await engine.resume();
    },
    /** How far the next slot's transmission would start from slot + 0.5 s, ms, scheduled with the mapping now. */
    txErrorMs(): number {
      const out = webAudioOut(ctx as unknown as AudioContext, engine.mapper);
      const now = ORIGIN + ctx.perf;
      const target = Math.ceil((now + 600) / 15000) * 15000 + 500;
      const when = out.toContextTime(target)!;
      return ORIGIN + ctx.renderPerf(when) + OUT_MS - target;
    },
  };
}

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Stamps follow the render time: plus the output latency on output timestamps (the mapping gives
 * the time a frame is heard), about 0 on currentTime.
 */
function expectOnTime(stamps: Stamp[]) {
  expect(stamps.length).toBeGreaterThan(0);
  const worst = stamps.reduce((w, s) => {
    const expected = s.source === 'output' ? OUT_MS : 0;
    return Math.abs(s.errorMs - expected) > Math.abs(w.errorMs - (w.source === 'output' ? OUT_MS : 0)) ? s : w;
  });
  expect(Math.abs(worst.errorMs - (worst.source === 'output' ? OUT_MS : 0))).toBeLessThan(2);
}

describe('capture stamps on a drifting audio clock', () => {
  beforeEach(() => setVisibility('visible'));

  it('follow an audio clock 1000 ppm slow through 10 hide and resume cycles, and Tx starts on time', async () => {
    const sim = await setup(1000);
    sim.run(60);
    expect(Math.abs(sim.txErrorMs())).toBeLessThan(50);
    for (let i = 0; i < 10; i++) {
      await sim.hideAndResume(20 + i * 7);
      sim.run(90);
      expect(Math.abs(sim.txErrorMs())).toBeLessThan(50);
    }
    expectOnTime(sim.stamps);
    // The mapping offset after each resume matches the one before it.
    const resumes = sim.engine.timing.resumes;
    expect(resumes).toHaveLength(5);
    for (const r of resumes) expect(Math.abs(r.afterMs! - r.beforeMs!)).toBeLessThan(2);
    expect(sim.engine.mapper.driftPpm).toBeCloseTo(1000, -1);
  });

  it('leave output timestamps that stop coming, so the mapping does not drift with the audio clock', async () => {
    const sim = await setup(1000);
    sim.run(30);
    expect(sim.engine.clockSource).toBe('output');
    sim.ctx.stamps = 'none';
    // 10 minutes at 1000 ppm: a mapping left on the old timestamps would be 0.6 s off.
    sim.run(600);
    expectOnTime(sim.stamps);
    expect(Math.abs(sim.txErrorMs())).toBeLessThan(50);
    expect(sim.engine.clockSource).toBe('current-time');
  });

  it('never stamp audio with a skewed first reading after a resume', async () => {
    const sim = await setup(0);
    sim.run(30);
    await sim.hideAndResume(40, () => (sim.ctx.skewNext = 1));
    sim.run(30);
    expectOnTime(sim.stamps);
    expect(Math.abs(sim.txErrorMs())).toBeLessThan(50);
  });

  it('measure how far capture stamps trail the audio clock', async () => {
    const sim = await setup(0);
    sim.run(5);
    expect(sim.engine.timing.captureLagMs).toBeCloseTo(0, 3);
    expect(sim.engine.mappingOffsetMs()).toBeCloseTo(OUT_MS, 0);
  });
});
