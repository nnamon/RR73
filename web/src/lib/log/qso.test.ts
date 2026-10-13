import { describe, expect, it } from 'vitest';
import { activationFields, adifChanged, adifMode, createQso, formatReport, isGrid, newId, normaliseCall, normaliseGrid, stampActivation, theirFields, theirRefs } from './qso';
import type { Activation, LogQsoRecord } from './types';

const T = Date.UTC(2026, 9, 13, 13, 32, 0);

const RECORD: LogQsoRecord = {
  call: 'vk2esn',
  grid: 'qf56',
  mode: 'FT8',
  band: '20m',
  dialHz: 14_074_000,
  audioHz: 1500,
  startUtcMs: T - 60_000,
  endUtcMs: T,
  reportSent: -12,
  reportRcvd: -10,
  decode: { preset: 'subtract-3', snrDb: -12, dtS: 0.2, audioHz: 1432 },
};

const ACT: Activation = {
  id: 'a1',
  refs: [
    { programme: 'SOTA', ref: 'VK3/VC-012' },
    { programme: 'POTA', ref: 'VK-0921' },
    { programme: 'POTA', ref: 'VK-0922' },
  ],
  callsign: 'VK3/9V1NE',
  operator: '9V1NE',
  grid: 'QF22lb',
  gridSource: 'gps',
  wavelogStationId: '7',
  startedAt: T - 3_600_000,
  endedAt: null,
  updatedAt: T - 3_600_000,
};

describe('QSO fields', () => {
  it('normalises calls and grids', () => {
    expect(normaliseCall(' vk3/9v1ne-p ')).toBe('VK3/9V1NEP');
    expect(isGrid('QF22')).toBe(true);
    expect(isGrid('qf22lb')).toBe(true);
    expect(isGrid('QF22LB12')).toBe(true);
    expect(isGrid('QF2')).toBe(false);
    expect(isGrid('ZZ22')).toBe(false);
    expect(normaliseGrid('qf22LB')).toBe('QF22lb');
    expect(normaliseGrid('nonsense')).toBe('');
  });

  it('formats reports as sent on air', () => {
    expect(formatReport(-9)).toBe('-09');
    expect(formatReport(5)).toBe('+05');
    expect(formatReport(0)).toBe('+00');
    expect(formatReport(-14.4)).toBe('-14');
    expect(formatReport(-60)).toBe('-50');
    expect(formatReport(' −14 ')).toBe('-14');
    expect(formatReport(Number.NaN)).toBe('');
  });

  it('writes FT4 as MODE MFSK with SUBMODE FT4', () => {
    expect(adifMode('FT4')).toEqual({ mode: 'MFSK', submode: 'FT4' });
    expect(adifMode('ft8')).toEqual({ mode: 'FT8', submode: '' });
  });

  it('fills MY_SIG and the reference fields from an activation', () => {
    expect(activationFields(ACT)).toEqual({ mySig: 'POTA', mySigInfo: 'VK-0921', myPotaRef: 'VK-0921,VK-0922', mySotaRef: 'VK3/VC-012', myWwffRef: '', myIota: '' });
    expect(activationFields({ refs: [{ programme: 'WWFF', ref: 'VKFF-0921' }, { programme: 'IOTA', ref: 'OC-001' }] })).toMatchObject({ mySig: 'WWFF', mySigInfo: 'VKFF-0921', myIota: 'OC-001' });
    expect(activationFields(null)).toEqual({ mySig: '', mySigInfo: '', myPotaRef: '', mySotaRef: '', myWwffRef: '', myIota: '' });
  });

  it('writes and reads back the other station’s references', () => {
    const f = theirFields([{ programme: 'POTA', ref: 'US-1234' }, { programme: 'SOTA', ref: 'W7O/CN-001' }]);
    expect(f).toEqual({ sig: 'POTA', sigInfo: 'US-1234', potaRef: 'US-1234', sotaRef: 'W7O/CN-001', wwffRef: '', iota: '' });
    expect(theirRefs(f)).toEqual([{ programme: 'POTA', ref: 'US-1234' }, { programme: 'SOTA', ref: 'W7O/CN-001' }]);
    // A logger that wrote only SIG and SIG_INFO.
    expect(theirRefs({ sig: 'pota', sigInfo: 'US-1234', potaRef: '', sotaRef: '', wwffRef: '', iota: '' })).toEqual([{ programme: 'POTA', ref: 'US-1234' }]);
  });

  it('makes v4 UUIDs', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('createQso', () => {
  it('builds a QSO from the sequencer’s record outside an activation', () => {
    const q = createQso(RECORD, { id: 'q1', now: T, activation: null, callsign: '9V1NE' });
    expect(q).toMatchObject({
      call: 'VK2ESN',
      gridsquare: 'QF56',
      mode: 'FT8',
      submode: '',
      band: '20m',
      freqHz: 14_075_500,
      start: T - 60_000,
      end: T,
      rstSent: '-12',
      rstRcvd: '-10',
      stationCallsign: '9V1NE',
      operator: '9V1NE',
      mySig: '',
      id: 'q1',
      createdAt: T,
      updatedAt: T,
      deletedAt: null,
      activationId: null,
      source: 'sequencer',
      decode: { preset: 'subtract-3', snrDb: -12, dtS: 0.2, audioHz: 1432 },
    });
  });

  it('takes the station from the activation: call on air, operator, grid and references', () => {
    const q = createQso({ ...RECORD, mode: 'FT4', theirRefs: [{ programme: 'POTA', ref: 'VK-0001' }] }, { id: 'q2', now: T, activation: ACT, callsign: '9V1NE' });
    expect(q).toMatchObject({
      mode: 'MFSK',
      submode: 'FT4',
      stationCallsign: 'VK3/9V1NE',
      operator: '9V1NE',
      myGridsquare: 'QF22lb',
      mySig: 'POTA',
      mySigInfo: 'VK-0921',
      myPotaRef: 'VK-0921,VK-0922',
      mySotaRef: 'VK3/VC-012',
      sig: 'POTA',
      sigInfo: 'VK-0001',
      activationId: 'a1',
    });
  });

  it('refuses a record without a callsign or times', () => {
    expect(() => createQso({ ...RECORD, call: ' / ' }, { id: 'x', now: T, activation: null, callsign: '' })).toThrow('no callsign');
    expect(() => createQso({ ...RECORD, startUtcMs: Number.NaN }, { id: 'x', now: T, activation: null, callsign: '' })).toThrow('no start or end');
  });

  it('orders start and end, and drops an unusable frequency and power', () => {
    const q = createQso({ ...RECORD, startUtcMs: T, endUtcMs: T - 1000, dialHz: 0, audioHz: 0, txPwrW: -5 }, { id: 'x', now: T, activation: null, callsign: '' });
    expect([q.start, q.end]).toEqual([T - 1000, T]);
    expect(q.freqHz).toBeNull();
    expect(q.txPwrW).toBeNull();
  });

  it('restamps a QSO when its activation changes, and notices ADIF changes only', () => {
    const q = createQso(RECORD, { id: 'q3', now: T, activation: ACT, callsign: '9V1NE' });
    const moved = stampActivation(q, { ...ACT, refs: [{ programme: 'WWFF', ref: 'VKFF-0921' }], callsign: 'VK2/9V1NE' });
    expect(moved).toMatchObject({ myPotaRef: '', mySotaRef: '', myWwffRef: 'VKFF-0921', mySig: 'WWFF', stationCallsign: 'VK2/9V1NE' });
    expect(adifChanged(q, moved)).toBe(true);
    expect(adifChanged(q, { ...q, updatedAt: T + 5, decode: null })).toBe(false);
  });
});
