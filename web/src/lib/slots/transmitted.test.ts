import { describe, expect, it } from 'vitest';
import { TransmittedSlots } from './transmitted';

const T = Date.UTC(2026, 9, 13, 9, 50, 0);

describe('TransmittedSlots', () => {
  it('marks the slot a transmission starts in', () => {
    const t = new TransmittedSlots();
    t.mark(T + 15_500, T + 15_500 + 12_640, 'FT8');
    expect(t.has(T + 15_000)).toBe(true);
    expect(t.has(T)).toBe(false);
    expect(t.has(T + 30_000)).toBe(false);
  });

  it('marks every slot that 10 s of Tune overlaps', () => {
    const t = new TransmittedSlots();
    t.mark(T + 10_000, T + 20_000, 'FT8');
    expect(t.list()).toEqual([T, T + 15_000]);
  });

  it('uses the FT4 slot length', () => {
    const t = new TransmittedSlots();
    t.mark(T + 8_000, T + 13_000, 'FT4');
    expect(t.list()).toEqual([T + 7_500]);
  });

  it('keeps the last 16 slots', () => {
    const t = new TransmittedSlots();
    for (let i = 0; i < 20; i++) t.mark(T + i * 30_000 + 500, T + i * 30_000 + 13_000, 'FT8');
    expect(t.list()).toHaveLength(16);
    expect(t.has(T)).toBe(false);
    expect(t.has(T + 19 * 30_000)).toBe(true);
  });
});
