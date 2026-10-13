import { describe, expect, it } from 'vitest';
import { isSpot, kvSpotCache, reviveCache } from './cache';
import { parseHamqthCsv } from './hamqth';
import { normalisePota } from './pota';
import { HAMQTH_0554, POTA_0536, recorded, recordedText, spot } from '../testing/spots';

describe('reviveCache', () => {
  it('keeps well-formed sources and spots', () => {
    const pota = normalisePota(recorded(POTA_0536))!.spots;
    const hamqth = parseHamqthCsv(recordedText(HAMQTH_0554)).spots;
    expect([...pota, ...hamqth].every(isSpot)).toBe(true);
    const value = { pota: { updatedAt: 5, spots: pota }, hamqth: { updatedAt: 6, spots: hamqth } };
    expect(reviveCache(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it('drops spots with a missing or mistyped field, or from another source', () => {
    const good = spot();
    const bad = [
      { ...good, activator: '' },
      { ...good, freqHz: '14074' },
      { ...good, digital: 'JS8' },
      { ...good, spottedAt: null },
      { ...good, qrt: 'no' },
      { ...good, refs: 'POTA VK-0921' },
      { ...good, refs: [{ programme: 'GMA', ref: 'X', name: '' }] },
      { ...good, refs: [{ programme: 'POTA', ref: '', name: '' }] },
      { ...good, country: null },
      { ...good, source: 'hamqth' },
      { ...good, source: 'dxwatch' },
      null,
      'spot',
    ];
    expect(reviveCache({ pota: { updatedAt: 1, spots: [good, ...bad] } }).pota?.spots).toEqual([good]);
  });

  it('drops sources without a time or a list, unknown sources, and anything not an object', () => {
    expect(reviveCache({ pota: { spots: [] } })).toEqual({});
    expect(reviveCache({ pota: { updatedAt: 1, spots: {} } })).toEqual({});
    expect(reviveCache({ POTA: { updatedAt: 1, spots: [] } })).toEqual({});
    expect(reviveCache(null)).toEqual({});
    expect(reviveCache('spots')).toEqual({});
    expect(reviveCache(undefined)).toEqual({});
  });
});

describe('kvSpotCache', () => {
  it('stores lists in IndexedDB and reads them back', async () => {
    const value = { pota: { updatedAt: 42, spots: [spot()] } };
    await kvSpotCache.save(value);
    expect(reviveCache(await kvSpotCache.load())).toEqual(value);
  });
});
