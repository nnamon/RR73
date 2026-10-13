import { describe, expect, it } from 'vitest';
import { FREQ_LIMITS, QuietTracker, clampHz, hzAtX, quietestHz, xOfHz, type SlotPower } from './pick';
import { columns } from './renderer';
import { BIN_HZ, DISPLAY_BINS, MAX_HZ } from './spectrum';

describe('frequency under a finger', () => {
  it('maps CSS pixels across 0 to 3000 Hz, in whole Hz', () => {
    expect(hzAtX(196.5, 393, 'FT8')).toBe(1500);
    expect(hzAtX(241.8, 393, 'FT8')).toBe(Math.round((241.8 / 393) * 3000));
    expect(Number.isInteger(hzAtX(100.3, 375, 'FT8'))).toBe(true);
    expect(xOfHz(1500)).toBe(0.5);
  });

  it('keeps the pick inside the mode limits', () => {
    expect(hzAtX(0, 393, 'FT8')).toBe(200);
    expect(hzAtX(393, 393, 'FT8')).toBe(2800);
    expect(hzAtX(390, 393, 'FT4')).toBe(FREQ_LIMITS.FT4.maxHz);
    expect(FREQ_LIMITS.FT4.maxHz + 83).toBeLessThanOrEqual(2850);
    expect(clampHz(1846.4, 'FT8')).toBe(1846);
    expect(hzAtX(10, 0, 'FT8')).toBe(1500);
  });

  // The canvas has width × device pixel ratio columns; the frequency picked under a finger must
  // fall in the column drawn under it, at any ratio.
  it.each([1, 2, 3])('picks the frequency of the column drawn under the finger at %i device pixels per point', (dpr) => {
    for (const cssWidth of [375, 393, 430, 392.5]) {
      const w = Math.round(cssWidth * dpr);
      const cols = columns(w);
      for (let x = 30; x < cssWidth - 30; x += 7.3) {
        // The canvas bitmap is stretched over the CSS box, so column c sits at c × cssWidth / w.
        const c = Math.min(w - 1, Math.floor((x / cssWidth) * w));
        const lo = (c * MAX_HZ) / w;
        const hi = ((c + 1) * MAX_HZ) / w;
        const hz = hzAtX(x, cssWidth, 'FT8');
        expect(hz, `${cssWidth} pt, x ${x}`).toBeGreaterThanOrEqual(Math.floor(lo) - 2);
        expect(hz, `${cssWidth} pt, x ${x}`).toBeLessThanOrEqual(Math.ceil(hi) + 2);
        // And the bins drawn in that column cover the picked frequency within one bin.
        const col = cols[c];
        expect(hz / BIN_HZ).toBeGreaterThanOrEqual(col.i0 - 1);
        expect(hz / BIN_HZ).toBeLessThanOrEqual(col.i1 + 2);
      }
    }
  });
});

const NOISE = 1e-6;

/**
 * A slot's power per bin: noise shaped by an SSB filter (300 to 2700 Hz flat, 20 dB down 300 Hz
 * outside) plus signals `level` times the noise, which are off in the pause.
 */
function slot(signals: number[], width = 50, level = 3, skirts = true): SlotPower {
  const mean = new Float64Array(DISPLAY_BINS);
  const pause = new Float64Array(DISPLAY_BINS);
  for (let k = 0; k < DISPLAY_BINS; k++) {
    const hz = k * BIN_HZ;
    const shape = !skirts ? 1 : hz < 300 ? 10 ** ((-20 * (300 - hz)) / 300 / 10) : hz > 2700 ? 10 ** ((-20 * (hz - 2700)) / 300 / 10) : 1;
    // Noise in the pause comes from fewer rows, so it is rougher.
    pause[k] = NOISE * shape * (1 + 0.15 * Math.sin(k * 2.3));
    mean[k] = NOISE * shape * (1 + 0.03 * Math.sin(k * 1.7));
    for (const f of signals) if (hz >= f && hz <= f + width) mean[k] += NOISE * shape * level;
  }
  return { mean, pause };
}

describe('clear Tx frequency', () => {
  it('needs 2 slots and a pause', () => {
    expect(quietestHz([slot([])], 'FT8', 1500)).toBeNull();
    expect(quietestHz([], 'FT8', 1500)).toBeNull();
    expect(quietestHz([{ ...slot([]), pause: null }, { ...slot([]), pause: null }], 'FT8', 1500)).toBeNull();
  });

  it('finds the one gap in a full band', () => {
    // Signals every 60 Hz from 200 to 2800 Hz except between 1000 and 1200 Hz: clear from 970 to 1220 Hz.
    const busy = [];
    for (let f = 200; f <= 2800; f += 60) if (f + 50 <= 1000 || f >= 1200) busy.push(f);
    for (const near of [300, 1500, 2600]) {
      const hz = quietestHz([slot(busy), slot(busy), slot(busy)], 'FT8', near);
      expect(hz).not.toBeNull();
      expect(hz!).toBeGreaterThanOrEqual(970);
      expect(hz! + 50).toBeLessThanOrEqual(1220 + BIN_HZ);
    }
  });

  it('stays on the current Tx frequency when it is clear', () => {
    for (const near of [1846, 1000, 2790]) {
      const hz = quietestHz([slot([]), slot([])], 'FT8', near)!;
      expect(Math.abs(hz - near)).toBeLessThanOrEqual(6);
    }
  });

  it('moves off a busy Tx frequency to the nearest clear one, not to the quiet filter skirts', () => {
    const busy = [1480, 1530, 1580];
    const hz = quietestHz([slot(busy), slot(busy)], 'FT8', 1500)!;
    expect(hz < 1480 - 50 + BIN_HZ || hz > 1630 - BIN_HZ).toBe(true);
    expect(Math.abs(hz - 1500)).toBeLessThan(100);
  });

  it('counts a signal in only some of the slots', () => {
    const hz = quietestHz([slot([1500]), slot([]), slot([1500]), slot([])], 'FT8', 1510)!;
    expect(hz < 1450 + BIN_HZ || hz > 1550 - BIN_HZ).toBe(true);
  });

  it('keeps FT4 signals, 83 Hz wide, inside the FT4 limits', () => {
    const flat = slot([], 83, 3, false);
    const hz = quietestHz([flat, flat], 'FT4', 2840)!;
    expect(hz).toBeLessThanOrEqual(FREQ_LIMITS.FT4.maxHz);
    expect(hz).toBeGreaterThan(FREQ_LIMITS.FT4.maxHz - 6);
  });
});

describe('quiet tracker', () => {
  const row = (db: number) => new Float32Array(DISPLAY_BINS).fill(db);

  it('keeps the mean power of up to 4 whole slots, and of their pauses', () => {
    const t = new QuietTracker('FT8');
    // 6 slots of rows every 100 ms, each slot 10 dB louder than the last; the pause 20 dB lower.
    for (let s = 0; s < 6; s++) {
      for (let ms = 50; ms < 15000; ms += 100) t.add(row(-100 + 10 * s - (ms >= 14200 ? 20 : 0)), s * 15000 + ms);
    }
    // The sixth slot is still open.
    const kept = t.slots(6 * 15000 - 100);
    expect(kept).toHaveLength(4);
    expect(10 * Math.log10(kept[0].pause![100])).toBeCloseTo(-110, 5);
    expect(10 * Math.log10(kept[3].pause![100])).toBeCloseTo(-80, 5);
    // 142 rows at −60 dB and 8 at −80 dB.
    expect(kept[3].mean[100]).toBeCloseTo((142 * 1e-6 + 8 * 1e-8) / 150, 12);
  });

  it('skips a slot heard for less than half, forgets slots after a gap and goes stale', () => {
    const t = new QuietTracker('FT8');
    for (let ms = 10000; ms < 15000; ms += 500) t.add(row(-90), ms);
    for (let ms = 15000; ms < 30000; ms += 500) t.add(row(-90), ms);
    t.add(row(-90), 30100);
    expect(t.slots(30200)).toHaveLength(1);
    // A gap of a whole slot: what came before is gone.
    t.add(row(-90), 60100);
    expect(t.slots(60200)).toHaveLength(0);
    for (let ms = 60100; ms < 75000; ms += 500) t.add(row(-90), ms);
    t.add(row(-90), 75100);
    expect(t.slots(75200)).toHaveLength(1);
    // Audio stopped: 2 slots later nothing counts.
    expect(t.slots(75000 + 31000)).toHaveLength(0);
  });

  it('starts again on a mode change, with the FT4 pause', () => {
    const t = new QuietTracker('FT8');
    for (let ms = 0; ms < 15000; ms += 500) t.add(row(-90), ms);
    t.add(row(-90), 15100);
    expect(t.slots(15200)).toHaveLength(1);
    t.setMode('FT4');
    expect(t.slots(15200)).toHaveLength(0);
    for (let ms = 15050; ms < 22500; ms += 100) t.add(row(ms % 7500 >= 6300 && ms % 7500 < 7400 ? -100 : -90), ms);
    t.add(row(-90), 22550);
    const [s] = t.slots(22600);
    expect(10 * Math.log10(s.pause![50])).toBeCloseTo(-100, 5);
  });
});
