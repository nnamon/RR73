import { describe, expect, it } from 'vitest';
import { ChannelSelector, channelName } from './channels';
import { tone } from '../testing/signal';

const RATE = 48000;
const BLOCK = 128;

function feed(sel: ChannelSelector, left: Float32Array, right: Float32Array): number[] {
  const used: number[] = [];
  for (let i = 0; i + BLOCK <= left.length; i += BLOCK) {
    const out = sel.select([left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK)]);
    used.push(out.buffer === left.buffer ? 0 : 1);
  }
  return used;
}

describe('channelName', () => {
  it('names channels for the report', () => {
    expect(channelName(0, 1)).toBe('mono');
    expect(channelName(0, 2)).toBe('left');
    expect(channelName(1, 2)).toBe('right');
    expect(channelName(2, 4)).toBe('channel 3');
  });
});

describe('ChannelSelector', () => {
  it('passes a mono input through', () => {
    const sel = new ChannelSelector(RATE);
    const x = new Float32Array(BLOCK);
    expect(sel.select([x])).toBe(x);
    expect(sel.index).toBe(0);
  });

  it('stays on the left channel when only the left carries signal', () => {
    const sel = new ChannelSelector(RATE);
    const used = feed(sel, tone(1000, RATE, 2, 0.1), new Float32Array(2 * RATE));
    expect(used.every((c) => c === 0)).toBe(true);
  });

  it('moves to the right channel when only the right carries signal, after 1 s', () => {
    const sel = new ChannelSelector(RATE);
    const used = feed(sel, new Float32Array(3 * RATE), tone(1000, RATE, 3, 0.1));
    const firstRight = used.indexOf(1);
    expect(firstRight).toBeGreaterThan(0);
    const seconds = (firstRight * BLOCK) / RATE;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThan(1.5);
    expect(used.slice(firstRight).every((c) => c === 1)).toBe(true);
    expect(sel.index).toBe(1);
  });

  it('does not switch for a level difference under 10 dB', () => {
    const sel = new ChannelSelector(RATE);
    const used = feed(sel, tone(1000, RATE, 3, 0.1), tone(1000, RATE, 3, 0.25));
    expect(used.every((c) => c === 0)).toBe(true);
  });

  it('ignores a 0.2 s burst 20 dB stronger on the other channel', () => {
    const sel = new ChannelSelector(RATE);
    const left = tone(700, RATE, 4, 0.05);
    const right = new Float32Array(4 * RATE);
    right.set(tone(1000, RATE, 0.2, 0.5), RATE);
    const used = feed(sel, left, right);
    expect(used.every((c) => c === 0)).toBe(true);
  });
});
