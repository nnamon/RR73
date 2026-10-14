import { describe, expect, it } from 'vitest';
import { driftHz, learnGrids, parseWsprDecodes, sortSpots, toSpots, type WsprDecode } from './spots';

const SLOT = Date.UTC(2026, 9, 14, 14, 8);
const d = (text: string, snr = -20, freq = 1500, drift = 0): WsprDecode => ({ text, freq_hz: freq, dt_s: 0.2, drift_hz_per_s: drift, snr_db: snr });
const ctx = (grids = new Map<string, string>()) => ({ myGrid: 'OJ11vi', myCall: '9V1NE', dialHz: 14_095_600, grids });

describe('spots', () => {
  it('gives each spot its distance and bearing from the station grid, in km', () => {
    const [jn48, re78, pk04] = toSpots([d('DK2DB JN48 37'), d('ZL2BRG RE78 23'), d('DU1IVT PK04 30')], SLOT, ctx());
    expect(jn48.km).toBeCloseTo(10247.4, 1);
    expect(jn48.bearingDeg).toBeCloseTo(318.6, 1);
    expect(re78.km).toBeCloseTo(8558.2, 1);
    expect(pk04.km).toBeCloseTo(2389.8, 1);
  });

  it('keeps the decode: on-air frequency from the dial, SNR, DT and drift over the transmission', () => {
    const [s] = toSpots([d('DK2DB JN48 37', -23.4, 1440.3, 0.01)], SLOT, ctx());
    expect(s).toMatchObject({ call: 'DK2DB', grid: 'JN48', powerDbm: 37, msgType: 1, snrDb: -23.4, dtS: 0.2, audioHz: 1440.3, freqHz: 14_097_040.3, slotStartMs: SLOT });
    expect(s.driftHz).toBeCloseTo(1.106, 3);
    expect(driftHz(-0.03)).toBeCloseTo(-3.318, 3);
  });

  it('has no distance without the station grid or the spot grid', () => {
    expect(toSpots([d('DK2DB JN48 37')], SLOT, { ...ctx(), myGrid: '' })[0].km).toBeNull();
    expect(toSpots([d('PJ4/K1ABC 33')], SLOT, ctx())[0].km).toBeNull();
  });

  it('gives a Type 2 spot the grid its station sent earlier', () => {
    const grids = new Map<string, string>();
    learnGrids(toSpots([d('<PJ4/K1ABC> FK52UD 33')], SLOT, ctx(grids)), grids);
    const [s] = toSpots([d('PJ4/K1ABC 33')], SLOT + 120_000, ctx(grids));
    expect(s).toMatchObject({ call: 'PJ4/K1ABC', grid: 'FK52ud', gridHeard: true, msgType: 2 });
    expect(s.km).toBeCloseTo(18277.9, 1);
  });

  it("marks spots of the station's own callsign, prefix or suffix aside", () => {
    const spots = toSpots([d('9V1NE OJ11 37'), d('9V1NE/P 37'), d('9V1NEX OJ11 37')], SLOT, ctx());
    expect(spots.map((s) => s.mine)).toEqual([true, true, false]);
  });

  it('reads the decoder output, dropping malformed entries', () => {
    const json = JSON.stringify([
      { text: 'K1ABC FN42 37', freq_hz: 1500.1, dt_s: 0.2, drift_hz_per_s: 0.001, snr_db: -20 },
      { text: 'K1ABC FN42 37', freq_hz: null, dt_s: 0.2, drift_hz_per_s: 0, snr_db: -20 },
      { text: '', freq_hz: 1500, dt_s: 0, drift_hz_per_s: 0, snr_db: 0 },
    ]);
    expect(parseWsprDecodes(json)).toHaveLength(1);
    expect(parseWsprDecodes('nope')).toEqual([]);
    expect(parseWsprDecodes('{}')).toEqual([]);
  });
});

describe('spot order', () => {
  const spots = toSpots(
    [d('DU1IVT PK04 30', -11), d('PJ4/K1ABC 33', -5), d('ZL2BRG RE78 23', -23), d('DK2DB JN48 37', -27), d('VK2ZT QF56 30', -18)],
    SLOT,
    ctx(),
  );
  const calls = (s: { call: string | null }[]) => s.map((x) => x.call);

  it('puts the farthest first by default, spots without a distance last', () => {
    expect(calls(sortSpots(spots, 'distance'))).toEqual(['DK2DB', 'ZL2BRG', 'VK2ZT', 'DU1IVT', 'PJ4/K1ABC']);
  });

  it('sorts by SNR, strongest first', () => {
    expect(calls(sortSpots(spots, 'snr'))).toEqual(['PJ4/K1ABC', 'DU1IVT', 'VK2ZT', 'ZL2BRG', 'DK2DB']);
  });

  it('sorts by callsign, A to Z', () => {
    expect(calls(sortSpots(spots, 'call'))).toEqual(['DK2DB', 'DU1IVT', 'PJ4/K1ABC', 'VK2ZT', 'ZL2BRG']);
  });

  it('keeps the decoder order for ties and leaves the input as it was', () => {
    const tie = toSpots([d('A1A FN42 37', -10), d('B1B FN42 37', -10)], SLOT, ctx());
    expect(calls(sortSpots(tie, 'snr'))).toEqual(['A1A', 'B1B']);
    expect(calls(spots)[0]).toBe('DU1IVT');
  });
});
