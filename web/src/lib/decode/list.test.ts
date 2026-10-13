import { describe, expect, it } from 'vitest';
import { buildList, callerItems, filterCounts, slotHeader, type SlotDecodes } from './list';
import type { Caller } from '../qso/sequencer';

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
  it('gives the slot time, the count and the parity', () => {
    expect(slotHeader(NEWER)).toEqual({ kind: 'header', id: `h${T}`, time: '13:14:15', detail: '3 decodes', parity: 'odd', text: '13:14:15 UTC · 3 decodes', ms: 380 });
    expect(slotHeader(OLDER)).toMatchObject({ time: '13:14:00', detail: '1 decode', parity: 'even' });
    expect(slotHeader({ ...NEWER, decodes: [], skipped: true }).detail).toBe('not decoded: the decoder was busy');
  });
});

describe('buildList with our transmissions', () => {
  it('shows what we sent as an amber row between the slots, by time', () => {
    const sent = [{ slotStartMs: T + 15000, text: 'JA1KXM 9V1NE R-10', freqHz: 1500 }];
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1500, sent);
    const sentAt = items.findIndex((i) => i.kind === 'row' && i.row.mark === 'sent');
    expect(sentAt).toBe(1);
    expect(items[0]).toMatchObject({ kind: 'header', time: '13:14:30', detail: 'you sent', parity: 'even' });
    const r = items[1];
    expect(r.kind === 'row' && r.row).toMatchObject({ mark: 'sent', key: 'JA1KXM', time: '13:14:30' });
    // A transmission in the slot before the newest decoded slot sorts below that slot's decodes.
    const earlier = buildList([NEWER], '9V1NE', 'all', 1500, [{ slotStartMs: T, text: 'CQ 9V1NE OJ11', freqHz: 1500 }]);
    expect(earlier.at(-1)).toMatchObject({ kind: 'row', id: `s${T}` });
    expect(buildList([], '9V1NE', 'cq', 1500, sent)).toEqual([]);
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
    expect(items).toEqual([{ kind: 'header', id: `h${T}`, time: '13:14:15', detail: '0 decodes', parity: 'odd', text: '13:14:15 UTC · 0 decodes', ms: 380 }]);
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

describe('callerItems', () => {
  const caller = (call: string, over: Partial<Caller> = {}): Caller => ({
    call,
    grid: 'FN42',
    kind: 'grid',
    report: null,
    snrDb: -12,
    dtS: 0.2,
    freqHz: 2341,
    heardMs: T,
    seq: 0,
    dupe: false,
    isNew: true,
    distanceKm: null,
    ...over,
  });
  const show = (items: ReturnType<typeof callerItems>) => items.map((i) => (i.kind === 'header' ? `[${i.time} ${i.detail}]` : `${i.row.decode.text} ${i.row.meta}`));

  it('lists the station worked, then the queue as Next, 3rd', () => {
    const slots: SlotDecodes[] = [{ startUtcMs: T, mode: 'FT8', decodes: [d('9V1NE K1ABC R-15', 2341), d('9V1NE ZL1TQK RF73', 2430), d('CQ JA1KXM PM95', 900)], ms: 40 }];
    const working = { call: 'K1ABC', grid: 'FN42', snrDb: -12, dtS: 0.2, freqHz: 2341 };
    const items = callerItems(slots, '9V1NE', 'FT8', working, [caller('ZL1TQK'), caller('DU1XYZ', { grid: 'PK04', heardMs: T - 30_000 })], false);
    expect(show(items)).toEqual(['[13:14:15 callers, in answering order]', '9V1NE K1ABC R-15 Working', '9V1NE ZL1TQK RF73 Next', '9V1NE DU1XYZ PK04 3rd']);
    expect(items.slice(1).every((i) => i.kind === 'row' && i.row.mark === 'me')).toBe(true);
  });

  it('marks dupes and skips them in the order unless dupes are worked', () => {
    const q = [caller('W1AW', { dupe: true }), caller('VK2ESN', { kind: 'report', report: -7, grid: null })];
    expect(show(callerItems([], '9V1NE', 'FT8', null, q, false)).slice(1)).toEqual(['9V1NE W1AW FN42 Dupe', '9V1NE VK2ESN -07 Next']);
    expect(show(callerItems([], '9V1NE', 'FT8', null, q, true)).slice(1)).toEqual(['9V1NE W1AW FN42 Next', '9V1NE VK2ESN -07 2nd']);
  });

  it('is empty when nobody calls', () => {
    expect(callerItems([], '9V1NE', 'FT8', null, [], false)).toEqual([]);
  });
});
