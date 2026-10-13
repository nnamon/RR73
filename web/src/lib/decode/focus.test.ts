import { describe, expect, it } from 'vitest';
import { applyFocus, focusCall, mentions, related, toYou } from './focus';
import { buildList, callerItems, type ListItem, type RowItem, type SlotDecodes } from './list';
import { Sim, decode } from '../testing/qso-sim';

describe('toYou', () => {
  it('is true when the operator is the addressee, by base call', () => {
    expect(toYou('9V1NE JA1KXM PM95', '9V1NE')).toBe(true);
    expect(toYou('9V1NE JA1KXM RR73', '9v1ne')).toBe(true);
    // Portable forms on either side.
    expect(toYou('9V1NE JA1KXM -09', 'VK3/9V1NE')).toBe(true);
    expect(toYou('9V1NE/P JA1KXM -09', '9V1NE')).toBe(true);
    expect(toYou('VK3/9V1NE JA1KXM R-09', '9V1NE/P')).toBe(true);
    // A hashed call, and free text that starts with the call.
    expect(toYou('<9V1NE> JA1KXM RR73', '9V1NE')).toBe(true);
    expect(toYou('9V1NE TNX 73 GL', '9V1NE')).toBe(true);
  });

  it('reads both halves of a DXpedition message', () => {
    expect(toYou('K1ABC RR73; 9V1NE <KH1/KH7Z> -08', '9V1NE')).toBe(true);
    expect(toYou('9V1NE RR73; K1ABC <KH1/KH7Z> -08', '9V1NE')).toBe(true);
    expect(toYou('K1ABC RR73; W9XYZ <KH1/KH7Z> -08', '9V1NE')).toBe(false);
  });

  it('is false for CQ, for messages from the operator and for other stations', () => {
    expect(toYou('CQ 9V1NE OJ11', '9V1NE')).toBe(false);
    expect(toYou('JA1KXM 9V1NE R-14', '9V1NE')).toBe(false);
    expect(toYou('JA1KXM K1ABC -10', '9V1NE')).toBe(false);
    // Another call that shares the base call's letters is a different station.
    expect(toYou('9V1NEX JA1KXM -10', '9V1NE')).toBe(false);
    expect(toYou('9V1NE JA1KXM PM95', '')).toBe(false);
    expect(toYou('9V1NE JA1KXM PM95', '  ')).toBe(false);
  });
});

describe('mentions', () => {
  it('finds the station as sender or addressee, by base call', () => {
    expect(mentions('CQ VJ6X OF78', 'VJ6X')).toBe(true);
    expect(mentions('9V1NE VJ6X -12', 'VJ6X')).toBe(true);
    expect(mentions('VJ6X K1ABC R-05', 'VJ6X')).toBe(true);
    expect(mentions('K1ABC VJ6X/P RR73', 'VJ6X')).toBe(true);
    expect(mentions('K1ABC <VJ6X> 73', 'VJ6X')).toBe(true);
    expect(mentions('VJ6X RR73; K1ABC <KH1/KH7Z> -08', 'VJ6X')).toBe(true);
    expect(mentions('K1ABC RR73; VJ6X <KH1/KH7Z> -08', 'VJ6X')).toBe(true);
  });

  it('ignores other stations, grids and reports', () => {
    expect(mentions('CQ VJ6XA OF78', 'VJ6X')).toBe(false);
    expect(mentions('JA1KXM K1ABC OF78', 'VJ6X')).toBe(false);
    expect(mentions('JA1KXM K1ABC OF78', 'OF78')).toBe(false);
    expect(mentions('CQ VJ6X OF78', '')).toBe(false);
  });
});

describe('focusCall', () => {
  it('is null while receiving and while calling CQ with no partner', () => {
    const s = new Sim();
    expect(focusCall(s.st)).toBeNull();
    s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
    s.run(0, 2);
    expect(s.st).toMatchObject({ phase: 'cq', txEnabled: true, partner: null });
    expect(focusCall(s.st)).toBeNull();
  });

  it('follows a station from the call to the end of the QSO', () => {
    const s = new Sim();
    s.hear(1, ['CQ JA1KXM PM95']);
    s.call(1, 'CQ JA1KXM PM95');
    expect(focusCall(s.st)).toBe('JA1KXM');
    s.run(2, 2);
    s.run(3, 5, { 3: ['9V1NE JA1KXM -09'] });
    expect(focusCall(s.st)).toBe('JA1KXM');
    s.run(5, 6, { 5: ['9V1NE JA1KXM RR73'] });
    expect(s.st).toMatchObject({ phase: 'idle', partner: null });
    expect(focusCall(s.st)).toBeNull();
  });

  it('ends when Tx goes off, and comes back with Tx on', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.send({ type: 'enableTx', on: false, nowMs: s.at(2, 1) });
    expect(s.st.partner?.call).toBe('JA1KXM');
    expect(focusCall(s.st)).toBeNull();
    s.send({ type: 'enableTx', on: true, nowMs: s.at(2, 2) });
    expect(focusCall(s.st)).toBe('JA1KXM');
  });

  it('holds while the last transmission is on air after Tx goes off', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    const p = s.pending!;
    s.send({ type: 'txStarted', slotStartMs: p.slotStartMs, text: p.text, nowMs: p.slotStartMs + 500 });
    s.send({ type: 'enableTx', on: false, nowMs: p.slotStartMs + 3000 });
    expect(focusCall(s.st)).toBe('JA1KXM');
    s.send({ type: 'txEnded', slotStartMs: p.slotStartMs, text: p.text, complete: true, nowMs: p.slotStartMs + 13_140 });
    expect(focusCall(s.st)).toBeNull();
  });

  it('ends when calling gives up after the repeats', () => {
    const s = new Sim();
    s.call(1, 'CQ JA1KXM PM95');
    s.run(2, 12);
    expect(s.st).toMatchObject({ paused: true, txEnabled: true });
    expect(focusCall(s.st)).toBeNull();
  });

  it('follows the caller worked from CQ, and the station Hunt calls', () => {
    const run = new Sim({ run: true });
    run.send({ type: 'callCq', nowMs: run.at(0, 0.1) });
    run.run(0, 1, { 1: ['9V1NE K1ABC FN42'] });
    expect(focusCall(run.st)).toBe('K1ABC');

    const hunt = new Sim();
    hunt.send({ type: 'hunt', on: true, nowMs: hunt.at(0, 5) });
    expect(focusCall(hunt.st)).toBeNull();
    hunt.hear(1, ['CQ JA1KXM PM95']);
    expect(focusCall(hunt.st)).toBe('JA1KXM');
  });
});

describe('applyFocus', () => {
  const T = Date.UTC(2026, 9, 13, 13, 14, 15);
  const d = (text: string, freq_hz = 1200) => decode(text, -10, freq_hz);
  const SLOTS: SlotDecodes[] = [
    { startUtcMs: T, mode: 'FT8', decodes: [d('CQ K1ABC FN42'), d('VJ6X JA1KXM -05'), d('9V1NE VJ6X -12'), d('JA1KXM 9V1NE R-14'), d('9V1NE ZL1TQK RF73')], ms: 40 },
    { startUtcMs: T - 15_000, mode: 'FT8', decodes: [d('CQ VJ6X OF78'), d('BH1LKO VK4SHG 73')], ms: 40 },
  ];
  const sent = [{ slotStartMs: T - 30_000, text: 'CQ 9V1NE OJ11', freqHz: 1500 }];
  const next = { slotStartMs: T + 15_000, startMs: T + 15_500, text: 'VJ6X 9V1NE R-12', freqHz: 1500 };
  const list = () => buildList(SLOTS, '9V1NE', 'all', 1500, sent, 'FT8', undefined, { next });
  const shown = (items: ListItem[]) => items.map((i) => (i.kind === 'header' ? `[${i.detail}]` : `${i.dim ? 'dim' : 'clear'} ${i.out?.stage ?? i.row.decode.text}`));

  it('dims every row unrelated to the station, and keeps its rows, messages to you and our own rows clear', () => {
    expect(shown(applyFocus(list(), 'VJ6X'))).toEqual([
      '[next]',
      'clear next',
      '[5 decodes]',
      'clear 9V1NE VJ6X -12',
      'clear 9V1NE ZL1TQK RF73',
      'dim CQ K1ABC FN42',
      'clear VJ6X JA1KXM -05',
      // Mentions the operator but is not addressed to him.
      'dim JA1KXM 9V1NE R-14',
      '[2 decodes]',
      'clear CQ VJ6X OF78',
      'dim BH1LKO VK4SHG 73',
      '[sent]',
      'clear sent',
    ]);
  });

  it('matches the station by base call', () => {
    const items = applyFocus(list(), 'VJ6X/P');
    expect(items.filter((i): i is RowItem => i.kind === 'row' && !i.dim).map((i) => i.row.decode.text)).toContain('CQ VJ6X OF78');
  });

  it('leaves the list as it is with no focus', () => {
    const items = list();
    expect(applyFocus(items, null)).toBe(items);
    expect(items.some((i) => i.kind === 'row' && i.dim)).toBe(false);
  });

  it('keeps Run callers clear: they are messages to you', () => {
    const callers = callerItems(SLOTS, '9V1NE', 'FT8', { call: 'K1ABC', grid: 'FN42', snrDb: -12, dtS: 0.2, freqHz: 2341 }, [], false);
    const rows = applyFocus(callers, 'K1ABC').filter((i): i is RowItem => i.kind === 'row');
    expect(rows.map((r) => [r.toYou, r.dim])).toEqual([[true, undefined]]);
    expect(related(rows[0], 'ZL1TQK')).toBe(true);
  });
});
