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
