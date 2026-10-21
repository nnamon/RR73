import { describe, expect, it } from 'vitest';
import { buildList, filterCounts, outText, quietHeader, rowFacts, slotHeader, type Classify, type ListItem, type RowItem, type SlotDecodes } from './list';
import { defaultHighlights, highlightDecode } from './highlight';
import { buildLogIndex } from '../log/worked';

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
    expect(items[0]).toMatchObject({ kind: 'header', time: '13:14:30', detail: 'sent', parity: 'even' });
    const r = items[1];
    expect(r.kind === 'row' && r.row).toMatchObject({ mark: 'sent', key: 'JA1KXM', time: '13:14:30' });
    // A transmission in the slot before the newest decoded slot sorts below that slot's decodes.
    const earlier = buildList([NEWER], '9V1NE', 'all', 1500, [{ slotStartMs: T, text: 'CQ 9V1NE OJ11', freqHz: 1500 }]);
    expect(earlier.at(-1)).toMatchObject({ kind: 'row', id: `s${T}` });
    expect(buildList([], '9V1NE', 'cq', 1500, sent)).toEqual([]);
  });

  const rows = (items: ReturnType<typeof buildList>) => items.filter((i): i is RowItem => i.kind === 'row');

  it('puts the next transmission at the top as soon as it is planned, counting down to its slot', () => {
    const next = { slotStartMs: T + 15000, startMs: T + 15500, text: 'CQ 9V1NE OJ11', freqHz: 1500 };
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1500, [], 'FT8', undefined, { next });
    expect(items[0]).toMatchObject({ kind: 'header', time: '13:14:30', detail: 'next', parity: 'even' });
    const top = rows(items)[0];
    expect(top).toMatchObject({ id: `n${T + 15000}`, out: { stage: 'next', startMs: T + 15500 }, row: { mark: 'sent', hl: null } });
    expect(top.old).toBeFalsy();
    expect(outText(top.out!, top.slotStartMs, 1500, T + 9400)).toEqual({ tag: 'Next · :30', meta: 'in 7 s', progress: null });
    expect(outText(top.out!, top.slotStartMs, 1500, T + 16000).meta).toBe('in 0 s');
    // With the To me filter too, and never with CQ or Rx freq.
    expect(rows(buildList([NEWER], '9V1NE', 'me', 1500, [], 'FT8', undefined, { next }))[0].id).toBe(`n${T + 15000}`);
    expect(rows(buildList([NEWER], '9V1NE', 'cq', 1500, [], 'FT8', undefined, { next })).some((r) => r.out)).toBe(false);
  });

  it('turns the row to Sending with its progress on air, then Sent in its slot', () => {
    const sent = [{ slotStartMs: T + 15000, text: 'CQ 9V1NE OJ11', freqHz: 1500 }];
    const onAir = { slotStartMs: T + 15000, startMs: T + 15500, endMs: T + 15500 + 12640 };
    // The plan is gone once on air; a stale one for the same slot is not shown twice.
    const next = { slotStartMs: T + 15000, startMs: T + 15500, text: 'CQ 9V1NE OJ11', freqHz: 1500 };
    const sending = rows(buildList([OLDER, NEWER], '9V1NE', 'all', 1500, sent, 'FT8', undefined, { onAir, next }));
    expect(sending.filter((r) => r.out)).toHaveLength(1);
    expect(sending[0].out).toEqual({ stage: 'sending', startMs: onAir.startMs, endMs: onAir.endMs });
    expect(outText(sending[0].out!, T + 15000, 1500, T + 15500 + 6320)).toEqual({ tag: 'Sending', meta: '1500 Hz', progress: 0.5 });
    expect(outText(sending[0].out!, T + 15000, 1500, T + 40000).progress).toBe(1);
    const done = buildList([OLDER, NEWER], '9V1NE', 'all', 1500, sent);
    expect(done[0]).toMatchObject({ kind: 'header', detail: 'sent' });
    expect(rows(done)[0].out).toMatchObject({ stage: 'sent' });
    expect(outText(rows(done)[0].out!, T + 15000, 1499.6, T + 40000)).toEqual({ tag: 'Sent', meta: '1500 Hz', progress: null });
  });

  it('fades every slot older than the newest slot with decodes, our older transmissions included', () => {
    const sent = [
      { slotStartMs: T + 15000, text: 'CQ 9V1NE OJ11', freqHz: 1500 },
      { slotStartMs: T - 15000, text: 'CQ 9V1NE OJ11', freqHz: 1500 },
    ];
    const r = rows(buildList([OLDER, NEWER], '9V1NE', 'all', 1500, sent));
    expect(r.map((x) => `${x.old ? 'old' : 'new'} ${x.out?.stage ?? x.row.decode.text}`)).toEqual([
      'new sent',
      'new 9V1NE JA1KXM PM95',
      'new CQ 9M2TRX OJ02',
      'new JH1RRT YB0AZK RR73',
      'old CQ K1ABC FN42',
      'old sent',
    ]);
    // A slot the decoder skipped, or one with no decodes, leaves the slot before it at full contrast.
    expect(rows(buildList([OLDER, { ...NEWER, decodes: [], skipped: true }], '9V1NE', 'all', 1500))[0].old).toBe(false);
    expect(rows(buildList([OLDER, { ...NEWER, decodes: [] }], '9V1NE', 'all', 1500))[0].old).toBe(false);
  });
});

describe('buildList', () => {
  it('puts the newest slot first, each under its header, with the rows marked and messages to you first', () => {
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1500);
    expect(items.map((i) => (i.kind === 'header' ? i.text.slice(0, 12) : `${i.row.mark ?? '-'} ${i.row.decode.text}`))).toEqual([
      '13:14:15 UTC',
      'me 9V1NE JA1KXM PM95',
      'cq CQ 9M2TRX OJ02',
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
    expect(filterCounts([OLDER, NEWER], '9V1NE', 1500)).toEqual({ all: 4, cq: 2, new: 0, me: 1, rx: 1 });
    expect(filterCounts([OLDER, NEWER], '', 1500).me).toBe(0);
  });
});

describe('the New filter and Hide worked', () => {
  // 9M2TRX is in the log on 20m FT8; RR73's decode colours.
  const index = buildLogIndex([{ call: '9M2TRX', gridsquare: 'OJ02', band: '20m', mode: 'FT8', submode: '' }]);
  const classify: Classify = (dec, sent) => highlightDecode({ text: dec.text, sent }, '9V1NE', index, { band: '20m', mode: 'FT8' }, defaultHighlights());
  const LATEST: SlotDecodes = { startUtcMs: T + 15000, mode: 'FT8', decodes: [d('JA1KXM 9M2TRX 73', 900), d('9V1NE 9M2TRX R-10', 1500)], ms: 300 };
  const texts = (items: ListItem[]) => items.flatMap((i) => (i.kind === 'row' ? [i.row.decode.text] : []));

  it('shows the decodes an enabled new category matches, whichever colour won', () => {
    expect(texts(buildList([OLDER, NEWER, LATEST], '9V1NE', 'new', 1500, [], 'FT8', classify))).toEqual(['JH1RRT YB0AZK RR73', 'CQ K1ABC FN42']);
    // With CQ above New call in the order, the CQ keeps its colour and still counts as new.
    const cqFirst = defaultHighlights().sort((a, b) => (a.id === 'cq' ? -1 : b.id === 'cq' ? 1 : 0));
    const byCq: Classify = (dec, sent) => highlightDecode({ text: dec.text, sent }, '9V1NE', index, { band: '20m', mode: 'FT8' }, cqFirst);
    const rows = buildList([OLDER], '9V1NE', 'new', 1500, [], 'FT8', byCq).filter((i): i is RowItem => i.kind === 'row');
    expect(rows.map((r) => [r.row.decode.text, r.row.hl])).toEqual([['CQ K1ABC FN42', 'cq']]);
    // With the new categories off, nothing is new.
    const off: Classify = (dec, sent) => highlightDecode({ text: dec.text, sent }, '9V1NE', index, { band: '20m', mode: 'FT8' }, defaultHighlights().map((e) => ({ ...e, on: false })));
    expect(texts(buildList([OLDER, NEWER], '9V1NE', 'new', 1500, [], 'FT8', off))).toEqual([]);
  });

  it('hides stations in the log on this band and mode, but their messages to me, and counts what shows', () => {
    const all = (hideWorked: boolean) => texts(buildList([OLDER, NEWER, LATEST], '9V1NE', 'all', 1500, [], 'FT8', classify, {}, { hideWorked }));
    expect(all(false)).toContain('CQ 9M2TRX OJ02');
    expect(all(true)).toEqual(['9V1NE 9M2TRX R-10', '9V1NE JA1KXM PM95', 'JH1RRT YB0AZK RR73', 'CQ K1ABC FN42']);
    // Worked before off in the colours changes nothing here.
    const noInk: Classify = (dec, sent) => highlightDecode({ text: dec.text, sent }, '9V1NE', index, { band: '20m', mode: 'FT8' }, defaultHighlights().map((e) => ({ ...e, on: e.id !== 'worked' })));
    expect(texts(buildList([NEWER], '9V1NE', 'cq', 1500, [], 'FT8', noInk, {}, { hideWorked: true }))).toEqual([]);
    expect(filterCounts([OLDER, NEWER, LATEST], '9V1NE', 1500, { classify })).toEqual({ all: 6, cq: 2, new: 2, me: 2, rx: 2 });
    expect(filterCounts([OLDER, NEWER, LATEST], '9V1NE', 1500, { classify, hideWorked: true })).toEqual({ all: 4, cq: 1, new: 2, me: 2, rx: 2 });
  });

  it('leaves out a slot Hide worked empties', () => {
    const only: SlotDecodes = { startUtcMs: T + 15000, mode: 'FT8', decodes: [d('CQ 9M2TRX OJ02', 900)], ms: 300 };
    const items = buildList([OLDER, only], '9V1NE', 'all', 1500, [], 'FT8', classify, {}, { hideWorked: true });
    expect(items.filter((i) => i.kind === 'header').map((i) => i.id)).toEqual([`h${T - 15000}`]);
  });
});

describe('buildList with messages to you', () => {
  const rows = (items: ListItem[]) => items.filter((i): i is RowItem => i.kind === 'row');
  const slot = (startUtcMs: number, texts: string[]): SlotDecodes => ({ startUtcMs, mode: 'FT8', decodes: texts.map((t, i) => d(t, 500 + 100 * i)), ms: 40 });

  it('puts messages to you first within their slot, the rest in the decoder\'s order', () => {
    const s = slot(T, ['CQ K1ABC FN42', '9V1NE JA1KXM -09', 'JA1KXM 9V1NE R-14', 'JH1RRT YB0AZK RR73', '9V1NE/P ZL1TQK RF73', 'CQ 9V1NE OJ11']);
    const r = rows(buildList([s], 'VK3/9V1NE', 'all', 1500));
    expect(r.map((x) => `${x.toYou ? 'to you' : '-'} ${x.row.decode.text}`)).toEqual([
      'to you 9V1NE JA1KXM -09',
      'to you 9V1NE/P ZL1TQK RF73',
      '- CQ K1ABC FN42',
      '- JA1KXM 9V1NE R-14',
      '- JH1RRT YB0AZK RR73',
      '- CQ 9V1NE OJ11',
    ]);
    // A row keeps the id of its place in the decoder's order.
    expect(r.map((x) => x.id)).toEqual([1, 4, 0, 2, 3, 5].map((i) => `${T}-${i}`));
  });

  it('sorts within each slot only, in every filter that shows them', () => {
    const items = buildList([slot(T, ['CQ K1ABC FN42', '9V1NE JA1KXM -09']), slot(T - 15_000, ['CQ VJ6X OF78', '9V1NE VJ6X -12'])], '9V1NE', 'all', 1500);
    expect(items.map((i) => (i.kind === 'header' ? i.time : i.row.decode.text))).toEqual(['13:14:15', '9V1NE JA1KXM -09', 'CQ K1ABC FN42', '13:14:00', '9V1NE VJ6X -12', 'CQ VJ6X OF78']);
    expect(rows(buildList([slot(T, ['JA1KXM 9V1NE R-14', '9V1NE JA1KXM -09'])], '9V1NE', 'me', 1500)).map((x) => x.row.decode.text)).toEqual(['9V1NE JA1KXM -09', 'JA1KXM 9V1NE R-14']);
    expect(rows(buildList([slot(T, ['CQ K1ABC FN42', '9V1NE JA1KXM -09'])], '9V1NE', 'rx', 600))[0]).toMatchObject({ toYou: true });
  });

  it('marks nothing without a callsign, and never our own rows', () => {
    expect(rows(buildList([slot(T, ['CQ K1ABC FN42', '9V1NE JA1KXM -09'])], '', 'all', 1500)).some((x) => x.toYou)).toBe(false);
    const sent = [{ slotStartMs: T + 15_000, text: 'JA1KXM 9V1NE R-14', freqHz: 1500 }];
    expect(rows(buildList([], '9V1NE', 'all', 1500, sent))[0].toYou).toBeUndefined();
  });
});

describe('buildList with runs of empty slots', () => {
  const empty = (startUtcMs: number, mode: 'FT8' | 'FT4' = 'FT8'): SlotDecodes => ({ startUtcMs, mode, decodes: [], ms: 30 });
  const full = (startUtcMs: number, mode: 'FT8' | 'FT4' = 'FT8'): SlotDecodes => ({ startUtcMs, mode, decodes: [d('CQ K1ABC FN42', 700)], ms: 30 });
  const bars = (items: ListItem[]) => items.map((i) => (i.kind === 'header' ? `${i.time}${i.until ? ` to ${i.until}` : ''} ${i.detail}` : 'row'));
  const S = 15_000;

  it('gives a run one bar with its span, and no parity', () => {
    expect(quietHeader(T - 5 * S, T)).toEqual({ kind: 'header', id: `hq${T - 5 * S}`, time: '13:13:00', until: '13:14:15', detail: 'no decodes', parity: null, text: '13:13:00 to 13:14:15 UTC · no decodes' });
  });

  it('keeps a single empty slot as its own bar', () => {
    expect(bars(buildList([full(T), empty(T - S), full(T - 2 * S)], '9V1NE', 'all', 1500))).toEqual(['13:14:15 1 decode', 'row', '13:14:00 0 decodes', '13:13:45 1 decode', 'row']);
  });

  it('collapses runs between slots with decodes', () => {
    const slots = [full(T), empty(T - S), empty(T - 2 * S), empty(T - 3 * S), full(T - 4 * S), empty(T - 5 * S), empty(T - 6 * S), full(T - 7 * S)];
    expect(bars(buildList(slots, '9V1NE', 'all', 1500))).toEqual([
      '13:14:15 1 decode',
      'row',
      '13:13:30 to 13:14:00 no decodes',
      '13:13:15 1 decode',
      'row',
      '13:12:45 to 13:13:00 no decodes',
      '13:12:30 1 decode',
      'row',
    ]);
  });

  it('collapses a run at the top and one at the bottom of the list', () => {
    const slots = [empty(T + 2 * S), empty(T + S), full(T), empty(T - S), empty(T - 2 * S)];
    expect(bars(buildList(slots, '9V1NE', 'all', 1500))).toEqual(['13:14:30 to 13:14:45 no decodes', '13:14:15 1 decode', 'row', '13:13:45 to 13:14:00 no decodes']);
  });

  it('shows one bar when every slot is empty', () => {
    const items = buildList([0, 1, 2, 3, 4, 5].map((i) => empty(T - i * S)), '9V1NE', 'all', 1500);
    expect(bars(items)).toEqual(['13:13:00 to 13:14:15 no decodes']);
    expect(items[0]).toMatchObject({ parity: null, id: `hq${T - 5 * S}` });
  });

  it('collapses FT4 slots 7.5 s apart', () => {
    const F = 7_500;
    const slots = [full(T + 3 * F, 'FT4'), empty(T + 2 * F, 'FT4'), empty(T + F, 'FT4'), empty(T, 'FT4'), full(T - F, 'FT4')];
    expect(bars(buildList(slots, '9V1NE', 'all', 1500, [], 'FT4'))).toEqual(['13:14:37 1 decode', 'row', '13:14:15 to 13:14:30 no decodes', '13:14:07 1 decode', 'row']);
    // 15 s apart in FT4 is a gap.
    expect(bars(buildList([empty(T + 2 * F, 'FT4'), empty(T, 'FT4')], '9V1NE', 'all', 1500, [], 'FT4'))).toEqual(['13:14:30 0 decodes', '13:14:15 0 decodes']);
  });

  it('ends a run at a gap in time, a skipped slot or a change of mode', () => {
    expect(bars(buildList([empty(T), empty(T - 2 * S), empty(T - 3 * S)], '9V1NE', 'all', 1500))).toEqual(['13:14:15 0 decodes', '13:13:30 to 13:13:45 no decodes']);
    const skipped: SlotDecodes = { ...empty(T - S), skipped: true };
    expect(bars(buildList([empty(T), skipped, empty(T - 2 * S), empty(T - 3 * S)], '9V1NE', 'all', 1500))).toEqual([
      '13:14:15 0 decodes',
      '13:14:00 not decoded: the decoder was busy',
      '13:13:30 to 13:13:45 no decodes',
    ]);
    expect(bars(buildList([empty(T, 'FT4'), empty(T - S)], '9V1NE', 'all', 1500))).toEqual(['13:14:15 0 decodes', '13:14:00 0 decodes']);
  });

  it('never folds a slot holding our own row, which splits the run', () => {
    // Sent in T - 2S, with the slots on both sides empty.
    const slots = [empty(T + S), empty(T), empty(T - S), empty(T - 3 * S), empty(T - 4 * S)];
    const sent = [{ slotStartMs: T - 2 * S, text: 'CQ 9V1NE OJ11', freqHz: 1500 }];
    expect(bars(buildList(slots, '9V1NE', 'all', 1500, sent))).toEqual(['13:14:00 to 13:14:30 no decodes', '13:13:45 sent', 'row', '13:13:15 to 13:13:30 no decodes']);
    // An empty slot at the start of our own row keeps its bar; so do Next and Sending.
    const ours = [empty(T + S), empty(T), empty(T - S)];
    expect(bars(buildList(ours, '9V1NE', 'all', 1500, [{ slotStartMs: T, text: 'CQ 9V1NE OJ11', freqHz: 1500 }]))).toEqual(['13:14:30 0 decodes', '13:14:15 0 decodes', '13:14:15 sent', 'row', '13:14:00 0 decodes']);
    const next = { slotStartMs: T, startMs: T + 500, text: 'CQ 9V1NE OJ11', freqHz: 1500 };
    expect(bars(buildList(ours, '9V1NE', 'all', 1500, [], 'FT8', undefined, { next }))).toEqual(['13:14:30 0 decodes', '13:14:15 0 decodes', '13:14:15 next', 'row', '13:14:00 0 decodes']);
    const onAir = { slotStartMs: T, startMs: T + 500, endMs: T + 13_140 };
    const sending = buildList(ours, '9V1NE', 'all', 1500, [{ slotStartMs: T, text: 'CQ 9V1NE OJ11', freqHz: 1500 }], 'FT8', undefined, { onAir });
    expect(bars(sending)).toContain('13:14:15 sending');
    expect(bars(sending).filter((b) => b.includes(' to '))).toEqual([]);
  });

  it('leaves empty slots out with a filter, as before', () => {
    expect(buildList([empty(T), empty(T - S), full(T - 2 * S)], '9V1NE', 'cq', 1500).filter((i) => i.kind === 'header')).toHaveLength(1);
  });

  it('gives every item a unique id', () => {
    const slots = [empty(T + 2 * S), empty(T + S), full(T), empty(T - S), empty(T - 2 * S), full(T - 3 * S)];
    const items = buildList(slots, '9V1NE', 'all', 1500, [{ slotStartMs: T - 4 * S, text: 'CQ 9V1NE OJ11', freqHz: 1500 }]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe('buildList for the panes of regular width', () => {
  const rows = (items: ListItem[]) => items.filter((i): i is RowItem => i.kind === 'row');
  const sent = [{ slotStartMs: T + 15000, text: 'JA1KXM 9V1NE R-10', freqHz: 1500 }];
  const next = { slotStartMs: T + 30000, startMs: T + 30500, text: 'JA1KXM 9V1NE RR73', freqHz: 1500 };

  it('gives Band activity every decode and a grey Tx slot bar for each slot we sent in', () => {
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1500, sent, 'FT8', undefined, { next }, { own: 'bar' });
    expect(rows(items).some((r) => r.out)).toBe(false);
    expect(rows(items)).toHaveLength(4);
    expect(items[0]).toEqual({ kind: 'header', id: `ht${T + 15000}`, time: '13:14:30', detail: 'Tx slot', parity: null, text: '13:14:30 UTC · Tx slot' });
    // The slot on air gets no bar until it is over.
    const onAir = { slotStartMs: T + 15000, startMs: T + 15500, endMs: T + 28140 };
    expect(buildList([NEWER], '9V1NE', 'all', 1500, sent, 'FT8', undefined, { onAir }, { own: 'bar' })[0]).toMatchObject({ id: `h${T}` });
    // With a filter, the bar stays: the slot still went out.
    expect(buildList([OLDER, NEWER], '9V1NE', 'cq', 1500, sent, 'FT8', undefined, {}, { own: 'bar' })[0]).toMatchObject({ detail: 'Tx slot' });
  });

  it('gives Rx frequency the decodes within 50 Hz of Rx, messages to you and our own rows, counted per slot', () => {
    const items = buildList([OLDER, NEWER], '9V1NE', 'all', 1460, sent, 'FT8', undefined, { next }, { rxPane: true });
    const texts = rows(items).map((r) => r.row.decode.text);
    // 1505 Hz is 45 Hz from Rx; 9V1NE JA1KXM is to you at 1418 Hz; 1022 and 700 Hz are out.
    expect(texts).toEqual(['JA1KXM 9V1NE RR73', 'JA1KXM 9V1NE R-10', '9V1NE JA1KXM PM95', 'JH1RRT YB0AZK RR73']);
    expect(items.find((i) => i.kind === 'header' && i.id === `h${T}`)).toMatchObject({ detail: '2 decodes', parity: 'odd' });
    // A slot with nothing near Rx leaves no bar.
    expect(items.some((i) => i.kind === 'header' && i.id === `h${T - 15000}`)).toBe(false);
    expect(rows(items)[0].out?.stage).toBe('next');
  });
});

describe('rowFacts', () => {
  it('classifies each decode once across rebuilds of the list and the counts', () => {
    let calls = 0;
    const classify: Classify = () => {
      calls++;
      return { bg: null, ink: null, isNew: false, worked: false };
    };
    const facts = rowFacts('9V1NE', classify);
    for (let i = 0; i < 3; i++) {
      buildList([OLDER, NEWER], '9V1NE', 'all', 1500, [], 'FT8', classify, {}, { facts });
      filterCounts([OLDER, NEWER], '9V1NE', 1500 + i, { facts });
    }
    expect(calls).toBe(4);
    // A new slot adds only its own decodes.
    buildList([OLDER, NEWER, { ...NEWER, startUtcMs: T + 15000, decodes: [d('CQ VK2LAW QF56', 900)] }], '9V1NE', 'all', 1500, [], 'FT8', classify, {}, { facts });
    expect(calls).toBe(5);
  });
});

describe('Sort decodes', () => {
  it('lists messages to us, then CQs, then calls, reports and endings, each by frequency', () => {
    const d = (text: string, freq_hz: number) => ({ text, freq_hz, dt_s: 0.1, snr_db: -10 });
    const slot: SlotDecodes = { startUtcMs: Date.UTC(2026, 9, 21, 12, 0, 0), mode: 'FT8', ms: 100, decodes: [d('K1ABC JA1KXM -05', 900), d('CQ VK2LAW QF56', 1500), d('9V1NE ZL1BB RF72', 1400), d('DL1AB F5XY RR73', 300), d('CQ JA6BBM PM51', 700), d('9V1NE K1ABC FN42', 600)] };
    const texts = (sorted: boolean) =>
      buildList([slot], '9V1NE', 'all', 1500, [], 'FT8', undefined, {}, { sorted })
        .filter((i) => i.kind === 'row')
        .map((i) => (i as { row: { decode: { text: string } } }).row.decode.text);
    expect(texts(true)).toEqual(['9V1NE K1ABC FN42', '9V1NE ZL1BB RF72', 'CQ JA6BBM PM51', 'CQ VK2LAW QF56', 'K1ABC JA1KXM -05', 'DL1AB F5XY RR73']);
    // Off: messages to us first, the rest in the decoder's order.
    expect(texts(false)).toEqual(['9V1NE ZL1BB RF72', '9V1NE K1ABC FN42', 'K1ABC JA1KXM -05', 'CQ VK2LAW QF56', 'DL1AB F5XY RR73', 'CQ JA6BBM PM51']);
  });
});
