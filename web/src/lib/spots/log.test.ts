import { describe, expect, it } from 'vitest';
import { isNewSpot, spotBadge, spotLog, workedToday } from './log';
import type { Qso } from '../log/types';
import type { Spot } from './types';

const NOW = Date.UTC(2026, 9, 13, 13, 14, 52);
const YESTERDAY = Date.UTC(2026, 9, 12, 23, 59);

function qso(over: Partial<Qso>): Qso {
  return {
    call: 'K1ABC',
    band: '20m',
    start: NOW - 3_600_000,
    deletedAt: null,
    sig: '',
    sigInfo: '',
    potaRef: '',
    sotaRef: '',
    wwffRef: '',
    iota: '',
    ...over,
  } as Qso;
}

function spot(over: Partial<Spot>): Spot {
  return {
    id: 'pota:1',
    source: 'pota',
    activator: 'K1ABC',
    refs: [{ programme: 'POTA', ref: 'US-0001', name: 'Example park' }],
    country: '',
    freqHz: 14_074_000,
    band: '20m',
    mode: 'FT8',
    digital: 'FT8',
    spottedAt: NOW - 60_000,
    spotter: 'W1AW',
    automatic: false,
    snrDb: null,
    qrt: false,
    comments: '',
    ...over,
  };
}

describe('the log for spots', () => {
  it('reads references, callsigns, today’s stations and bands, leaving deleted QSOs out', () => {
    const log = spotLog(
      [
        qso({ call: 'K1ABC/P', potaRef: 'US-0001,US-0002' }),
        qso({ call: 'VK3QRP', band: '40m', start: YESTERDAY, sotaRef: 'VK3/VC-012' }),
        qso({ call: 'ZL1KS', band: '15m', deletedAt: 1, potaRef: 'NZ-0008' }),
      ],
      NOW,
      '17m',
    );
    expect([...log.refs]).toEqual(['POTA US-0001', 'POTA US-0002', 'SOTA VK3/VC-012']);
    expect([...log.calls]).toEqual(['K1ABC', 'VK3QRP']);
    expect([...log.today]).toEqual(['K1ABC 20m']);
    expect(log.bands).toEqual(['17m', '20m', '40m']);
  });

  it('counts a station worked today on the spot’s band only, whatever its suffix', () => {
    const log = spotLog([qso({ call: 'K1ABC' })], NOW);
    expect(workedToday(spot({ activator: 'K1ABC/P' }), log)).toBe(true);
    expect(workedToday(spot({ band: '40m' }), log)).toBe(false);
    expect(workedToday(spot({ band: null }), log)).toBe(false);
    expect(workedToday(spot({}), spotLog([qso({ start: YESTERDAY })], NOW))).toBe(false);
  });

  it('calls a spot new for a reference no QSO names, and a DX spot new for a callsign never worked', () => {
    const log = spotLog([qso({ potaRef: 'US-0001' })], NOW);
    expect(isNewSpot(spot({}), log)).toBe(false);
    expect(isNewSpot(spot({ refs: [{ programme: 'POTA', ref: 'US-0001', name: '' }, { programme: 'WWFF', ref: 'KFF-0001', name: '' }] }), log)).toBe(true);
    expect(isNewSpot(spot({ refs: [], activator: 'K1ABC' }), log)).toBe(false);
    expect(isNewSpot(spot({ refs: [], activator: 'JA1KXM' }), log)).toBe(true);
  });

  it('badges Worked today first, then the first new reference’s programme', () => {
    const none = spotLog([], NOW);
    expect(spotBadge(spot({}), none)).toEqual({ text: 'New park', tone: 'teal' });
    expect(spotBadge(spot({ refs: [{ programme: 'SOTA', ref: 'VK3/VC-012', name: '' }] }), none)).toEqual({ text: 'New summit', tone: 'teal' });
    expect(spotBadge(spot({ refs: [{ programme: 'WWFF', ref: 'VKFF-0921', name: '' }] }), none)?.text).toBe('New WWFF');
    expect(spotBadge(spot({ refs: [{ programme: 'IOTA', ref: 'OC-001', name: '' }] }), none)?.text).toBe('New IOTA');
    expect(spotBadge(spot({ refs: [] }), none)).toBeNull();
    expect(spotBadge(spot({ qrt: true }), none)).toBeNull();
    const worked = spotLog([qso({ potaRef: 'US-0009' })], NOW);
    expect(spotBadge(spot({}), worked)).toEqual({ text: 'Worked today', tone: 'muted' });
    const hunted = spotLog([qso({ call: 'W1AW', potaRef: 'US-0001' })], NOW);
    expect(spotBadge(spot({}), hunted)).toBeNull();
  });
});
