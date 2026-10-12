import { describe, expect, it } from 'vitest';
import { SLOT_MS, SLOT_SAMPLES, nextSlotStart, parity, slotIndex, slotProgress, slotStart } from './slots';

const T = Date.UTC(2026, 9, 13, 13, 14, 52, 250); // 13:14:52.250

describe('slot arithmetic', () => {
  it('has 15 s FT8 slots and 7.5 s FT4 slots of 180000 and 90000 samples', () => {
    expect(SLOT_MS).toEqual({ FT8: 15000, FT4: 7500 });
    expect(SLOT_SAMPLES).toEqual({ FT8: 180000, FT4: 90000 });
    expect(SLOT_SAMPLES.FT8).toBe((SLOT_MS.FT8 / 1000) * 12000);
    expect(SLOT_SAMPLES.FT4).toBe((SLOT_MS.FT4 / 1000) * 12000);
  });

  it('finds the FT8 slot start and the next one', () => {
    expect(slotStart(T, 'FT8')).toBe(Date.UTC(2026, 9, 13, 13, 14, 45));
    expect(nextSlotStart(T, 'FT8')).toBe(Date.UTC(2026, 9, 13, 13, 15, 0));
  });

  it('finds the FT4 slot start and the next one', () => {
    expect(slotStart(T, 'FT4')).toBe(Date.UTC(2026, 9, 13, 13, 14, 52, 500) - 7500);
    expect(nextSlotStart(T, 'FT4')).toBe(Date.UTC(2026, 9, 13, 13, 14, 52, 500));
  });

  it('treats a slot edge as the start of the new slot', () => {
    const edge = Date.UTC(2026, 9, 13, 13, 15, 0);
    expect(slotStart(edge, 'FT8')).toBe(edge);
    expect(slotStart(edge - 1, 'FT8')).toBe(edge - 15000);
    expect(nextSlotStart(edge, 'FT8')).toBe(edge + 15000);
  });

  it('labels FT8 slots at :00 and :30 even, :15 and :45 odd', () => {
    const at = (s: number) => Date.UTC(2026, 9, 13, 13, 14, s, 100);
    expect([0, 15, 30, 45].map((s) => parity(at(s), 'FT8'))).toEqual(['even', 'odd', 'even', 'odd']);
  });

  it('alternates FT4 parity every 7.5 s from the minute', () => {
    const m = Date.UTC(2026, 9, 13, 13, 14, 0);
    expect([0, 7500, 15000, 22500, 52500].map((d) => parity(m + d + 1, 'FT4'))).toEqual(['even', 'odd', 'even', 'odd', 'odd']);
  });

  it('measures progress through the slot', () => {
    expect(slotProgress(T, 'FT8')).toBeCloseTo(7.25 / 15, 12);
    expect(slotProgress(slotStart(T, 'FT8'), 'FT8')).toBe(0);
  });

  it('counts slots from the epoch', () => {
    expect(slotIndex(0, 'FT8')).toBe(0);
    expect(slotIndex(14999, 'FT8')).toBe(0);
    expect(slotIndex(15000, 'FT8')).toBe(1);
    expect(slotIndex(-1, 'FT8')).toBe(-1);
  });
});
