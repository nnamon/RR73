import { describe, expect, it } from 'vitest';
import { defaultFilter, filterSpots, newestFirst, spotKey, type FilterContext, type SpotFilter } from './filter';
import { parseHamqthCsv } from './hamqth';
import { normalisePota } from './pota';
import { dxSpot, HAMQTH_0554, NOW, POTA_0532, recorded, recordedText, spot } from '../testing/spots';

const ALL: FilterContext = { myBands: [], isNew: null };
const f = (over: Partial<SpotFilter> = {}): SpotFilter => ({ ...defaultFilter(), ...over });
const calls = (xs: { activator: string }[]) => xs.map((x) => x.activator);

describe('filterSpots', () => {
  const ft8 = spot({ activator: 'K1ABC', spottedAt: NOW - 60_000 });
  const ft4 = spot({ activator: 'K2ABC', digital: 'FT4', mode: 'FT4', freqHz: 7_047_500, band: '40m', spottedAt: NOW - 120_000 });
  const cw = spot({ activator: 'K3ABC', digital: null, mode: 'CW', freqHz: 7_030_000, band: '40m', spottedAt: NOW - 30_000 });
  const sota = dxSpot({ activator: 'K4ABC', refs: [{ programme: 'SOTA', ref: 'W7W/LC-001', name: '' }], spottedAt: NOW - 90_000 });
  const noBand = spot({ activator: 'K5ABC', freqHz: null, band: null, digital: 'FT8', spottedAt: NOW - 10_000 });
  const dx = dxSpot({ activator: 'K6ABC', spottedAt: NOW - 5_000 });
  const spots = [ft8, ft4, cw, sota, noBand, dx];

  it('shows FT8 and FT4 programme spots by default, newest first', () => {
    expect(defaultFilter()).toEqual({ classes: ['POTA', 'SOTA', 'WWFF', 'IOTA'], digitalOnly: true, myBandsOnly: false, newOnly: false });
    expect(calls(filterSpots(spots, f(), ALL))).toEqual(['K5ABC', 'K1ABC', 'K4ABC', 'K2ABC']);
  });

  it('adds DX spots with DX on, and shows every mode with the digital filter off', () => {
    expect(calls(filterSpots(spots, f({ classes: ['POTA', 'SOTA', 'WWFF', 'IOTA', 'DX'] }), ALL))).toEqual(['K6ABC', 'K5ABC', 'K1ABC', 'K4ABC', 'K2ABC']);
    expect(calls(filterSpots(spots, f({ digitalOnly: false }), ALL))).toEqual(['K5ABC', 'K3ABC', 'K1ABC', 'K4ABC', 'K2ABC']);
  });

  it('filters by class; a spot with several programmes shows under each', () => {
    expect(calls(filterSpots(spots, f({ classes: ['SOTA'] }), ALL))).toEqual(['K4ABC']);
    expect(calls(filterSpots(spots, f({ classes: ['DX'] }), ALL))).toEqual(['K6ABC']);
    expect(filterSpots(spots, f({ classes: [] }), ALL)).toEqual([]);
    const both = spot({ refs: [{ programme: 'POTA', ref: 'NZ-0008', name: '' }, { programme: 'IOTA', ref: 'OC-134', name: '' }] });
    expect(filterSpots([both], f({ classes: ['IOTA'] }), ALL)).toHaveLength(1);
    expect(filterSpots([both], f({ classes: ['POTA'] }), ALL)).toHaveLength(1);
    expect(filterSpots([both], f({ classes: ['SOTA', 'DX'] }), ALL)).toHaveLength(0);
  });

  it('keeps the operator bands, in any case, and drops spots without a band', () => {
    const ctx = { myBands: ['40M'], isNew: null };
    expect(calls(filterSpots(spots, f({ myBandsOnly: true, digitalOnly: false }), ctx))).toEqual(['K3ABC', 'K2ABC']);
  });

  it('ignores My bands while the operator has no bands', () => {
    expect(filterSpots(spots, f({ myBandsOnly: true }), ALL)).toHaveLength(4);
  });

  it('asks the log hook for New only, and ignores New only without one', () => {
    const isNew = (s: { activator: string }) => s.activator === 'K2ABC';
    expect(calls(filterSpots(spots, f({ newOnly: true }), { myBands: [], isNew }))).toEqual(['K2ABC']);
    expect(filterSpots(spots, f({ newOnly: true }), ALL)).toHaveLength(4);
    expect(filterSpots(spots, f({ newOnly: false }), { myBands: [], isNew })).toHaveLength(4);
  });

  it('keeps one row per station and band: the newest spot that passes the filter', () => {
    const older = spot({ id: 'pota:1', activator: 'W7QRP/P', spottedAt: NOW - 20 * 60_000 });
    const newerCw = spot({ id: 'pota:2', activator: 'W7QRP', mode: 'CW', digital: null, spottedAt: NOW - 60_000 });
    expect(filterSpots([older, newerCw], f(), ALL).map((s) => s.id)).toEqual(['pota:1']);
    expect(filterSpots([older, newerCw], f({ digitalOnly: false }), ALL).map((s) => s.id)).toEqual(['pota:2']);
    const otherBand = spot({ id: 'pota:3', activator: 'W7QRP/P', freqHz: 7_074_000, band: '40m' });
    expect(filterSpots([older, otherBand], f(), ALL)).toHaveLength(2);
  });

  it('works on the recorded POTA response: 6 FT8 activations, newest first', () => {
    const r = normalisePota(recorded(POTA_0532))!;
    expect(calls(filterSpots(r.spots, f(), ALL))).toEqual(['JG1RBB/P', '7L1DST/P', 'KC5JEC', 'JE1QEV', '9W2EZV', 'JH2KAG/P']);
    expect(filterSpots(r.spots, f({ myBandsOnly: true }), { myBands: ['20m', '17m'], isNew: null }).map((s) => s.band)).toEqual(['20m', '17m']);
  });

  it('works on the recorded cluster lines: 1 FT8 programme spot, 8 with DX', () => {
    const r = parseHamqthCsv(recordedText(HAMQTH_0554));
    expect(calls(filterSpots(r.spots, f(), ALL))).toEqual(['3D2USU']);
    expect(filterSpots(r.spots, f({ classes: ['POTA', 'SOTA', 'WWFF', 'IOTA', 'DX'] }), ALL)).toHaveLength(8);
    expect(calls(filterSpots(r.spots, f({ digitalOnly: false }), ALL))).toEqual(['PD4US/P', 'ZL1KS', '3D2USU']);
  });

  it('does not change its input', () => {
    const input = [ft4, ft8];
    filterSpots(input, f(), ALL);
    expect(input).toEqual([ft4, ft8]);
  });
});

describe('order and keys', () => {
  it('sorts equal times by callsign', () => {
    expect(calls([spot({ activator: 'B1B' }), spot({ activator: 'A1A' })].sort(newestFirst))).toEqual(['A1A', 'B1B']);
  });

  it('keys a row by station and band', () => {
    expect(spotKey(spot({ activator: 'W7QRP/P' }))).toBe('W7QRP 20m');
    expect(spotKey(spot({ activator: 'W7QRP', freqHz: null, band: null }))).toBe('W7QRP ');
  });
});
