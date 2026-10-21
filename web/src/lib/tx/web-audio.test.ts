import { describe, expect, it } from 'vitest';
import { webAudioOut } from './web-audio';
import type { AudioClockMapper } from '../clock/mapping';

/** Just enough of an AudioContext to see what the Tx source connects to. */
function fakeCtx() {
  const links: [string, unknown][] = [];
  const node = (name: string) => ({
    name,
    connect(to: { name?: string }) {
      links.push([name, to]);
      return to;
    },
    disconnect() {},
  });
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    baseLatency: 0,
    destination: { name: 'destination' },
    createBuffer: () => ({ copyToChannel() {} }),
    createBufferSource: () => ({ ...node('source'), buffer: null, start() {}, stop() {}, onended: null }),
    createGain: () => ({ ...node('gain'), gain: { value: 1 } }),
  };
  return { ctx: ctx as unknown as AudioContext, links };
}

const mapper = { baseMs: 0 } as unknown as AudioClockMapper;

describe('the monitor output', () => {
  it('sends Tx audio to the monitor as well as the radio when one is chosen, and only then', () => {
    const monitor = { name: 'monitor' } as unknown as AudioNode;
    const on = fakeCtx();
    webAudioOut(on.ctx, mapper, () => monitor).play(new Float32Array(10), 0, 0.5);
    expect(on.links.map(([from, to]) => `${from}>${(to as { name: string }).name}`)).toEqual(['source>gain', 'gain>destination', 'source>monitor']);
    const off = fakeCtx();
    webAudioOut(off.ctx, mapper, () => null).play(new Float32Array(10), 0, 0.5);
    expect(off.links.map(([from, to]) => `${from}>${(to as { name: string }).name}`)).toEqual(['source>gain', 'gain>destination']);
  });
});

describe('the Tx clock correction', () => {
  it('plays a sound meant for UTC T when a clock 1.2 s slow reads T − 1.2 s, and maps back', () => {
    const { ctx } = fakeCtx();
    const out = webAudioOut(ctx, { baseMs: 1_000_000 } as unknown as AudioClockMapper, undefined, () => 1.2);
    expect(out.toContextTime(1_010_000)).toBeCloseTo(8.8, 9);
    expect(out.toUtcMs(8.8)).toBeCloseTo(1_010_000, 6);
    // Off, or a clock 0.5 s fast.
    expect(webAudioOut(ctx, { baseMs: 1_000_000 } as unknown as AudioClockMapper).toContextTime(1_010_000)).toBeCloseTo(10, 9);
    expect(webAudioOut(ctx, { baseMs: 1_000_000 } as unknown as AudioClockMapper, undefined, () => -0.5).toContextTime(1_010_000)).toBeCloseTo(10.5, 9);
  });
});
