import { describe, expect, it } from 'vitest';
import { isLost, LOST_WINDOW_MS, type LostMark } from './lost';

const T = Date.UTC(2026, 9, 14, 7, 0, 0);
const marks: LostMark[] = [{ call: 'VK2LAW', other: 'DV5CEL', slotStartMs: T }];

describe('isLost', () => {
  it('marks the lost station’s messages to the station it answered, from that slot for a minute', () => {
    expect(isLost('DV5CEL VK2LAW -05', T, marks)).toBe(true);
    expect(isLost('DV5CEL VK2LAW RR73', T + 30_000, marks)).toBe(true);
    expect(isLost('DV5CEL VK2LAW 73', T + LOST_WINDOW_MS, marks)).toBe(false);
    expect(isLost('DV5CEL VK2LAW -05', T - 15_000, marks)).toBe(false);
  });

  it('matches portable forms and leaves every other row alone', () => {
    expect(isLost('DV5CEL/P VK2LAW/P R-07', T, marks)).toBe(true);
    expect(isLost('9V1NE VK2LAW -05', T, marks)).toBe(false);
    expect(isLost('DV5CEL K1ABC -05', T, marks)).toBe(false);
    expect(isLost('CQ VK2LAW QF56', T, marks)).toBe(false);
    expect(isLost('DV5CEL VK2LAW -05', T, [])).toBe(false);
  });
});
