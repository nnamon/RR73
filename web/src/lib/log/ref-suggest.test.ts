import { describe, expect, it } from 'vitest';
import { kmText, nearbySuggestions, typedSuggestions, type RefLists } from './ref-suggest';
import { gridFromLatLon } from '../reference/grid';
import type { PotaRow, RefIndexJson, SotaShardJson } from '../reference/format';
import { parkList, summitList } from '../reference/refs';
import { HttpStore } from '../reference/store';
import { MemoryCaches, ORIGIN, fakeOrigin } from '../reference/testing';

const PARKS: Record<string, PotaRow[]> = {
  SG: [
    ['0001', 'Admiralty National Park', 1.4484, 103.779, 1],
    ['0002', 'Ang Mo Kio Town Garden East National Park', 1.3707, 103.85, 1],
    ['0099', 'Closed Test Park', 1.351, 103.82, 0],
  ],
};
const SUMMIT: SotaShardJson = {
  format: 1,
  programme: 'SOTA',
  key: '9V',
  association: 'Singapore',
  regions: { SG: 'Singapore' },
  rows: [['SG-001', 'Bukit Timah Test Hill', 1.354, 103.776, 164, 1, 20100101, 0]],
};

function lists(files: Record<string, unknown> = {}, offline = false): RefLists {
  const parks: Record<string, unknown> = {};
  const index: RefIndexJson = { format: 1, programme: 'POTA', separator: '-', count: 3, shards: [] };
  for (const [key, rows] of Object.entries(PARKS)) {
    const squares = [...new Set(rows.map((r) => gridFromLatLon(r[2]!, r[3]!, 4)))].join('');
    index.shards.push({ key, file: `${key}.v1.json`, count: rows.length, bytes: 300, squares });
    parks[`pota/${key}.v1.json`] = { format: 1, programme: 'POTA', key, rows };
  }
  const sotaIndex: RefIndexJson = { format: 1, programme: 'SOTA', separator: '/', count: 1, shards: [{ key: '9V', file: '9V.v1.json', count: 1, bytes: 100, squares: 'OJ11', name: 'Singapore' }] };
  const origin = fakeOrigin({ 'pota/index.v1.json': index, ...parks, 'sota/index.v1.json': sotaIndex, 'sota/9V.v1.json': SUMMIT, ...files });
  origin.state.offline = offline;
  const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: new MemoryCaches().asStorage() });
  return {
    parks: parkList(store, () => Promise.resolve('pota/index.v1.json')),
    summits: summitList(store, () => Promise.resolve('sota/index.v1.json'), () => new Date('2026-10-15T00:00:00Z')),
  };
}

const HOME = { lat: 1.352, lon: 103.8198 };

describe('reference suggestions', () => {
  it('suggest the references that begin with the text typed, for POTA and SOTA only', async () => {
    const l = lists();
    expect((await typedSuggestions('POTA', 'sg-000', l)).map((s) => [s.ref, s.name, s.km])).toEqual([
      ['SG-0001', 'Admiralty National Park', null],
      ['SG-0002', 'Ang Mo Kio Town Garden East National Park', null],
    ]);
    expect((await typedSuggestions('SOTA', '9v/', l)).map((s) => s.ref)).toEqual(['9V/SG-001']);
    expect(await typedSuggestions('WWFF', 'KFF-', l)).toEqual([]);
    expect(await typedSuggestions('POTA', '', l)).toEqual([]);
    expect(await typedSuggestions('POTA', 'SG-', { parks: null, summits: null })).toEqual([]);
  });

  it('list the active parks and summits near the phone, nearest first, with distances', async () => {
    const { refs, complete } = await nearbySuggestions(HOME, lists());
    expect(complete).toBe(true);
    // The closed park is left out; Ang Mo Kio is 3.9 km away, the hill 4.9 km.
    expect(refs.map((s) => s.ref)).toEqual(['SG-0002', '9V/SG-001', 'SG-0001']);
    expect(refs.map((s) => Math.round((s.km ?? 0) * 10) / 10)).toEqual([3.9, 4.9, 11.6]);
  });

  it('give none, and say so, when the lists cannot be read', async () => {
    const l = lists({}, true);
    expect(await typedSuggestions('POTA', 'SG-', l)).toEqual([]);
    expect(await nearbySuggestions(HOME, l)).toEqual({ refs: [], complete: false });
  });

  it('show distances to 0.1 km up close and in whole km farther out', () => {
    expect([kmText(0.42), kmText(9.96), kmText(12.4), kmText(48.6)]).toEqual(['0.4 km', '10.0 km', '12 km', '49 km']);
  });
});
