import { describe, expect, it } from 'vitest';
import { checkRef, checkRefs, countsByBand, gridFromLatLon, hoursMinutes, normaliseRef, progress, refsLabel, utcDayKey, utcDayLeftMs, utcDayStart } from './activation';
import { createQso } from './qso';
import type { Activation, Qso, Reference } from './types';

const T = Date.UTC(2026, 9, 13, 18, 56, 0);

function act(id: string, refs: Reference[]): Activation {
  return { id, refs, callsign: 'VK3/9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'gps', wavelogStationId: null, startedAt: T - 3_600_000, endedAt: null, updatedAt: T };
}

let n = 0;
function q(a: Activation | null, call: string, at: number, band = '20m', mode: 'FT8' | 'FT4' = 'FT8'): Qso {
  return createQso({ call, mode, band, dialHz: 14_074_000, audioHz: 1500, startUtcMs: at, endUtcMs: at + 30_000, reportSent: -10, reportRcvd: -10 }, { id: `q${++n}`, now: at, activation: a, callsign: '9V1NE' });
}

describe('references', () => {
  it('accepts each programme’s format', () => {
    for (const [p, r] of [
      ['POTA', 'VK-0921'],
      ['POTA', 'US-12345'],
      ['POTA', 'SG-0014'],
      ['POTA', '9M-0001'],
      ['SOTA', 'VK3/VC-012'],
      ['SOTA', 'W7O/CN-001'],
      ['SOTA', 'G/LD-001'],
      ['WWFF', 'VKFF-0921'],
      ['WWFF', 'GFF-0001'],
      ['IOTA', 'OC-001'],
      ['IOTA', 'EU-005'],
    ] as const) {
      expect(checkRef(p, r)).toEqual({ ok: true, ref: r });
    }
  });

  it('normalises what is typed and says what a reference looks like', () => {
    expect(normaliseRef(' vk-0921 ')).toBe('VK-0921');
    expect(checkRef('POTA', 'vk - 0921')).toEqual({ ok: true, ref: 'VK-0921' });
    expect(checkRef('POTA', 'VK0921')).toEqual({ ok: false, message: 'VK0921 is not a POTA reference. They look like VK-0921.' });
    expect(checkRef('SOTA', 'VK3-VC-012')).toEqual({ ok: false, message: 'VK3-VC-012 is not a SOTA reference. They look like VK3/VC-012.' });
    expect(checkRef('WWFF', 'VK-0921')).toMatchObject({ ok: false });
    expect(checkRef('IOTA', 'XX-001')).toMatchObject({ ok: false });
    expect(checkRef('IOTA', '')).toEqual({ ok: false, message: 'Type an IOTA reference, such as OC-001.' });
  });

  it('checks a set of references', () => {
    expect(checkRefs([])).toBe('Add at least one reference.');
    expect(checkRefs([{ programme: 'POTA', ref: 'VK-0921' }, { programme: 'POTA', ref: 'VK-0921' }])).toBe('POTA VK-0921 is listed twice.');
    expect(checkRefs([{ programme: 'SOTA', ref: 'VK3/VC-012' }, { programme: 'SOTA', ref: 'VK3/VC-013' }])).toBe('An activation has one SOTA reference at most.');
    expect(checkRefs([{ programme: 'POTA', ref: 'VK-0921' }, { programme: 'POTA', ref: 'VK-0922' }, { programme: 'SOTA', ref: 'VK3/VC-012' }])).toBeNull();
    expect(refsLabel([{ programme: 'POTA', ref: 'VK-0921' }, { programme: 'SOTA', ref: 'VK3/VC-012' }])).toBe('POTA VK-0921 · SOTA VK3/VC-012');
  });
});

describe('the UTC day', () => {
  it('ends at midnight UTC', () => {
    expect(utcDayKey(T)).toBe('20261013');
    expect(utcDayStart(T)).toBe(Date.UTC(2026, 9, 13));
    expect(utcDayLeftMs(T)).toBe((5 * 60 + 4) * 60_000);
    expect(hoursMinutes(utcDayLeftMs(T))).toBe('5 h 4 min');
    expect(hoursMinutes(42 * 60_000)).toBe('42 min');
    expect(hoursMinutes(45_000)).toBe('45 s');
    expect(hoursMinutes(-5)).toBe('0 s');
  });
});

describe('counting rules', () => {
  const sota = act('a', [
    { programme: 'SOTA', ref: 'VK3/VC-012' },
    { programme: 'POTA', ref: 'VK-0921' },
  ]);

  it('counts POTA QSOs in this UTC day, a repeat on the same band and mode once', () => {
    const qsos = [q(sota, 'VK2ESN', T - 60_000), q(sota, 'VK2ESN', T - 50_000), q(sota, 'VK2ESN', T - 40_000, '40m'), q(sota, 'ZL1TQK', T - 30_000, '20m', 'FT4'), q(sota, 'JH1RRT', Date.UTC(2026, 9, 12, 23, 0))];
    const [s, p] = progress(sota, qsos, [sota], T);
    expect(p).toMatchObject({ programme: 'POTA', ref: 'VK-0921', count: 3, target: 10, qualified: false, label: '3 of 10 · 7 more', rule: '10 QSOs in one UTC day' });
    expect(s).toMatchObject({ programme: 'SOTA', count: 2, target: 4, qualified: false, label: '2 of 4 stations · 2 more' });
  });

  it('shows Qualified with the QSO count once the rule is met', () => {
    const qsos = ['VK2ESN', 'ZL1TQK', 'VK3ARR', 'JH1RRT', 'VK2ESN', 'VK4AA', 'VK5BB'].map((c, i) => q(sota, c, T - 600_000 + i * 60_000));
    const [s, p] = progress(sota, qsos, [sota], T);
    expect(s).toMatchObject({ count: 6, qualified: true, label: '7 QSOs · Qualified' });
    expect(p).toMatchObject({ count: 6, qualified: false, label: '6 of 10 · 4 more' });
  });

  it('adds up POTA QSOs at the same park on the same UTC day across activations, and leaves out deleted ones', () => {
    const morning = { ...act('m', [{ programme: 'POTA', ref: 'VK-0921' }]), endedAt: T - 7_200_000 };
    const now = act('n', [{ programme: 'POTA', ref: 'VK-0921' }]);
    const other = act('o', [{ programme: 'POTA', ref: 'VK-0001' }]);
    const gone = { ...q(now, 'VK9XX', T - 10_000), deletedAt: T };
    const qsos = [q(morning, 'K1A', T - 10_000_000), q(morning, 'K1B', T - 9_000_000), q(now, 'K1C', T - 60_000), q(other, 'K1D', T - 60_000), gone];
    expect(progress(now, qsos, [morning, now, other], T)[0]).toMatchObject({ count: 3, label: '3 of 10 · 7 more' });
  });

  it('adds up WWFF QSOs over every activation at the reference', () => {
    const ref: Reference = { programme: 'WWFF', ref: 'VKFF-0921' };
    const first = { ...act('w1', [ref]), endedAt: T - 86_400_000 * 30 };
    const second = act('w2', [ref]);
    const old = Array.from({ length: 40 }, (_, i) => q(first, `VK${i}AA`, T - 86_400_000 * 30 + i * 60_000));
    const dupe = q(first, 'VK0AA', T - 86_400_000 * 30 + 99 * 60_000);
    const today = Array.from({ length: 3 }, (_, i) => q(second, `VK${i}AA`, T - 600_000 + i * 60_000));
    expect(progress(second, [...old, dupe, ...today], [first, second], T)[0]).toMatchObject({ count: 43, label: '43 of 44 · 1 more', rule: '44 QSOs, added up over activations' });
    const more = [...old, ...today, q(second, 'VK99ZZ', T - 1000)];
    expect(progress(second, more, [first, second], T)[0]).toMatchObject({ count: 44, qualified: true, label: '44 QSOs · Qualified' });
  });

  it('shows the QSO count for IOTA', () => {
    const island = act('i', [{ programme: 'IOTA', ref: 'OC-001' }]);
    expect(progress(island, [q(island, 'K1A', T)], [island], T)[0]).toMatchObject({ target: null, label: '1 QSO', rule: 'No minimum' });
  });

  it('counts QSOs by band', () => {
    const qsos = [q(sota, 'A1', T), q(sota, 'A2', T, '40m'), q(sota, 'A3', T), q(sota, 'A4', T), q(sota, 'A5', T, '40m'), q(null, 'A6', T), q(sota, 'A7', T, '20m'), q(sota, 'A8', T, '20m')];
    expect(countsByBand(qsos, 'a')).toEqual([
      ['20m', 5],
      ['40m', 2],
    ]);
  });
});

describe('grid from GPS', () => {
  it('gives the Maidenhead locator of a position', () => {
    expect(gridFromLatLon(41.7147, -72.7272)).toBe('FN31pr');
    expect(gridFromLatLon(-33.8688, 151.2093)).toBe('QF56od');
    expect(gridFromLatLon(-33.8688, 151.2093, 4)).toBe('QF56');
    expect(gridFromLatLon(41.7147, -72.7272, 8)).toBe('FN31pr21');
    expect(gridFromLatLon(90, 180)).toBe('RR99xx');
    expect(gridFromLatLon(-90, -180)).toBe('AA00aa');
  });
});
