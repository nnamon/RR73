// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureEngine, type EngineDeps } from './engine';
import type { CaptureMessage } from './messages';
import recorded from '../../../../fixtures/clock/output-timestamps.json';

vi.mock('./capture.worklet.ts?worker&url', () => ({ default: 'capture.js' }));

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  label = 'Headset Microphone';
  stopped = false;
  getSettings() {
    return { deviceId: 'd1', echoCancellation: false, sampleRate: 48000, channelCount: 1 };
  }
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

class FakeStream {
  track = new FakeTrack();
  getAudioTracks() {
    return [this.track];
  }
  getTracks() {
    return [this.track];
  }
}

class FakeNode {
  port = { onmessage: null as ((e: { data: CaptureMessage }) => void) | null, close: vi.fn() };
  disconnect = vi.fn();
  post(m: CaptureMessage) {
    this.port.onmessage?.({ data: m });
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'interrupted' | 'closed' = 'suspended';
  sampleRate = 48000;
  currentTime = 1;
  onstatechange: (() => void) | null = null;
  perf = 5000;
  resume = vi.fn(async () => this.setState('running'));
  suspend = vi.fn(async () => this.setState('suspended'));
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: this.perf };
  }
  setState(s: FakeContext['state']) {
    this.state = s;
    this.onstatechange?.();
  }
}

const T0 = Date.UTC(2026, 9, 13, 13, 14, 52);

function setup(over: Partial<EngineDeps> = {}) {
  const ctx = new FakeContext();
  const nodes: FakeNode[] = [];
  const streams: FakeStream[] = [];
  const clock = { perf: 5000, date: T0 };
  const deps: EngineDeps = {
    createContext: () => ctx as unknown as AudioContext,
    getUserMedia: vi.fn(async () => {
      const s = new FakeStream();
      streams.push(s);
      return s as unknown as MediaStream;
    }),
    createNode: vi.fn(async () => {
      const n = new FakeNode();
      nodes.push(n);
      return n as unknown as AudioWorkletNode;
    }),
    doc: document,
    dateNow: () => clock.date,
    perfNow: () => clock.perf,
    secure: () => true,
    setSession: () => 'play-and-record',
    ...over,
  };
  const engine = new CaptureEngine(deps);
  return { engine, ctx, nodes, streams, deps, clock };
}

/** One chunk, s. */
const CHUNK_S = 512 / 12000;

function chunk(index: number, contextTime: number): CaptureMessage {
  return { type: 'chunk', samples: new Float32Array(512), index, contextTime, peakDb: -20, rmsDb: -30 };
}

/**
 * Replays recorded clock readings (fixtures/clock/output-timestamps.json), one chunk each, and
 * returns how far the UTC stamped on each chunk's end is from Date.now(), ms. The chunk ends at
 * currentTime, which pairs with Date.now(), so a correct mapping gives the output latency.
 */
async function replay(rows: number[][]): Promise<number[]> {
  const { engine, ctx, nodes, clock } = setup();
  await engine.start();
  const errors: number[] = [];
  // Chunks wait while the mapping settles, so each is compared with the Date.now() of its own reading.
  engine.onChunk((c) => errors.push(c.utcMs + (c.samples.length / 12000) * 1000 - rows[c.index / 512][3]));
  rows.forEach(([contextTime, performanceTime, perfNow, dateNow, currentTime], i) => {
    ctx.getOutputTimestamp = () => ({ contextTime, performanceTime });
    ctx.currentTime = currentTime;
    clock.perf = perfNow;
    clock.date = dateNow;
    nodes[0].post(chunk(i * 512, currentTime - 512 / 12000));
  });
  return errors;
}

/**
 * Stamp errors from Chromium's output timestamps: its output latency, 28 to 43 ms, where currentTime
 * paired with now would give 0. Date.now() read late on a busy thread moves single errors by 15 ms.
 */
function expectOutputLatency(errors: number[]) {
  for (const e of errors) {
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(60);
  }
  const sorted = [...errors].sort((a, b) => a - b);
  expect(sorted[sorted.length >> 1]).toBeGreaterThan(25);
  expect(sorted[sorted.length >> 1]).toBeLessThan(50);
}

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('CaptureEngine', () => {
  beforeEach(() => setVisibility('visible'));

  it('starts from a tap and reports what the browser applied', async () => {
    const { engine, deps } = setup();
    const state = await engine.start();
    expect(state.status).toBe('running');
    expect(deps.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.objectContaining({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }) }),
    );
    expect(engine.captureReport).toMatchObject({ inputLabel: 'Headset Microphone', contextRate: 48000, echoCancellation: false, audioSession: 'play-and-record' });
  });

  it('stamps chunks with UTC through the output timestamp', async () => {
    const { engine, ctx, nodes, clock } = setup();
    await engine.start();
    const got: number[] = [];
    engine.onChunk((c) => got.push(c.utcMs));
    // Output timestamp: context time 2 s is heard at performance time 5000 ms, which is T0.
    ctx.currentTime = 2;
    ctx.perf = 5000;
    clock.perf = 5000;
    clock.date = T0;
    // Chunks wait until 5 readings agree, then go out stamped with the settled mapping.
    for (let i = 0; i < 4; i++) nodes[0].post(chunk(i * 512, 1.5 + i * CHUNK_S));
    expect(got).toEqual([]);
    nodes[0].post(chunk(4 * 512, 1.5 + 4 * CHUNK_S));
    expect(got).toHaveLength(5);
    expect(got[0]).toBe(T0 - 500);
    expect(got[4]).toBeCloseTo(T0 - 500 + 4 * CHUNK_S * 1000, 6);
  });

  it('maps from currentTime until output timestamps arrive, then starts over on them', async () => {
    const { engine, ctx, nodes, clock } = setup();
    await engine.start();
    const got: number[] = [];
    engine.onChunk((c) => got.push(c.utcMs));
    // No output yet: the timestamp is empty, so currentTime pairs with now.
    ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
    ctx.currentTime = 2;
    clock.perf = 5000;
    clock.date = T0;
    for (let i = 0; i < 5; i++) nodes[0].post(chunk(i * 512, 1.5));
    expect(got[0]).toBe(T0 - 500);
    expect(engine.clockSource).toBe('current-time');
    // Output starts: context time 2 s is heard 40 ms after now. Only these observations count.
    ctx.getOutputTimestamp = () => ({ contextTime: 2, performanceTime: 5040 });
    for (let i = 5; i < 10; i++) nodes[0].post(chunk(i * 512, 1.5 + CHUNK_S));
    expect(got).toHaveLength(10);
    expect(got[5]).toBeCloseTo(T0 + 40 - 500 + CHUNK_S * 1000, 6);
    expect(engine.clockSource).toBe('output');
  });

  it('updates the report with the channels that arrive', async () => {
    const { engine, nodes } = setup();
    await engine.start();
    nodes[0].post({ type: 'format', channels: 2, channelUsed: 'left', sampleRate: 48000 });
    expect(engine.captureReport).toMatchObject({ arrivingChannels: 2, channelUsed: 'left' });
  });

  it('stops when iOS interrupts the context and says when audio ended', async () => {
    const { engine, ctx, nodes } = setup();
    await engine.start();
    ctx.currentTime = 2;
    for (let i = 0; i < 5; i++) nodes[0].post(chunk(i * 512, 1.5 - (4 - i) * CHUNK_S));
    ctx.setState('interrupted');
    expect(engine.state).toMatchObject({ status: 'stopped', reason: 'interrupted' });
    // The last chunk started 0.5 s before T0 and lasted 512 samples.
    expect(engine.state.stoppedAtUtcMs).toBeCloseTo(T0 - 500 + (512 / 12000) * 1000, 6);
  });

  it('stops when the page is hidden and waits for a tap', async () => {
    const { engine, ctx } = setup();
    await engine.start();
    setVisibility('hidden');
    expect(engine.state).toMatchObject({ status: 'stopped', reason: 'hidden' });
    expect(ctx.suspend).toHaveBeenCalled();
    setVisibility('visible');
    expect(engine.state.status).toBe('stopped');
    expect((await engine.resume()).status).toBe('running');
  });

  it('stops when the input ends and opens it again on resume', async () => {
    const { engine, streams, deps } = setup();
    await engine.start();
    streams[0].track.readyState = 'ended';
    streams[0].track.dispatchEvent(new Event('ended'));
    expect(engine.state).toMatchObject({ status: 'stopped', reason: 'input-ended' });
    expect((await engine.resume()).status).toBe('running');
    expect(deps.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('stops when the input goes mute', async () => {
    const { engine, streams } = setup();
    await engine.start();
    streams[0].track.muted = true;
    streams[0].track.dispatchEvent(new Event('mute'));
    expect(engine.state).toMatchObject({ status: 'stopped', reason: 'input-muted' });
  });

  it('keeps a live input on resume', async () => {
    const { engine, ctx, deps } = setup();
    await engine.start();
    ctx.setState('suspended');
    expect(engine.state.reason).toBe('suspended');
    await engine.resume();
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(engine.state.status).toBe('running');
  });

  it('reports a refused microphone', async () => {
    const { engine } = setup({ getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) });
    expect(await engine.start()).toMatchObject({ status: 'failed', error: 'denied' });
  });

  it('reports a page without microphone access', async () => {
    const { engine } = setup({ secure: () => false });
    expect(await engine.start()).toMatchObject({ status: 'failed', error: 'insecure' });
  });

  it('reports a worklet that will not load and releases the microphone', async () => {
    const { engine, streams } = setup({ createNode: async () => Promise.reject(new Error('404')) });
    expect(await engine.start()).toMatchObject({ status: 'failed', error: 'worklet' });
    expect(streams[0].track.stopped).toBe(true);
  });

  it('switches input by opening the new device', async () => {
    const { engine, streams, deps } = setup();
    await engine.start();
    await engine.useInput('d2');
    expect(streams[0].track.stopped).toBe(true);
    expect(deps.getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'd2' } }) }));
    expect(engine.state.status).toBe('running');
  });

  it('stamps chunks on UTC with the output timestamps Chromium gives', async () => {
    const errors = await replay(recorded.chromium);
    expect(errors).toHaveLength(recorded.chromium.length);
    expectOutputLatency(errors);
  });

  it('stamps chunks on UTC when the output timestamps run at twice the real rate (Playwright\'s WebKit)', async () => {
    const errors = await replay(recorded.webkit);
    // The first readings look plausible and count until a run of bad ones; then currentTime takes over.
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(500);
    for (const e of errors.slice(8)) expect(Math.abs(e)).toBeLessThan(5);
  });

  it('rides out a few implausible output timestamps', async () => {
    const good = recorded.chromium.slice(0, 40);
    const bad = good.slice(10, 13).map(([c, p, n, d, t]) => [c, p + 5000, n, d, t]);
    expectOutputLatency(await replay([...good.slice(0, 10), ...bad, ...good.slice(13)]));
  });

  it('trusts output timestamps again after a resume', async () => {
    const { engine, ctx, nodes, clock } = setup();
    await engine.start();
    const got: number[] = [];
    engine.onChunk((c) => got.push(c.utcMs));
    clock.perf = 5000;
    clock.date = T0;
    ctx.currentTime = 2;
    // Heard 3 s after now: wrong. After 5 of these, currentTime pairs with now.
    ctx.getOutputTimestamp = () => ({ contextTime: 2, performanceTime: 8000 });
    for (let i = 0; i < 9; i++) nodes[0].post(chunk(i * 512, 1.5));
    expect(got[0]).toBe(T0 - 500);
    expect(engine.clockSource).toBe('current-time');
    ctx.setState('suspended');
    await engine.resume();
    const n = got.length;
    ctx.getOutputTimestamp = () => ({ contextTime: 2, performanceTime: 5040 });
    for (let i = 0; i < 5; i++) nodes[0].post(chunk(i * 512, 1.5));
    expect(got[n]).toBe(T0 + 40 - 500);
    expect(engine.clockSource).toBe('output');
  });
});
