import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SAMPLES, type CaptureChunkMessage, type CaptureMessage } from './messages';

// The worklet runs in AudioWorkletGlobalScope. These globals stand in for it: currentFrame is the
// context frame of the block being processed, as the browser sets it before each process() call.
interface Processor {
  process(inputs: Float32Array[][]): boolean;
  readonly sent: CaptureMessage[];
}

const RATE = 48000;
const scope = globalThis as unknown as Record<string, unknown>;
let Ctor: new () => Processor;

beforeAll(async () => {
  scope.sampleRate = RATE;
  scope.currentFrame = 0;
  scope.AudioWorkletProcessor = class {
    readonly sent: CaptureMessage[] = [];
    readonly port = { postMessage: (m: CaptureMessage) => this.sent.push(m) };
  };
  scope.registerProcessor = (_name: string, ctor: new () => Processor) => (Ctor = ctor);
  await import('./capture.worklet');
});

/**
 * Runs `quanta` render quanta from context frame `start` with a click at `clickFrame`. Quanta for
 * which `skip` is true never reach the processor; `empty` ones arrive with no input connected.
 * Returns the chunks and the audio-clock time their stamps give the click, s.
 */
function run(opts: { quanta: number; clickFrame: number; skip?: (q: number) => boolean; empty?: (q: number) => boolean; start?: number }) {
  const p = new Ctor();
  const start = opts.start ?? 4800;
  for (let q = 0; q < opts.quanta; q++) {
    if (opts.skip?.(q)) continue;
    const frame = start + q * 128;
    scope.currentFrame = frame;
    if (opts.empty?.(q)) {
      p.process([[]]);
      continue;
    }
    const block = new Float32Array(128);
    if (opts.clickFrame >= frame && opts.clickFrame < frame + 128) block[opts.clickFrame - frame] = 1;
    p.process([[block]]);
  }
  const chunks = p.sent.filter((m): m is CaptureChunkMessage => m.type === 'chunk');
  let peak = 0;
  let at = NaN;
  for (const c of chunks) {
    c.samples.forEach((x, i) => {
      if (Math.abs(x) > peak) {
        peak = Math.abs(x);
        at = c.contextTime + i / 12000;
      }
    });
  }
  return { chunks, clickAt: at };
}

/** Error of the click's stamp against the frame it was captured in, ms. */
const errorMs = (r: { clickAt: number }, clickFrame: number) => (r.clickAt - clickFrame / RATE) * 1000;

describe('capture worklet stamps', () => {
  it('stamps a click at the frame it was captured in', () => {
    const click = 4800 + 300 * 128 + 17;
    const r = run({ quanta: 600, clickFrame: click });
    expect(Math.abs(errorMs(r, click))).toBeLessThan(0.1);
    // Contiguous chunks with contiguous indexes.
    r.chunks.forEach((c, i) => expect(c.index).toBe(i * CHUNK_SAMPLES));
  });

  it('keeps stamps on the context frame when the browser skips quanta', () => {
    // 10 quanta (26.7 ms) never reach process(), as when the input is silent for a moment.
    const click = 4800 + 300 * 128 + 17;
    const r = run({ quanta: 600, clickFrame: click, skip: (q) => q >= 100 && q < 110 });
    expect(Math.abs(errorMs(r, click))).toBeLessThan(0.1);
    // The gap is filled with silence: the stream stays continuous.
    r.chunks.forEach((c, i) => expect(c.index).toBe(i * CHUNK_SAMPLES));
  });

  it('does not let skipped quanta add up', () => {
    // One quantum in 50 skipped: 2 % of the time, 0.8 s after 40 s of audio if counted.
    const quanta = 15000;
    const click = 4800 + (quanta - 100) * 128 + 5;
    const r = run({ quanta, clickFrame: click, skip: (q) => q % 50 === 25 });
    expect(Math.abs(errorMs(r, click))).toBeLessThan(0.1);
  });

  it('keeps stamps on the context frame when no input is connected for a while', () => {
    const click = 4800 + 300 * 128 + 99;
    const r = run({ quanta: 600, clickFrame: click, empty: (q) => q >= 100 && q < 130 });
    expect(Math.abs(errorMs(r, click))).toBeLessThan(0.1);
  });

  it('starts a new stream after a long gap, with a break in the index', () => {
    // 2 s missing: the stream restarts at the new frame.
    const click = 4800 + 1200 * 128 + 40;
    const r = run({ quanta: 1400, clickFrame: click, skip: (q) => q >= 200 && q < 950 });
    expect(Math.abs(errorMs(r, click))).toBeLessThan(0.1);
    const breakAt = r.chunks.findIndex((c, i) => i > 0 && c.index !== r.chunks[i - 1].index + r.chunks[i - 1].samples.length);
    expect(breakAt).toBeGreaterThan(0);
    const before = r.chunks[breakAt - 1];
    const after = r.chunks[breakAt];
    // The chunk before the break is posted at its length, and the index skips the 2 s.
    expect(before.samples.length).toBeLessThanOrEqual(CHUNK_SAMPLES);
    expect(after.index - (before.index + before.samples.length)).toBeCloseTo(24000, -2);
    expect(after.contextTime).toBeCloseTo((4800 + 950 * 128) / RATE, 6);
  });
});
