import { describe, expect, it } from 'vitest';
import { buildList, filterCounts, type Classify, type SlotDecodes } from '../decode/list';
import { defaultHighlights, highlightDecode, type HighlightEntry } from '../decode/highlight';
import { DxccIndex } from '../reference/dxcc';
import { bigCtyFixture } from '../reference/testing';
import { addRows, keySets } from './wavelog-worked';
import { bandModesOf, buildKeysIndex, buildLogIndex, IndexBuilder, mergeLogIndex, workedBeforeText, workedCallKey, workedGridKey, type IndexedQso, type LogIndex, type WorkedKeys } from './worked';

const qso = (call: string, gridsquare: string, band: string, mode = 'FT8', submode = ''): IndexedQso => ({ call, gridsquare, band, mode, submode });

/** Keys from Wavelog's JSON rows, as the read builds them. */
function keysOf(rows: Record<string, string>[]): WorkedKeys {
  const k = keySets();
  addRows(rows, k);
  return k;
}

const ME = '9V1NE';
const AT = { band: '20m', mode: 'FT8' };
/** The phone's log: JA7XVZ on 40m FT8. */
const OWN = buildLogIndex([qso('JA7XVZ', 'QM09', '40m')]);
/** Wavelog's log: JA1KXM on 20m FT8 in PM95, ZL1TQK portable on 20m FT8, 4I1LCT on 20m FT4. */
const WAVELOG = keysOf([
  { CALL: 'JA1KXM', BAND: '20m', MODE: 'FT8', SUBMODE: '', GRIDSQUARE: 'PM95ab' },
  { CALL: 'ZL1TQK/P', BAND: '20M', MODE: 'FT8', SUBMODE: '', GRIDSQUARE: '' },
  { CALL: '4I1LCT', BAND: '20m', MODE: 'MFSK', SUBMODE: 'FT4', GRIDSQUARE: 'PK04' },
]);
const BOTH = mergeLogIndex(OWN, buildKeysIndex(WAVELOG));

const colours = (text: string, index: LogIndex, at = AT, entries: HighlightEntry[] = defaultHighlights()) => highlightDecode({ text }, ME, index, at, entries);

describe('worked keys', () => {
  it('keep the call whole and upper case, the band lower case, and the submode before the mode', () => {
    expect(workedCallKey(' vk3/9v1ne/p ', '20M', 'MFSK', 'FT4')).toBe('VK3/9V1NE/P 20m FT4');
    expect(workedCallKey('K1ABC', '40m', 'FT8', '')).toBe('K1ABC 40m FT8');
    expect(workedCallKey('', '40m', 'FT8', '')).toBe('');
    expect(workedGridKey('pm95ab', '20M')).toBe('PM95 20m');
    expect(workedGridKey('', '20m')).toBe('');
    expect(workedGridKey('XX', '20m')).toBe('');
  });

  it('are built from Wavelog rows, skipping what is not a QSO', () => {
    const k = keySets();
    addRows([{ CALL: 'JA1KXM', BAND: '20m', MODE: 'FT8', GRIDSQUARE: 'PM95' }, { call: 'k1abc/p', band: '40m', mode: 'ft8' }, null, 7, 'text', { BAND: '20m' }], k);
    expect([...k.calls].sort()).toEqual(['JA1KXM 20m FT8', 'K1ABC/P 40m FT8']);
    expect([...k.grids]).toEqual(['PM95 20m']);
    // The stations: by base callsign.
    expect([...k.bases].sort()).toEqual(['JA1KXM', 'K1ABC']);
  });

  it('index by the log’s rules: the base callsign, FT4 from its submode, grids by square', () => {
    const w = buildKeysIndex(WAVELOG);
    expect([...w.calls].sort()).toEqual(['4I1LCT', 'JA1KXM', 'ZL1TQK']);
    expect([...(w.callsByBandMode.get('20m FT4') ?? [])]).toEqual(['4I1LCT']);
    expect([...(w.callsByBandMode.get('20m FT8') ?? [])].sort()).toEqual(['JA1KXM', 'ZL1TQK']);
    expect([...w.grids].sort()).toEqual(['PK04', 'PM95']);
    // The same QSOs in the log give the same index.
    const asLog = buildLogIndex([qso('JA1KXM', 'PM95ab', '20m'), qso('ZL1TQK/P', '', '20M'), qso('4I1LCT', 'PK04', '20m', 'MFSK', 'FT4')]);
    for (const k of ['calls', 'grids'] as const) expect([...w[k]].sort()).toEqual([...asLog[k]].sort());
    for (const k of ['callsByBand', 'gridsByBand', 'callsByBandMode'] as const) {
      expect([...w[k].keys()].sort()).toEqual([...asLog[k].keys()].sort());
      for (const [band, set] of asLog[k]) expect([...(w[k].get(band) ?? [])].sort()).toEqual([...set].sort());
    }
  });

  it('list the bands and modes a station has, lowest band first', () => {
    const k = keysOf([
      { CALL: 'JA1KXM', BAND: '20m', MODE: 'FT8' },
      { CALL: 'JA1KXM/P', BAND: '40m', MODE: 'MFSK', SUBMODE: 'FT4' },
      { CALL: 'JA1KXM', BAND: '160m', MODE: 'FT8' },
    ]);
    expect(bandModesOf(buildKeysIndex(k), 'ja1kxm')).toEqual(['160m FT8', '40m FT4', '20m FT8']);
    expect(bandModesOf(buildKeysIndex(k), 'K1ABC')).toEqual([]);
  });

  it('grow an index in place to the one built from all of them at once', () => {
    const cty = DxccIndex.fromJson(JSON.parse(JSON.stringify(bigCtyFixture())));
    const all = keysOf([
      { CALL: 'JA1KXM', BAND: '20m', MODE: 'FT8', GRIDSQUARE: 'PM95' },
      { CALL: 'VK3/9V1NE', BAND: '40m', MODE: 'MFSK', SUBMODE: 'FT4', GRIDSQUARE: 'QF22' },
      { CALL: 'K1ABC', BAND: '6m', MODE: 'FT8', GRIDSQUARE: 'FN42' },
    ]);
    const b = new IndexBuilder(cty);
    const [first, ...rest] = [...all.calls];
    b.addCallKey(first);
    const live = b.index;
    for (const k of rest) b.addCallKey(k);
    for (const k of all.grids) b.addGridKey(k);
    const once = buildKeysIndex(all, cty);
    expect(b.index).toBe(live);
    const sorted = (s: Iterable<string> | undefined) => [...(s ?? [])].sort();
    expect(sorted(live.calls)).toEqual(sorted(once.calls));
    expect(sorted(live.grids)).toEqual(sorted(once.grids));
    for (const k of ['callsByBand', 'gridsByBand', 'callsByBandMode'] as const) {
      expect(sorted(live[k].keys())).toEqual(sorted(once[k].keys()));
      for (const [key, set] of once[k]) expect(sorted(live[k].get(key))).toEqual(sorted(set));
    }
    for (const k of ['dxcc', 'continent', 'cqZone', 'ituZone'] as const) expect(sorted(live.places[k].all)).toEqual(sorted(once.places[k].all));
    expect(sorted(live.places.dxcc.all).length).toBe(3);
  });
});

describe('the station sheet’s Worked before', () => {
  it('lists the phone’s QSOs, then what only Wavelog holds, and Not yet for neither', () => {
    expect(workedBeforeText([], new Set(), [])).toBe('Not yet');
    expect(workedBeforeText([], new Set(), ['20m FT8'])).toBe('20m FT8 in Wavelog');
    expect(workedBeforeText([], new Set(), ['40m FT4', '20m FT8'])).toBe('40m FT4, 20m FT8 in Wavelog');
    expect(workedBeforeText(['20m FT8 at 09:14'], new Set(['20m FT8']), [])).toBe('20m FT8 at 09:14');
    // A band and mode the phone has already is not repeated as Wavelog's.
    expect(workedBeforeText(['20m FT8 at 09:14'], new Set(['20m FT8']), ['40m FT4', '20m FT8'])).toBe('20m FT8 at 09:14 · 40m FT4 in Wavelog');
    expect(workedBeforeText(['20m FT8 at 09:14', '20m FT8 on 2026-10-12'], new Set(['20m FT8']), ['20m FT8'])).toBe('20m FT8 at 09:14, 20m FT8 on 2026-10-12');
  });
});

describe('mergeLogIndex', () => {
  it('counts a call, grid or place in either index, and gives the log back with nothing to merge', () => {
    expect(mergeLogIndex(OWN, null)).toBe(OWN);
    expect(BOTH.calls.has('JA7XVZ') && BOTH.calls.has('JA1KXM')).toBe(true);
    expect(BOTH.calls.has('K1ABC')).toBe(false);
    expect([...BOTH.calls].sort()).toEqual(['4I1LCT', 'JA1KXM', 'JA7XVZ', 'ZL1TQK']);
    expect([...BOTH.callsByBand.keys()].sort()).toEqual(['20m', '40m']);
    expect(BOTH.gridsByBand.get('40m')?.has('QM09')).toBe(true);
    expect(BOTH.gridsByBand.get('20m')?.has('PM95')).toBe(true);
  });
});

describe('decode colours with QSOs only in Wavelog', () => {
  it('grey a station worked in Wavelog on this band and mode, and leave it out of New', () => {
    const own = colours('CQ JA1KXM PM95', OWN);
    expect(own).toMatchObject({ bg: 'newGrid', ink: null, isNew: true, worked: false });
    const both = colours('CQ JA1KXM PM95', BOTH);
    expect(both).toMatchObject({ bg: 'cq', ink: 'worked', isNew: false, worked: true });
    // Any message from the station greys, as from the log.
    expect(colours('K1ABC JA1KXM -10', BOTH)).toMatchObject({ ink: 'worked', worked: true });
  });

  it('count a portable call by its base callsign, as the log does', () => {
    expect(colours('CQ ZL1TQK RF73', BOTH)).toMatchObject({ worked: true, ink: 'worked' });
    expect(colours('CQ ZL1TQK/P RF73', BOTH)).toMatchObject({ worked: true });
  });

  it('take FT4 from MFSK with SUBMODE FT4, so it counts on FT4 alone', () => {
    expect(colours('CQ 4I1LCT PK04', BOTH, { band: '20m', mode: 'FT4' })).toMatchObject({ worked: true });
    expect(colours('CQ 4I1LCT PK04', BOTH, { band: '20m', mode: 'FT8' })).toMatchObject({ worked: false, isNew: false, bg: 'cq' });
  });

  it('keep the band: worked on 20m is New call on this band on 40m', () => {
    const r = colours('CQ JA1KXM PM95', BOTH, { band: '40m', mode: 'FT8' });
    expect(r).toMatchObject({ worked: false, isNew: true, bg: 'newGridBand' });
    expect(colours('CQ JA1KXM PM95', BOTH, { band: '40m', mode: 'FT8' }, defaultHighlights().map((e) => (e.id.startsWith('newGrid') ? { ...e, on: false } : e))).bg).toBe('newCallBand');
  });

  it('place Wavelog’s calls by the country file for New DXCC', () => {
    const cty = DxccIndex.fromJson(JSON.parse(JSON.stringify(bigCtyFixture())));
    const own = buildLogIndex([qso('JA7XVZ', 'QM09', '40m')], cty);
    const vk = keysOf([{ CALL: 'VK3/9V1NE', BAND: '20m', MODE: 'FT8' }]);
    // A CQ from Australia: new until Wavelog's log holds a QSO with an Australian call.
    expect(colours('CQ VK2ESN QF56', own).bg).toBe('newDxcc');
    const both = mergeLogIndex(own, buildKeysIndex(vk, cty));
    expect(colours('CQ VK2ESN QF56', both).bg).not.toBe('newDxcc');
    expect(colours('CQ VK2ESN QF56', both).isNew).toBe(true);
    // Japan was in the log already.
    expect(colours('CQ JA1KXM PM95', both).bg).toBe('newGrid');
  });

  it('let Hide worked and New leave out a station worked only in Wavelog', () => {
    const slot: SlotDecodes = {
      startUtcMs: Date.UTC(2026, 9, 16, 9, 0, 0),
      mode: 'FT8',
      ms: 40,
      decodes: [
        { text: 'CQ JA1KXM PM95', freq_hz: 900, dt_s: 0.1, snr_db: -5 },
        { text: 'CQ K1ABC FN42', freq_hz: 1200, dt_s: 0.1, snr_db: -12 },
        { text: '9V1NE JA1KXM -10', freq_hz: 900, dt_s: 0.1, snr_db: -6 },
      ],
    };
    const classify = (index: LogIndex): Classify => (d, sent) => highlightDecode({ text: d.text, sent }, ME, index, AT, defaultHighlights());
    const rows = (index: LogIndex, hideWorked: boolean, filter: 'all' | 'new' = 'all') =>
      buildList([slot], ME, filter, 1500, [], 'FT8', classify(index), {}, { hideWorked }).flatMap((i) => (i.kind === 'row' ? [i.row.decode.text] : []));
    expect(rows(OWN, true)).toEqual(['9V1NE JA1KXM -10', 'CQ JA1KXM PM95', 'CQ K1ABC FN42']);
    // Messages to the operator stay.
    expect(rows(BOTH, true)).toEqual(['9V1NE JA1KXM -10', 'CQ K1ABC FN42']);
    expect(rows(BOTH, false)).toHaveLength(3);
    expect(rows(OWN, false, 'new')).toEqual(['CQ JA1KXM PM95', 'CQ K1ABC FN42']);
    expect(rows(BOTH, false, 'new')).toEqual(['CQ K1ABC FN42']);
    expect(filterCounts([slot], ME, 1500, { classify: classify(BOTH), hideWorked: true })).toMatchObject({ all: 2, new: 1 });
  });
});
