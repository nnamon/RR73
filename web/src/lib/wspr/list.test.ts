import { describe, expect, it } from 'vitest';
import { buildWsprList, type ListInput, type WsprItem } from './list';
import { toSpots, type WsprDecode } from './spots';

const t = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);
const d = (text: string, snr = -20): WsprDecode => ({ text, freq_hz: 1500, dt_s: 0.2, drift_hz_per_s: 0, snr_db: snr });
const ctx = { myGrid: 'OJ11vi', myCall: '9V1NE', dialHz: 14_095_600, grids: new Map<string, string>() };
const slot = (start: number, texts: string[], skipped = false) => ({ startUtcMs: start, spots: toSpots(texts.map((x) => d(x)), start, ctx), skipped });

function input(over: Partial<ListInput>): ListInput {
  return { nowMs: t(14, 5, 12), slots: [], sent: [], sort: 'distance', live: true, decoding: null, onAir: null, next: null, ...over };
}

/** Headers as "time detail", spots as their callsign, Tx rows as "stage text". */
function show(items: WsprItem[]): string[] {
  return items.map((i) => (i.kind === 'header' ? `${i.time} ${i.detail}` : i.kind === 'spot' ? `${i.spot.call}${i.old ? ' (old)' : ''}` : `${i.stage} ${i.text}`));
}

describe('the WSPR list', () => {
  it('says when the spots of the slot in progress arrive, newest slot first, spots farthest first', () => {
    const items = buildWsprList(input({ slots: [slot(t(14, 2), ['DU1IVT PK04 30', 'ZL2BRG RE78 23']), slot(t(14, 0), ['VK2ZT QF56 30'])] }));
    expect(show(items)).toEqual(['14:04 receiving, spots at 14:06', '14:02 2 spots', 'ZL2BRG', 'DU1IVT', '14:00 1 spot', 'VK2ZT (old)']);
  });

  it('shows no slot in progress while audio is off', () => {
    expect(show(buildWsprList(input({ live: false, slots: [slot(t(14, 2), ['DU1IVT PK04 30'])] })))).toEqual(['14:02 1 spot', 'DU1IVT']);
  });

  it('puts a Next row on top when the next slot is a Tx slot', () => {
    const next = { slotStartMs: t(14, 6), text: '9V1NE OJ11 37', freqHz: 1500 };
    expect(show(buildWsprList(input({ next })))).toEqual(['14:06 next', 'next 9V1NE OJ11 37', '14:04 receiving, spots at 14:06']);
    // A Tx slot further off has no Next row.
    expect(show(buildWsprList(input({ next: { ...next, slotStartMs: t(14, 18) } })))).toEqual(['14:04 receiving, spots at 14:06']);
  });

  it('shows Sending on air, then Sent in its slot, and no spots from it', () => {
    const onAir = { slotStartMs: t(14, 6), text: '9V1NE OJ11 37', freqHz: 1500 };
    const sent = [{ slotStartMs: t(14, 6), text: '9V1NE OJ11 37', freqHz: 1500, complete: true }];
    expect(show(buildWsprList(input({ nowMs: t(14, 6, 47), onAir, sent })))).toEqual(['14:06 sending', 'sending 9V1NE OJ11 37']);
    expect(show(buildWsprList(input({ nowMs: t(14, 7, 55), sent })))).toEqual(['14:06 sent', 'sent 9V1NE OJ11 37']);
    const later = buildWsprList(input({ nowMs: t(14, 10, 4), sent, slots: [slot(t(14, 8), ['G4ZFQ IO90 30'])] }));
    // Below newer spots, the Sent row fades with them.
    expect(later.find((i) => i.kind === 'tx')).toMatchObject({ stage: 'sent', old: true });
    expect(show(later)).toEqual([
      '14:10 receiving, spots at 14:12',
      '14:08 1 spot',
      'G4ZFQ',
      '14:06 sent',
      'sent 9V1NE OJ11 37',
    ]);
  });

  it('says a slot is being decoded until its spots arrive', () => {
    expect(show(buildWsprList(input({ nowMs: t(14, 6, 1), decoding: t(14, 4) })))).toEqual(['14:06 receiving, spots at 14:08', '14:04 decoding']);
  });

  it('gives a run of slots with no spots one header', () => {
    const items = buildWsprList(input({ nowMs: t(14, 11), slots: [slot(t(14, 8), []), slot(t(14, 6), []), slot(t(14, 4), []), slot(t(14, 2), ['DU1IVT PK04 30'])] }));
    expect(show(items)).toEqual(['14:10 receiving, spots at 14:12', '14:04 to 14:08 no spots', '14:02 1 spot', 'DU1IVT']);
  });

  it('says when the decoder could not take a slot', () => {
    expect(show(buildWsprList(input({ nowMs: t(14, 7), slots: [slot(t(14, 4), [], true)] })))).toEqual(['14:06 receiving, spots at 14:08', '14:04 not decoded']);
  });

  it('sorts each slot by the chosen order', () => {
    const s = { startUtcMs: t(14, 2), skipped: false, spots: toSpots([d('DU1IVT PK04 30', -5), d('ZL2BRG RE78 23', -25), d('AA1A FN42 37', -15)], t(14, 2), ctx) };
    const calls = (sort: ListInput['sort']) => show(buildWsprList(input({ live: false, slots: [s], sort }))).slice(1);
    expect(calls('distance')).toEqual(['AA1A', 'ZL2BRG', 'DU1IVT']);
    expect(calls('snr')).toEqual(['DU1IVT', 'AA1A', 'ZL2BRG']);
    expect(calls('call')).toEqual(['AA1A', 'DU1IVT', 'ZL2BRG']);
  });
});
