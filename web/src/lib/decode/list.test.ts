import { describe, expect, it } from 'vitest';
import { buildList, filterCounts, slotHeader, type SlotDecodes } from './list';

const T = Date.UTC(2026, 9, 13, 13, 14, 15);
const d = (text: string, freq_hz: number) => ({ text, freq_hz, dt_s: 0.1, snr_db: -10 });

const OLDER: SlotDecodes = { startUtcMs: T - 15000, mode: 'FT8', decodes: [d('CQ K1ABC FN42', 700)], ms: 410 };
const NEWER: SlotDecodes = {
  startUtcMs: T,
  mode: 'FT8',
  decodes: [d('CQ 9M2TRX OJ02', 1022), d('9V1NE JA1KXM PM95', 1418), d('JH1RRT YB0AZK RR73', 1505)],
  ms: 380,
};

describe('slotHeader', () => {
  it('gives the slot time, the count and the decode time', () => {
    expect(slotHeader(NEWER)).toBe('13:14:15 UTC · 3 decodes · decoded in 0.38 s');
    expect(slotHeader(OLDER)).toBe('13:14:00 UTC · 1 decode · decoded in 0.41 s');
    expect(slotHeader({ ...NEWER, decodes: [], skipped: true })).toBe('13:14:15 UTC · not decoded: the decoder was busy with earlier slots');
  });
});

describe('buildList', () => {
  it('puts the newest slot first, each under its header, with the rows marked', () => {
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1500);
    expect(items.map((i) => (i.kind === 'header' ? i.text.slice(0, 12) : `${i.row.mark ?? '-'} ${i.row.decode.text}`))).toEqual([
      '13:14:15 UTC',
      'cq CQ 9M2TRX OJ02',
      'me 9V1NE JA1KXM PM95',
      '- JH1RRT YB0AZK RR73',
      '13:14:00 UTC',
      'cq CQ K1ABC FN42',
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('shows the header of a slot with no decodes', () => {
    const items = buildList([{ ...NEWER, decodes: [] }], '', 'all', 1500);
    expect(items).toEqual([{ kind: 'header', id: `h${T}`, text: '13:14:15 UTC · 0 decodes · decoded in 0.38 s' }]);
  });

  it('filters to CQ calls, to my callsign, or to the receive frequency', () => {
    const texts = (f: 'cq' | 'me' | 'rx') => buildList([OLDER, NEWER], '9V1NE', f, 1500).flatMap((i) => (i.kind === 'row' ? [i.row.decode.text] : []));
    expect(texts('cq')).toEqual(['CQ 9M2TRX OJ02', 'CQ K1ABC FN42']);
    expect(texts('me')).toEqual(['9V1NE JA1KXM PM95']);
    expect(texts('rx')).toEqual(['JH1RRT YB0AZK RR73']);
    // A filtered list leaves out slots with nothing to show.
    expect(buildList([OLDER, NEWER], '9V1NE', 'me', 1500).filter((i) => i.kind === 'header')).toHaveLength(1);
  });

  it('counts decodes for each chip', () => {
    expect(filterCounts([OLDER, NEWER], '9V1NE', 1500)).toEqual({ all: 4, cq: 2, me: 1, rx: 1 });
    expect(filterCounts([OLDER, NEWER], '', 1500).me).toBe(0);
  });
});
