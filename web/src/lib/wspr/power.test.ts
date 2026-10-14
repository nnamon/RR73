import { describe, expect, it } from 'vitest';
import { POWERS_DBM, isPowerDbm, powerText, wattsText } from './power';

describe('WSPR power', () => {
  it('offers the 19 values from 0 to 60 dBm ending in 0, 3 or 7', () => {
    expect(POWERS_DBM).toEqual([0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60]);
    expect(isPowerDbm(37)).toBe(true);
    expect(isPowerDbm(31)).toBe(false);
  });

  it('shows each value in watts', () => {
    expect(POWERS_DBM.map(wattsText)).toEqual([
      '1 mW', '2 mW', '5 mW', '10 mW', '20 mW', '50 mW', '100 mW', '200 mW', '500 mW',
      '1 W', '2 W', '5 W', '10 W', '20 W', '50 W', '100 W', '200 W', '500 W', '1 kW',
    ]);
    expect(powerText(37)).toBe('37 dBm · 5 W');
  });
});
