import { describe, expect, it } from 'vitest';
import { SlotRunner, type SlotFeed } from './source';

/** An audio context that records the slot buffers started and stopped. */
function fakeContext() {
  const sources: { started: boolean; stopped: boolean }[] = [];
  const ctx = {
    state: 'running',
    currentTime: 100,
    createBuffer: (_ch: number, length: number) => ({ length, copyToChannel: () => undefined }),
    createBufferSource() {
      const s = {
        buffer: null as unknown,
        started: false,
        stopped: false,
        onended: null as (() => void) | null,
        connect: () => undefined,
        disconnect: () => undefined,
        start() {
          s.started = true;
        },
        stop() {
          s.stopped = true;
        },
      };
      sources.push(s);
      return s;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('SlotRunner', () => {
  it('stops the slot under way when the band leaves the slot modes, and renders none until it is back', async () => {
    const { ctx, sources } = fakeContext();
    let active = true;
    const T = Date.UTC(2026, 9, 14, 13, 14, 3);
    const feed: SlotFeed = {
      active: () => active,
      mode: () => 'FT8',
      signals: () => [{ message: 'CQ JA1KXM PM95', freqHz: 1500, dtS: 0, snrDb: 0, fading: null, driftHzPerS: 0 } as never],
      synth: async () => new Float32Array(12_000),
    };
    const runner = new SlotRunner(ctx, {} as AudioNode, feed, () => T);
    runner.start();
    await settle();
    expect(sources.map((s) => [s.started, s.stopped])).toEqual([[true, false]]);
    // RTTY: the FT8 slot under way stops at the next tick, and no slot renders.
    active = false;
    runner.tick();
    await settle();
    expect(sources.map((s) => [s.started, s.stopped])).toEqual([[true, true]]);
    runner.tick();
    await settle();
    expect(sources).toHaveLength(1);
    // Back in FT8: the slot under way renders again.
    active = true;
    runner.tick();
    await settle();
    expect(sources).toHaveLength(2);
    runner.stop();
  });

  it('drops a slot that finishes rendering after the band left the slot modes', async () => {
    const { ctx, sources } = fakeContext();
    let active = true;
    let release: () => void = () => undefined;
    const feed: SlotFeed = {
      active: () => active,
      mode: () => 'FT8',
      signals: () => [{ message: 'CQ JA1KXM PM95', freqHz: 1500, dtS: 0, snrDb: 0, fading: null, driftHzPerS: 0 } as never],
      synth: () => new Promise((r) => (release = () => r(new Float32Array(12_000)))),
    };
    const runner = new SlotRunner(ctx, {} as AudioNode, feed, () => Date.UTC(2026, 9, 14, 13, 14, 3));
    runner.start();
    active = false;
    release();
    await settle();
    expect(sources).toEqual([]);
    runner.stop();
  });
});
