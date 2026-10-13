import { describe, expect, it } from 'vitest';
import { parseHamqthCsv } from './hamqth';
import { MERGE_WINDOW_MS, mergeSpots } from './merge';
import { normalisePota } from './pota';
import { dxSpot, NOW, PAIR_HAMQTH_0556, PAIR_POTA_0556, recorded, recordedText, spot } from '../testing/spots';

const MIN = 60_000;
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 13, h, m, s);

describe('mergeSpots on both feeds fetched at 05:56 UTC', () => {
  const pota = normalisePota(recorded(PAIR_POTA_0556))!.spots;
  const cluster = parseHamqthCsv(recordedText(PAIR_HAMQTH_0556)).spots;
  const merged = mergeSpots([pota, cluster]);
  const of = (call: string) => merged.filter((s) => s.activator === call);

  it('starts from 5 POTA spots and 9 cluster spots', () => {
    expect(pota).toHaveLength(5);
    expect(cluster).toHaveLength(9);
  });

  it('keeps the POTA spot of PD4US/P and drops its cluster spot 6 min later', () => {
    expect(of('PD4US/P')).toHaveLength(1);
    expect(of('PD4US/P')[0]).toMatchObject({ source: 'pota', spottedAt: at(5, 47, 37), refs: [{ programme: 'POTA', ref: 'NL-0110', name: 'Zoommeer - Molenplaat Provincial Park' }] });
  });

  it('folds ZL1KS cluster spots within 10 min into the POTA spot, gaining the IOTA reference', () => {
    const z = of('ZL1KS');
    expect(z.map((s) => [s.source, new Date(s.spottedAt).toISOString().slice(11, 16)])).toEqual([
      ['pota', '05:55'],
      ['hamqth', '05:45'],
      ['hamqth', '05:34'],
    ]);
    expect(z[0].refs).toEqual([
      { programme: 'POTA', ref: 'NZ-0008', name: 'Long Bay Regional Park' },
      { programme: 'IOTA', ref: 'OC-134', name: '' },
    ]);
  });

  it('keeps stations only one feed has', () => {
    expect(of('KC5JEC')).toHaveLength(1);
    expect(of('DL9DBJ')).toHaveLength(1);
    expect(merged).toHaveLength(5 + 9 - 1 - 2);
  });

  it('sorts newest first and leaves its inputs alone', () => {
    const times = merged.map((s) => s.spottedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(pota.find((s) => s.activator === 'ZL1KS')?.refs).toHaveLength(1);
  });
});

describe('mergeSpots rules', () => {
  it('prefers the earlier list even when the later spot is newer', () => {
    const p = spot({ activator: 'K1ABC', spottedAt: NOW - 8 * MIN });
    const c = dxSpot({ activator: 'K1ABC', spottedAt: NOW, refs: [{ programme: 'WWFF', ref: 'KFF-0001', name: '' }] });
    const [m, ...rest] = mergeSpots([[p], [c]]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ source: 'pota', spottedAt: NOW - 8 * MIN });
    expect(m.refs.map((r) => r.ref)).toEqual(['VK-0921', 'KFF-0001']);
  });

  it('merges within 10 min, either side, and not beyond', () => {
    const p = spot({ activator: 'K1ABC', spottedAt: NOW });
    expect(mergeSpots([[p], [dxSpot({ activator: 'K1ABC', spottedAt: NOW - MERGE_WINDOW_MS })]])).toHaveLength(1);
    expect(mergeSpots([[p], [dxSpot({ activator: 'K1ABC', spottedAt: NOW + MERGE_WINDOW_MS })]])).toHaveLength(1);
    expect(mergeSpots([[p], [dxSpot({ activator: 'K1ABC', spottedAt: NOW - MERGE_WINDOW_MS - 1 })]])).toHaveLength(2);
  });

  it('merges a station across portable suffixes, but not across bands or without a band', () => {
    const p = spot({ activator: 'K1ABC/P' });
    expect(mergeSpots([[p], [dxSpot({ activator: 'K1ABC' })]])).toHaveLength(1);
    expect(mergeSpots([[p], [dxSpot({ activator: 'K1ABC', freqHz: 7_074_000, band: '40m' })]])).toHaveLength(2);
    const noBand = spot({ activator: 'K2ABC', freqHz: null, band: null });
    expect(mergeSpots([[noBand], [dxSpot({ activator: 'K2ABC', freqHz: null, band: null })]])).toHaveLength(2);
  });

  it('merges cluster spots of one station into the newest, collecting references', () => {
    const a = dxSpot({ activator: 'ZL1KS', spottedAt: NOW, comments: 'tnx QSO' });
    const b = dxSpot({ activator: 'ZL1KS', spottedAt: NOW - 3 * MIN, refs: [{ programme: 'POTA', ref: 'NZ-0008', name: '' }] });
    const [m, ...rest] = mergeSpots([[], [b, a]]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ spottedAt: NOW, comments: 'tnx QSO', refs: [{ programme: 'POTA', ref: 'NZ-0008' }] });
  });

  it('fills a missing name from a merged spot', () => {
    const c = dxSpot({ activator: 'K1ABC', refs: [{ programme: 'POTA', ref: 'VK-0921', name: '' }] });
    const p = spot({ activator: 'K1ABC' });
    expect(mergeSpots([[c], [p]])[0].refs).toEqual([{ programme: 'POTA', ref: 'VK-0921', name: 'Example park' }]);
  });
});
