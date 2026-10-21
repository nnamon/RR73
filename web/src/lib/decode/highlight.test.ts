import { describe, expect, it } from 'vitest';
import { CATEGORIES, PALETTE, PRESETS, bandColour, defaultHighlights, highlightDecode, isBackground, isDefault, moveBackground, moveEntry, normaliseHighlights, presetHighlights, presetLabel, presetOf, type HighlightEntry, type HighlightId } from './highlight';
import { buildLogIndex, isNewPlace, type IndexedQso } from '../log/worked';
import { DxccIndex } from '../reference/dxcc';
import { bigCtyFixture } from '../reference/testing';

const qso = (call: string, gridsquare: string, band: string, mode = 'FT8', submode = ''): IndexedQso => ({ call, gridsquare, band, mode, submode });

/** Worked: JA7XVZ on 40m FT8 (QM09), 9M2TRX on 20m FT8 (OJ02), 4I1LCT on 20m FT4 (PK04), ZL1TQK on 20m FT8 as ZL1TQK/P (RF73). */
const LOG = buildLogIndex([qso('JA7XVZ', 'QM09', '40m'), qso('9M2TRX', 'OJ02ab', '20m'), qso('4I1LCT', 'pk04', '20M', 'MFSK', 'FT4'), qso('ZL1TQK/P', 'RF73', '20m')]);
const AT = { band: '20m', mode: 'FT8' };
const ME = '9V1NE';

const PLACES: HighlightId[] = ['newContinent', 'newContinentBand', 'newCqZone', 'newCqZoneBand', 'newItuZone', 'newItuZoneBand', 'newDxcc', 'newDxccBand'];
/** The background categories in WSJT-X's order. */
const BACKGROUND_ORDER: HighlightId[] = ['myCall', ...PLACES, 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'cq', 'sent'];
const at = (id: HighlightId) => defaultHighlights().findIndex((e) => e.id === id);

const on = (...ids: HighlightId[]): HighlightEntry[] => defaultHighlights().map((e) => ({ ...e, on: ids.includes(e.id) }));
const order = (...ids: HighlightId[]): HighlightEntry[] => ids.map((id) => ({ id, on: true, colour: '#FF0000' }));
type Opts = { sent?: boolean; me?: string; at?: typeof AT };
const both = (text: string, entries = defaultHighlights(), opts: Opts = {}) => {
  const { bg, ink } = highlightDecode({ text, sent: opts.sent }, opts.me ?? ME, LOG, opts.at ?? AT, entries);
  return { bg, ink };
};
/** The background category. */
const hl = (text: string, entries = defaultHighlights(), opts: Opts = {}) => both(text, entries, opts).bg;
/** The text layer. */
const ink = (text: string, entries = defaultHighlights(), opts: Opts = {}) => both(text, entries, opts).ink;

describe('the default order', () => {
  it("is WSJT-X's, with every place category off, New DXCC too", () => {
    expect(defaultHighlights().map((e) => e.id)).toEqual([...BACKGROUND_ORDER, 'worked']);
    expect(defaultHighlights().filter((e) => !e.on).map((e) => e.id)).toEqual(['newContinent', 'newContinentBand', 'newCqZone', 'newCqZoneBand', 'newItuZone', 'newItuZoneBand', 'newDxcc', 'newDxccBand']);
    expect(isDefault(defaultHighlights())).toBe(true);
    expect(isDefault(defaultHighlights().map((e) => ({ ...e, on: true })))).toBe(false);
  });

  it('draws every default colour from the palette', () => {
    const colours = new Set(PALETTE.map((p) => p.colour));
    for (const c of CATEGORIES) expect(colours.has(c.colour), c.id).toBe(true);
    expect(PALETTE.length).toBe(27);
    expect(new Set(PALETTE.map((p) => p.colour)).size).toBe(27);
  });
});

describe('highlightDecode', () => {
  it('gives the first enabled match from the top', () => {
    // A CQ from a new call in a new grid: new grid ranks first in WSJT-X's order.
    expect(hl('CQ A41ZZ LL93')).toBe('newGrid');
    expect(hl('CQ A41ZZ LL93', order('cq', 'newGrid', 'newCall'))).toBe('cq');
    expect(hl('CQ A41ZZ LL93', order('newCall', 'newGrid', 'cq'))).toBe('newCall');
    // My call ranks above everything.
    expect(hl('9V1NE JA1KXM PM95')).toBe('myCall');
    expect(hl('9V1NE JA1KXM PM95', order('cq', 'newCall', 'myCall'))).toBe('myCall');
  });

  it('skips disabled categories', () => {
    expect(hl('CQ A41ZZ LL93', on('newCall', 'cq'))).toBe('newCall');
    expect(hl('CQ A41ZZ LL93', on('cq'))).toBe('cq');
    expect(hl('CQ A41ZZ LL93', on())).toBeNull();
    expect(hl('9V1NE JA1KXM PM95', on('newCall', 'cq'))).toBeNull();
  });

  it('finds my call in portable forms, on either side', () => {
    for (const text of ['9V1NE/P JA1KXM -09', 'VK3/9V1NE JA1KXM R-09', 'JA1KXM 9V1NE/P RR73', '<9V1NE> JA1KXM 73', 'CQ VK3/9V1NE/P QF22']) expect(hl(text), text).toBe('myCall');
    expect(hl('9V1NE JA1KXM -09', defaultHighlights(), { me: 'VK3/9V1NE' })).toBe('myCall');
    expect(hl('9V1NEX JA1KXM -09', on('myCall'))).toBeNull();
    expect(hl('JA1KXM 9V1NE -09', on('myCall'), { me: '' })).toBeNull();
  });

  it('tells new on any band from new on this band', () => {
    // JA7XVZ and QM09 are in the log on 40m only.
    expect(hl('CQ JA7XVZ QM09', on('newCall', 'newCallBand'))).toBe('newCallBand');
    expect(hl('CQ JA7XVZ QM09', on('newGrid', 'newGridBand'))).toBe('newGridBand');
    expect(hl('CQ JA7XVZ QM09', on('newCall', 'newGrid'))).toBeNull();
    expect(hl('CQ JA7XVZ QM09', on('newCallBand', 'newGridBand'), { at: { band: '40m', mode: 'FT8' } })).toBeNull();
    // A station never worked is new on this band as well.
    expect(hl('CQ A41ZZ LL93', on('newCallBand', 'newGridBand'))).toBe('newGridBand');
    expect(hl('CQ A41ZZ', on('newCallBand', 'newGridBand'))).toBe('newCallBand');
  });

  it('greys worked before on this band and mode only, as a text layer', () => {
    expect(both('CQ 9M2TRX OJ02', on('worked'))).toEqual({ bg: null, ink: 'worked' });
    // 6-character grids in the log count by their square.
    expect(both('CQ 9M2TRX OJ02', on('newGrid', 'newGridBand', 'worked'))).toEqual({ bg: null, ink: 'worked' });
    // 4I1LCT is in the log on 20m FT4 (MODE MFSK, SUBMODE FT4).
    expect(ink('BD7PDP 4I1LCT RR73')).toBeNull();
    expect(ink('BD7PDP 4I1LCT RR73', defaultHighlights(), { at: { band: '20m', mode: 'FT4' } })).toBe('worked');
    expect(ink('CQ JA7XVZ QM09')).toBeNull();
    // Worked portable counts as worked.
    expect(both('CQ ZL1TQK RF73')).toEqual({ bg: 'cq', ink: 'worked' });
    expect(ink('CQ 9M2TRX OJ02', on('cq'))).toBeNull();
  });

  it('gives a worked-before CQ sender the CQ background and the grey text', () => {
    expect(both('CQ 9M2TRX OJ02')).toEqual({ bg: 'cq', ink: 'worked' });
    // Whatever wins the background, and whatever the order.
    expect(both('BD7PDP 9M2TRX RR73')).toEqual({ bg: 'ending', ink: 'worked' });
    expect(both('9V1NE 9M2TRX 73')).toEqual({ bg: 'myCall', ink: 'worked' });
    expect(both('CQ 9M2TRX OJ02', [...defaultHighlights()].reverse())).toEqual({ bg: 'cq', ink: 'worked' });
  });

  it('greys the sender of any message, own transmissions aside', () => {
    expect(both('JA1KXM 9M2TRX -12')).toEqual({ bg: null, ink: 'worked' });
    expect(both('9M2TRX JA1KXM -12')).toEqual({ bg: null, ink: null });
    expect(both('9M2TRX 9V1NE R-12', defaultHighlights(), { sent: true })).toEqual({ bg: 'sent', ink: null });
  });

  it('looks at the sender of a CQ, 73 or RR73 only', () => {
    expect(hl('JA1KXM A41ZZ LL93')).toBeNull();
    expect(hl('JA1KXM A41ZZ -12')).toBeNull();
    expect(hl('JA1KXM A41ZZ 73')).toBe('newCall');
    expect(both('A41ZZ 9M2TRX RR73', on('worked'))).toEqual({ bg: null, ink: 'worked' });
    expect(hl('CQ DX A41ZZ LL93', on('newCall'))).toBe('newCall');
    expect(hl('CQ <...> LL93', on('newCall', 'newGrid'))).toBeNull();
    expect(hl('TNX FOR QSO 73', on('newCall', 'cq'))).toBeNull();
  });

  it('greys only a dupe, and marks a station worked on another day as workable', () => {
    const log = buildLogIndex([qso('K1ABC', 'FN42', '20m')]);
    const today = (call: string) => call === 'K1ABC';
    const dupe = highlightDecode({ text: 'CQ K1ABC FN42' }, ME, log, { ...AT, dupe: today }, on('worked'));
    expect(dupe).toMatchObject({ ink: 'worked', worked: true, before: false });
    const another = highlightDecode({ text: 'CQ K1ABC FN42' }, ME, log, { ...AT, dupe: () => false }, on('worked'));
    expect(another).toMatchObject({ ink: null, worked: false, before: true });
  });

  it("ignores the operator's own callsign for new and worked before", () => {
    const log = buildLogIndex([qso('9V1NE/P', 'OJ11', '20m')]);
    const none = { bg: null, ink: null, isNew: false, worked: false, before: false };
    expect(highlightDecode({ text: 'CQ 9V1NE OJ11' }, ME, log, AT, on('newCall', 'newCallBand', 'newGrid', 'worked'))).toEqual(none);
    expect(highlightDecode({ text: 'CQ 9V1NE/P OJ11' }, ME, log, AT, on('worked'))).toEqual(none);
    expect(highlightDecode({ text: 'JA1KXM VK3/9V1NE 73' }, ME, buildLogIndex([]), AT, on('newCall'))).toEqual(none);
  });

  it('says whether any enabled new category matches, and whether the sender is worked, for the filters', () => {
    const full = (text: string, entries = defaultHighlights()) => highlightDecode({ text }, ME, LOG, AT, entries);
    // My call wins the background; the 73 sender is still a new call.
    expect(full('9V1NE A41ZZ 73')).toMatchObject({ bg: 'myCall', isNew: true, worked: false });
    expect(full('9V1NE A41ZZ 73', on('myCall', 'cq'))).toMatchObject({ isNew: false });
    expect(full('CQ 9M2TRX OJ02')).toMatchObject({ isNew: false, worked: true });
    // Worked whatever the Worked before switch says.
    expect(full('CQ 9M2TRX OJ02', on('cq'))).toMatchObject({ ink: null, worked: true });
    expect(highlightDecode({ text: 'JA1KXM 9V1NE R-10', sent: true }, ME, LOG, AT, defaultHighlights())).toMatchObject({ isNew: false, worked: false });
  });

  it('matches own transmissions as Sent, and nothing else', () => {
    expect(hl('JA1KXM 9V1NE R-14', defaultHighlights(), { sent: true })).toBe('sent');
    expect(hl('CQ 9V1NE OJ11', order('cq', 'myCall', 'newCall', 'sent'), { sent: true })).toBe('sent');
    expect(hl('CQ 9V1NE OJ11', on('cq', 'myCall', 'newCall'), { sent: true })).toBeNull();
    expect(hl('JA1KXM A41ZZ R-14', on('sent'))).toBeNull();
  });
});

describe('ending a QSO', () => {
  it('matches RR73 or 73 from a station to another station', () => {
    expect(hl('BD7PDP 9M2TRX RR73')).toBe('ending');
    expect(hl('BD7PDP 9M2TRX 73')).toBe('ending');
    expect(hl('BD7PDP 9M2TRX RRR', on('ending'))).toBeNull();
    expect(hl('BD7PDP 9M2TRX -12', on('ending'))).toBeNull();
    expect(hl('CQ 9M2TRX OJ02', on('ending'))).toBeNull();
    // Ranks below new call and above CQ, as placed in the defaults.
    expect(hl('BD7PDP A41ZZ RR73')).toBe('newCall');
    expect(hl('BD7PDP A41ZZ RR73', on('ending', 'worked'))).toBe('ending');
  });

  it('leaves out RR73 to me and RR73 from me, with portable forms', () => {
    expect(hl('9V1NE/P 9M2TRX RR73', on('ending'))).toBeNull();
    expect(hl('VK3/9V1NE 9M2TRX 73', on('ending', 'myCall'))).toBe('myCall');
    expect(hl('9M2TRX VK3/9V1NE RR73', on('ending'))).toBeNull();
    expect(hl('BD7PDP ZL1TQK/P RR73', on('ending'))).toBe('ending');
  });
});

describe('normaliseHighlights', () => {
  it('gives the defaults for anything that is not a list', () => {
    expect(normaliseHighlights(undefined)).toEqual(defaultHighlights());
    expect(normaliseHighlights({ myCall: true })).toEqual(defaultHighlights());
  });

  it('drops unknown and repeated categories and repairs bad values', () => {
    const got = normaliseHighlights([
      { id: 'cq', on: false, colour: '#00ff00' },
      { id: 'lotw', on: true, colour: '#FF00FF' },
      { id: 'cq', on: true, colour: '#0000FF' },
      { id: 'myCall', on: 'yes', colour: 'red' },
      null,
    ]);
    expect(got.slice(0, 2)).toEqual([
      { id: 'cq', on: false, colour: '#00FF00' },
      { id: 'myCall', on: true, colour: '#D55E00' },
    ]);
    expect(got.map((e) => e.id).sort()).toEqual(defaultHighlights().map((e) => e.id).sort());
  });

  it('inserts a missing category after the last stored one that ranks above it', () => {
    // As a category added in a later release meets a stored order.
    const stored = defaultHighlights().filter((e) => e.id !== 'newCall' && e.id !== 'worked');
    const got = normaliseHighlights(moveEntry(stored, stored.length - 1, 0)).map((e) => e.id);
    expect(got).toEqual(['sent', 'myCall', ...PLACES, 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'cq', 'worked']);
  });

  it('gives an added category the switch and colour of the preset the stored ones match', () => {
    // A stored order from before the place categories: each preset gets its own back.
    for (const p of PRESETS) {
      const stored = presetHighlights(p.id).filter((e) => !PLACES.includes(e.id));
      expect(normaliseHighlights(stored), p.id).toEqual(presetHighlights(p.id));
    }
    // A changed colour matches no preset: the added ones take RR73's scheme.
    const mine = presetHighlights('wsjtx')
      .filter((e) => !PLACES.includes(e.id))
      .map((e) => (e.id === 'cq' ? { ...e, colour: '#00AA00' } : e));
    const got = normaliseHighlights(mine);
    for (const id of PLACES) expect(got.find((e) => e.id === id), id).toEqual(defaultHighlights().find((e) => e.id === id));
    expect(got.find((e) => e.id === 'cq')?.colour).toBe('#00AA00');
  });
});

describe('moveBackground', () => {
  it('reorders background categories and keeps text layers after them', () => {
    const moved = moveBackground(defaultHighlights(), at('cq'), 0).map((e) => e.id);
    expect(moved).toEqual(['cq', ...BACKGROUND_ORDER.filter((id) => id !== 'cq'), 'worked']);
    expect(isBackground({ id: 'worked' })).toBe(false);
  });
});

describe('moveEntry', () => {
  it('moves one entry and leaves the input alone', () => {
    const d = defaultHighlights();
    const moved = moveEntry(d, at('cq'), 0);
    expect(moved.map((e) => e.id).slice(0, 3)).toEqual(['cq', 'myCall', 'newContinent']);
    expect(d[0].id).toBe('myCall');
    expect(moveEntry(d, 0, 99).map((e) => e.id)).toEqual(d.map((e) => e.id));
  });
});

describe('buildLogIndex', () => {
  it('keys calls by base callsign, grids by square and bands in lower case', () => {
    expect([...LOG.calls].sort()).toEqual(['4I1LCT', '9M2TRX', 'JA7XVZ', 'ZL1TQK']);
    expect([...LOG.grids].sort()).toEqual(['OJ02', 'PK04', 'QM09', 'RF73']);
    expect([...(LOG.callsByBandMode.get('20m FT4') ?? [])]).toEqual(['4I1LCT']);
    expect([...(LOG.gridsByBand.get('40m') ?? [])]).toEqual(['QM09']);
  });
});

describe('presets', () => {
  it('RR73 is the default', () => {
    expect(presetHighlights('rr73')).toEqual(defaultHighlights());
    expect(presetOf(defaultHighlights())).toBe('rr73');
  });

  it('Quiet keeps My call, Sent, CQ and Ending a QSO on, in RR73’s colours', () => {
    const q = presetHighlights('quiet');
    expect(q.filter((e) => e.on).map((e) => e.id)).toEqual(['myCall', 'ending', 'cq', 'sent']);
    expect(q.filter((e) => !e.on).map((e) => e.id)).toEqual([...PLACES, 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'worked']);
    expect(q.map(({ id, colour }) => ({ id, colour }))).toEqual(defaultHighlights().map(({ id, colour }) => ({ id, colour })));
  });

  it('WSJT-X has WSJT-X 2.7.0’s own colours and switches, but New DXCC off, and its 2 missing categories off', () => {
    // Read from WSJT-X 2.7.0's Settings › Colors tab (docs/design/decode-colours.md).
    expect(presetHighlights('wsjtx')).toEqual([
      { id: 'myCall', on: true, colour: '#FF6666' },
      { id: 'newContinent', on: true, colour: '#FF0063' },
      { id: 'newContinentBand', on: true, colour: '#FF99C2' },
      { id: 'newCqZone', on: true, colour: '#FFBF00' },
      { id: 'newCqZoneBand', on: true, colour: '#FFE499' },
      { id: 'newItuZone', on: false, colour: '#A6FF00' },
      { id: 'newItuZoneBand', on: false, colour: '#DDFF99' },
      { id: 'newDxcc', on: false, colour: '#FF00FF' },
      { id: 'newDxccBand', on: false, colour: '#FFAAFF' },
      { id: 'newGrid', on: false, colour: '#FF8000' },
      { id: 'newGridBand', on: false, colour: '#FFCC99' },
      { id: 'newCall', on: false, colour: '#00FFFF' },
      { id: 'newCallBand', on: false, colour: '#99FFFF' },
      { id: 'ending', on: false, colour: '#FFE2C8' },
      { id: 'cq', on: true, colour: '#66FF66' },
      { id: 'sent', on: true, colour: '#FFFF00' },
      { id: 'worked', on: false, colour: '#8C93A0' },
    ]);
  });

  it('makes each “on this band” colour by WSJT-X’s rule: 40% colour, 60% white', () => {
    expect(bandColour('#FF8000')).toBe('#FFCC99');
    expect(bandColour('#00FFFF')).toBe('#99FFFF');
    for (const p of PRESETS.filter((x) => x.id !== 'wsjtx')) {
      for (const id of ['newGrid', 'newCall', 'newContinent', 'newCqZone', 'newItuZone', 'newDxcc'] as const) expect(p.colours[`${id}Band`], `${p.id} ${id}`).toBe(bandColour(p.colours[id]));
    }
  });

  it('switches the editor schemes as RR73’s, each with colours of its own and RR73’s for the place categories', () => {
    const editors = PRESETS.filter((p) => ['monokai', 'solarized', 'dracula', 'nord', 'gruvbox'].includes(p.id));
    expect(editors).toHaveLength(5);
    const rr73 = PRESETS.find((p) => p.id === 'rr73')!;
    for (const p of editors) {
      expect(presetHighlights(p.id).map((e) => e.on), p.id).toEqual(defaultHighlights().map((e) => e.on));
      expect(new Set(Object.values(p.colours)).size, p.id).toBe(17);
      for (const id of PLACES) expect(p.colours[id], `${p.id} ${id}`).toBe(rr73.colours[id]);
    }
  });

  it('names the preset the settings match, and Custom for anything else', () => {
    for (const p of PRESETS) expect(presetOf(presetHighlights(p.id)), p.id).toBe(p.id);
    // One switch, one colour or one move away from a preset is Custom.
    expect(presetOf(presetHighlights('quiet').map((e) => (e.id === 'newCall' ? { ...e, on: true } : e)))).toBe('custom');
    expect(presetOf(defaultHighlights().map((e) => (e.id === 'worked' ? { ...e, on: false } : e)))).toBe('custom');
    expect(presetOf(defaultHighlights().map((e) => (e.id === 'cq' ? { ...e, colour: '#FF00FF' } : e)))).toBe('custom');
    expect(presetOf(moveBackground(defaultHighlights(), at('cq'), at('ending')))).toBe('custom');
    expect(presetOf(moveBackground(presetHighlights('quiet'), at('cq'), at('ending')))).toBe('custom');
    expect(presetOf([])).toBe('custom');
    expect(PRESETS.map((p) => presetLabel(p.id))).toEqual(['RR73', 'Quiet', 'WSJT-X', 'Monokai', 'Solarized', 'Dracula', 'Nord', 'Gruvbox']);
    expect(presetLabel('custom')).toBe('Custom');
  });

  it('under Quiet, a CQ from a new grid or a new call takes the CQ colour, and worked stations keep their text', () => {
    const q = presetHighlights('quiet');
    expect(hl('CQ A41ZZ LL93')).toBe('newGrid');
    expect(hl('CQ A41ZZ LL93', q)).toBe('cq');
    expect(hl('CQ 9M2TRX OJ02', q)).toBe('cq');
    expect(ink('CQ 9M2TRX OJ02')).toBe('worked');
    expect(ink('CQ 9M2TRX OJ02', q)).toBeNull();
    expect(hl('JA8HCE VK2AXN RR73', q)).toBe('ending');
    expect(hl('9V1NE JA1KXM PM95', q)).toBe('myCall');
    expect(hl('JA1KXM 9V1NE R-14', q, { sent: true })).toBe('sent');
    expect(hl('JA1KXM VK2AXN R-14', q)).toBeNull();
  });
});

describe('the place categories', () => {
  const cty = DxccIndex.fromJson(JSON.parse(JSON.stringify(bigCtyFixture())));
  /** Worked: Japan on 40m (AS, CQ 25, ITU 45), West Malaysia (AS, CQ 28, ITU 54), New Zealand (OC, CQ 32, ITU 60) and Italy on 20m. */
  const placed = buildLogIndex([qso('JA7XVZ', 'QM09', '40m'), qso('9M2TRX', 'OJ02', '20m'), qso('ZL1TQK/P', 'RF73', '20m'), qso('I1ABC', 'JN35', '20m')], cty);
  const placedHl = (text: string, entries: HighlightEntry[], band = '20m') => highlightDecode({ text }, ME, placed, { band, mode: 'FT8' }, entries).bg;

  it('finds a new DXCC entity, continent and zone in the order of the list', () => {
    // Oman: Asia, CQ zone 21, ITU zone 39.
    expect(placedHl('CQ A41ZZ LL93', defaultHighlights())).toBe('newGrid');
    expect(placedHl('CQ A41ZZ LL93', on('newDxcc'))).toBe('newDxcc');
    expect(placedHl('CQ A41ZZ LL93', on(...PLACES))).toBe('newCqZone');
    expect(placedHl('CQ A41ZZ LL93', on('newContinent', 'newItuZone', 'newDxcc'))).toBe('newItuZone');
    expect(placedHl('CQ A41ZZ LL93', on('newContinent', 'newContinentBand'))).toBeNull();
    // The Canary Islands: Africa, a continent the log lacks.
    expect(placedHl('CQ EA8ABC IL18', on(...PLACES))).toBe('newContinent');
  });

  it('tells new on any band from new on this band', () => {
    // Japan is in the log on 40m; Asia on 20m too, from West Malaysia, in other zones.
    expect(placedHl('CQ JA1ABC PM95', on(...PLACES))).toBe('newCqZoneBand');
    expect(placedHl('CQ JA1ABC PM95', on('newContinentBand', 'newDxcc', 'newDxccBand', 'newItuZoneBand'))).toBe('newItuZoneBand');
    expect(placedHl('CQ JA1ABC PM95', on('newDxcc', 'newDxccBand'))).toBe('newDxccBand');
    expect(placedHl('CQ JA1ABC PM95', on(...PLACES), '40m')).toBeNull();
  });

  it('places a station by its whole call, and counts DXCC entities by their code', () => {
    // VK3/ZL1ABC is in Australia; IT9 (Sicily, on the WAE list) counts for Italy.
    expect(placedHl('CQ VK3/ZL1ABC QF22', on('newDxcc'))).toBe('newDxcc');
    expect(placedHl('CQ ZL1ABC RF73', on('newDxcc'))).toBeNull();
    expect(placedHl('CQ IT9ABC JM67', on('newDxcc', 'newDxccBand'))).toBeNull();
    const log = buildLogIndex([qso('VK3/9M2TRX', 'QF22', '20m')], cty);
    expect(isNewPlace(log, log.place('VK2AXN'), 'dxcc')).toBe(false);
    expect(isNewPlace(log, log.place('9M2ABC'), 'dxcc')).toBe(true);
    expect(isNewPlace(log, log.place('VK2AXN'), 'dxcc', '40M')).toBe(true);
  });

  it('looks at the sender of a CQ, 73 or RR73 only, and never at the operator', () => {
    expect(placedHl('JA1KXM A41ZZ -12', on('newDxcc'))).toBeNull();
    expect(placedHl('JA1KXM A41ZZ RR73', on('newDxcc'))).toBe('newDxcc');
    expect(placedHl('CQ <...> LL93', on('newDxcc'))).toBeNull();
    expect(placedHl('CQ 9V1NE OJ11', on('newDxcc'))).toBeNull();
    // Maritime mobile has no entity.
    expect(placedHl('CQ JA1ABC/MM', on(...PLACES))).toBeNull();
  });

  it('matches nothing without the country file', () => {
    expect(hl('CQ A41ZZ LL93', on(...PLACES))).toBeNull();
    expect(LOG.place('A41ZZ')).toBeNull();
  });
});
