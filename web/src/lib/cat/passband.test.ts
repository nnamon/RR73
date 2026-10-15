import { describe, expect, it } from 'vitest';
import { FREQ_LIMITS } from '../waterfall/pick';
import { TX_SHIFT_STEP_HZ, TX_WINDOW_HIGH_HZ, TX_WINDOW_LOW_HZ, txDialShiftHz } from './passband';

describe('txDialShiftHz', () => {
  it('leaves audio inside the window alone', () => {
    for (const hz of [1500, 1501, 1750, 1999, 1999.5]) expect(txDialShiftHz(hz), String(hz)).toBe(0);
  });

  it('moves audio outside the window into it by whole 500 Hz steps', () => {
    expect(txDialShiftHz(2800)).toBe(1000);
    expect(txDialShiftHz(2000)).toBe(500);
    expect(txDialShiftHz(2499)).toBe(500);
    expect(txDialShiftHz(1499)).toBe(-500);
    expect(txDialShiftHz(1000)).toBe(-500);
    expect(txDialShiftHz(999)).toBe(-1000);
    expect(txDialShiftHz(200)).toBe(-1500);
  });

  it('puts every FT8 and FT4 Tx frequency in the window, with dial + audio unchanged', () => {
    for (const mode of ['FT8', 'FT4'] as const) {
      const { minHz, maxHz } = FREQ_LIMITS[mode];
      for (let hz = minHz; hz <= maxHz; hz++) {
        const shift = txDialShiftHz(hz);
        const audio = hz - shift;
        expect(Number.isInteger(shift / TX_SHIFT_STEP_HZ), `${mode} ${hz}`).toBe(true);
        expect(audio >= TX_WINDOW_LOW_HZ && audio < TX_WINDOW_HIGH_HZ, `${mode} ${hz}`).toBe(true);
        // The RF frequency: dial + audio, for any dial.
        expect(14_074_000 + shift + audio, `${mode} ${hz}`).toBe(14_074_000 + hz);
      }
    }
  });
});
