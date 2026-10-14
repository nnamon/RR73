import { describe, expect, it } from 'vitest';
import { CATEGORIES, PALETTE, PRESETS, bandColour, defaultHighlights, highlightDecode, isBackground, isDefault, moveBackground, moveEntry, normaliseHighlights, presetHighlights, presetLabel, presetOf, type HighlightEntry, type HighlightId } from './highlight';
import { buildLogIndex, type IndexedQso } from '../log/worked';

const qso = (call: string, gridsquare: string, band: string, mode = 'FT8', submode = ''): IndexedQso => ({ call, gridsquare, band, mode, submode });

/** Worked: JA7XVZ on 40m FT8 (QM09), 9M2TRX on 20m FT8 (OJ02), 4I1LCT on 20m FT4 (PK04), ZL1TQK on 20m FT8 as ZL1TQK/P (RF73). */
const LOG = buildLogIndex([qso('JA7XVZ', 'QM09', '40m'), qso('9M2TRX', 'OJ02ab', '20m'), qso('4I1LCT', 'pk04', '20M', 'MFSK', 'FT4'), qso('ZL1TQK/P', 'RF73', '20m')]);
const AT = { band: '20m', mode: 'FT8' };
const ME = '9V1NE';

const on = (...ids: HighlightId[]): HighlightEntry[] => defaultHighlights().map((e) => ({ ...e, on: ids.includes(e.id) }));
const order = (...ids: HighlightId[]): HighlightEntry[] => ids.map((id) => ({ id, on: true, colour: '#FF0000' }));
type Opts = { sent?: boolean; me?: string; at?: typeof AT };
const both = (text: string, entries = defaultHighlights(), opts: Opts = {}) => highlightDecode({ text, sent: opts.sent }, opts.me ?? ME, LOG, opts.at ?? AT, entries);
/** The background category. */
const hl = (text: string, entries = defaultHighlights(), opts: Opts = {}) => both(text, entries, opts).bg;
/** The text layer. */
const ink = (text: string, entries = defaultHighlights(), opts: Opts = {}) => both(text, entries, opts).ink;

describe('the default order', () => {
  it("is WSJT-X's for the categories the log can answer, with every category on", () => {
    expect(defaultHighlights().map((e) => e.id)).toEqual(['myCall', 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'cq', 'sent', 'worked']);
    expect(defaultHighlights().every((e) => e.on)).toBe(true);
    expect(isDefault(defaultHighlights())).toBe(true);
  });

  it('draws every default colour from the palette', () => {
    const colours = new Set(PALETTE.map((p) => p.colour));
    for (const c of CATEGORIES) expect(colours.has(c.colour), c.id).toBe(true);
    expect(PALETTE.length).toBe(19);
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

  it("ignores the operator's own callsign for new and worked before", () => {
    const log = buildLogIndex([qso('9V1NE/P', 'OJ11', '20m')]);
    const none = { bg: null, ink: null };
    expect(highlightDecode({ text: 'CQ 9V1NE OJ11' }, ME, log, AT, on('newCall', 'newCallBand', 'newGrid', 'worked'))).toEqual(none);
    expect(highlightDecode({ text: 'CQ 9V1NE/P OJ11' }, ME, log, AT, on('worked'))).toEqual(none);
    expect(highlightDecode({ text: 'JA1KXM VK3/9V1NE 73' }, ME, buildLogIndex([]), AT, on('newCall'))).toEqual(none);
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
      { id: 'newDxcc', on: true, colour: '#FF00FF' },
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
    expect(got).toEqual(['sent', 'myCall', 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'cq', 'worked']);
  });
});

describe('moveBackground', () => {
  it('reorders background categories and keeps text layers after them', () => {
    const moved = moveBackground(defaultHighlights(), 6, 0).map((e) => e.id);
    expect(moved).toEqual(['cq', 'myCall', 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'sent', 'worked']);
    expect(isBackground({ id: 'worked' })).toBe(false);
  });
});

describe('moveEntry', () => {
  it('moves one entry and leaves the input alone', () => {
    const d = defaultHighlights();
    const moved = moveEntry(d, 6, 0);
    expect(moved.map((e) => e.id).slice(0, 3)).toEqual(['cq', 'myCall', 'newGrid']);
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
  it('RR73 is the default: every category on', () => {
    expect(presetHighlights('rr73')).toEqual(defaultHighlights());
    expect(presetOf(defaultHighlights())).toBe('rr73');
  });

  it('Quiet keeps My call, Sent, CQ and Ending a QSO on, in RR73’s colours', () => {
    const q = presetHighlights('quiet');
    expect(q.filter((e) => e.on).map((e) => e.id)).toEqual(['myCall', 'ending', 'cq', 'sent']);
    expect(q.filter((e) => !e.on).map((e) => e.id)).toEqual(['newGrid', 'newGridBand', 'newCall', 'newCallBand', 'worked']);
    expect(q.map(({ id, colour }) => ({ id, colour }))).toEqual(defaultHighlights().map(({ id, colour }) => ({ id, colour })));
  });

  it('WSJT-X has WSJT-X 2.7.0’s own colours and switches, and its 2 missing categories off', () => {
    // Read from WSJT-X 2.7.0's Settings › Colors tab (docs/design/decode-colours.md).
    expect(presetHighlights('wsjtx')).toEqual([
      { id: 'myCall', on: true, colour: '#FF6666' },
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
      expect(p.colours.newGridBand, p.id).toBe(bandColour(p.colours.newGrid));
      expect(p.colours.newCallBand, p.id).toBe(bandColour(p.colours.newCall));
    }
  });

  it('turns every category on in the editor schemes, each with colours of its own', () => {
    const editors = PRESETS.filter((p) => ['monokai', 'solarized', 'dracula', 'nord', 'gruvbox'].includes(p.id));
    expect(editors).toHaveLength(5);
    for (const p of editors) {
      expect(presetHighlights(p.id).every((e) => e.on), p.id).toBe(true);
      expect(new Set(Object.values(p.colours)).size, p.id).toBe(9);
    }
  });

  it('names the preset the settings match, and Custom for anything else', () => {
    for (const p of PRESETS) expect(presetOf(presetHighlights(p.id)), p.id).toBe(p.id);
    // One switch, one colour or one move away from a preset is Custom.
    expect(presetOf(presetHighlights('quiet').map((e) => (e.id === 'newCall' ? { ...e, on: true } : e)))).toBe('custom');
    expect(presetOf(defaultHighlights().map((e) => (e.id === 'worked' ? { ...e, on: false } : e)))).toBe('custom');
    expect(presetOf(defaultHighlights().map((e) => (e.id === 'cq' ? { ...e, colour: '#FF00FF' } : e)))).toBe('custom');
    expect(presetOf(moveBackground(defaultHighlights(), 6, 5))).toBe('custom');
    expect(presetOf(moveBackground(presetHighlights('quiet'), 6, 5))).toBe('custom');
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
