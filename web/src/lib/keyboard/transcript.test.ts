import { describe, expect, it } from 'vitest';
import { KEEP_LINES, Transcript, type TextLine } from './transcript';
import { callColour, tokens } from './render';
import { buildLogIndex } from '../log/worked';
import { defaultHighlights } from '../decode/highlight';
import { DxccIndex } from '../reference/dxcc';
import { bigCtyFixture } from '../reference/testing';

const T = Date.UTC(2026, 9, 14, 14, 4, 0);

function type(t: Transcript, text: string, kind: 'r' | 'u' | 't', atMs: number) {
  for (const ch of text) t.add(ch, kind, atMs);
}

const texts = (t: Transcript) => t.lines.map((l) => l.text);

describe('the received text', () => {
  it('opens with the time, starts a line at each line feed and prints no CR, BELL or WRU', () => {
    const t = new Transcript();
    type(t, 'CQ CQ\r\nDE JA1XYZ\u0007\u0005', 'r', T);
    expect(texts(t)).toEqual(['14:04', 'CQ CQ', 'DE JA1XYZ']);
  });

  it('adds a divider after 20 s with nothing sent or received, and at a change of band', () => {
    const t = new Transcript();
    type(t, 'PSE K', 'r', T);
    type(t, 'K', 'r', T + 19_000);
    type(t, 'RYRY', 'r', T + 40_000);
    t.divider('40m · 7.0400');
    type(t, 'CQ', 'r', T + 41_000);
    expect(texts(t)).toEqual(['14:04', 'PSE KK', '14:04', 'RYRY', '40m · 7.0400', 'CQ']);
  });

  it('keeps sent and received text in order, and gives received runs apart from sent ones', () => {
    const t = new Transcript();
    type(t, 'JA1XYZ DE ', 'r', T);
    type(t, 'X', 'u', T);
    type(t, 'Q', 'r', T);
    type(t, '\nJA1XYZ DE 9V1NE K', 't', T + 1000);
    type(t, '\nR R NAME TARO', 'r', T + 5000);
    const lines = t.lines.filter((l): l is TextLine => l.kind === 'text');
    expect(lines.map((l) => l.kinds)).toEqual(['rrrrrrrrrrur', 't'.repeat(17), 'r'.repeat(13)]);
    expect(t.rxSince(T).map((r) => r.text)).toEqual(['JA1XYZ DE �Q', 'R R NAME TARO']);
    expect(t.atLineStart).toBe(false);
  });

  it('keeps the newest 2000 lines', () => {
    const t = new Transcript();
    for (let i = 0; i < KEEP_LINES + 10; i++) type(t, `L${i}\n`, 'r', T);
    expect(t.lines.length).toBe(KEEP_LINES);
    expect(t.lines.at(-2)?.text).toBe(`L${KEEP_LINES + 9}`);
    t.clear();
    expect(t.lines).toEqual([]);
  });
});

describe('words on screen', () => {
  const line = (text: string, kinds: string): TextLine => ({ id: 1, kind: 'text', text, kinds, firstMs: T, lastMs: T });

  it('marks received callsigns with every character certain, and lets any received word be tapped', () => {
    const text = '9V1NE DE JA1XYZ. E3TQ 599';
    const kinds = [...text].map((_, i) => (i === text.indexOf('3TQ') ? 'u' : 'r')).join('');
    const tk = tokens(line(text, kinds), null);
    const words = tk.filter((x) => !x.space);
    expect(words.map((w) => [w.text, w.call, w.rx])).toEqual([
      ['9V1NE', '9V1NE', true],
      ['DE', null, true],
      ['JA1XYZ.', 'JA1XYZ', true],
      ['E3TQ', null, true],
      ['599', null, true],
    ]);
    expect(tokens(line('JA1XYZ', 'tttttt'), null)[0]).toMatchObject({ call: null, rx: false });
    expect(tokens(line('AB', 'rt'), null)[0].runs).toEqual([
      { text: 'A', kind: 'r' },
      { text: 'B', kind: 't' },
    ]);
  });

  it('gives a callsign the decode colours: my call, new call, worked before', () => {
    const index = buildLogIndex([
      { call: 'JA1XYZ', gridsquare: '', band: '20m', mode: 'RTTY', submode: '' },
      { call: 'BV2KQ', gridsquare: '', band: '40m', mode: 'FT8', submode: '' },
    ]);
    const entries = defaultHighlights();
    const colour = (c: string) => callColour(c, '9V1NE', index, '20m', 'RTTY', entries);
    expect(colour('9V1NE')).toEqual({ bg: entries.find((e) => e.id === 'myCall')!.colour, worked: false });
    expect(colour('OH2BAX')).toEqual({ bg: entries.find((e) => e.id === 'newCall')!.colour, worked: false });
    expect(colour('BV2KQ')).toEqual({ bg: entries.find((e) => e.id === 'newCallBand')!.colour, worked: false });
    expect(colour('JA1XYZ')).toEqual({ bg: null, worked: true });
    const off = entries.map((e) => ({ ...e, on: false }));
    expect(callColour('OH2BAX', '9V1NE', index, '20m', 'RTTY', off)).toEqual({ bg: null, worked: false });
  });

  it('gives a callsign the DXCC, continent and zone colours from the country file', () => {
    const cty = DxccIndex.fromJson(JSON.parse(JSON.stringify(bigCtyFixture())));
    const index = buildLogIndex([{ call: 'JA1XYZ', gridsquare: '', band: '20m', mode: 'RTTY', submode: '' }], cty);
    const entries = defaultHighlights();
    const colour = (c: string, band = '20m') => callColour(c, '9V1NE', index, band, 'RTTY', entries).bg;
    const of = (id: string) => entries.find((e) => e.id === id)!.colour;
    expect(colour('OH2BAX')).toBe(of('newDxcc'));
    expect(colour('JA2ABC')).toBe(of('newCall'));
    expect(colour('JA1XYZ', '40m')).toBe(of('newCallBand'));
    expect(callColour('JA1XYZ', '9V1NE', index, '40m', 'RTTY', entries.map((e) => ({ ...e, on: e.id === 'newDxccBand' }))).bg).toBe(of('newDxccBand'));
    expect(colour('9V1NE')).toBe(of('myCall'));
  });
});
