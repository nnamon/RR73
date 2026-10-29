import { describe, expect, it } from 'vitest';
import { parseAdif, writeAdif, writeRecord } from './adif';
import { bandOfHz, isAdifBand } from './bandplan';
import { createQso } from './qso';
import { adifDate, adifFreq, adifTime, parseDateTime, qsoToRecord, recordToQso } from './qso-adif';
import type { Activation } from './types';

const T = Date.UTC(2026, 9, 13, 13, 32, 5);
let n = 0;
const ctx = { now: T, newId: () => `id-${++n}` };

const ACT: Activation = {
  id: 'a1',
  refs: [
    { programme: 'POTA', ref: 'VK-0921' },
    { programme: 'POTA', ref: 'VK-0922' },
    { programme: 'WWFF', ref: 'VKFF-0921' },
  ],
  callsign: 'VK3/9V1NE',
  operator: '9V1NE',
  grid: 'QF22lb',
  gridSource: 'typed',
  wavelogStationId: null,
  startedAt: T,
  endedAt: null,
  updatedAt: T,
};

const qso = createQso(
  { call: 'VK2ESN', grid: 'QF56', mode: 'FT4', band: '20m', dialHz: 14_080_000, audioHz: 1500, startUtcMs: T - 30_000, endUtcMs: T, reportSent: -12, reportRcvd: 3, comment: 'Grüße', txPwrW: 5 },
  { id: '0b8f5f0e-3d2a-4c1b-9a8e-111111111111', now: T, activation: ACT, callsign: '9V1NE' },
);

describe('QSO to ADIF', () => {
  it('formats dates, times and frequency in UTC and MHz', () => {
    expect(adifDate(T)).toBe('20261013');
    expect(adifTime(T)).toBe('133205');
    expect(adifFreq(14_075_500)).toBe('14.075500');
    expect(adifFreq(7_047_500 + 1180)).toBe('7.048680');
  });

  it('writes every log.md field', () => {
    expect(qsoToRecord(qso)).toEqual({
      CALL: 'VK2ESN',
      QSO_DATE: '20261013',
      TIME_ON: '133135',
      QSO_DATE_OFF: '20261013',
      TIME_OFF: '133205',
      BAND: '20m',
      FREQ: '14.081500',
      MODE: 'MFSK',
      SUBMODE: 'FT4',
      RST_SENT: '-12',
      RST_RCVD: '+03',
      GRIDSQUARE: 'QF56',
      STATION_CALLSIGN: 'VK3/9V1NE',
      OPERATOR: '9V1NE',
      MY_GRIDSQUARE: 'QF22lb',
      TX_PWR: '5',
      MY_SIG: 'POTA',
      MY_SIG_INFO: 'VK-0921',
      MY_POTA_REF: 'VK-0921,VK-0922',
      MY_SOTA_REF: '',
      MY_WWFF_REF: 'VKFF-0921',
      MY_IOTA: '',
      SIG: '',
      SIG_INFO: '',
      POTA_REF: '',
      SOTA_REF: '',
      WWFF_REF: '',
      IOTA: '',
      NAME: '',
      QTH: '',
      CONTEST_ID: '',
      COMMENT: 'Grüße',
    });
  });

  it('narrows the activation fields to one reference in a programme file', () => {
    expect(qsoToRecord(qso, { reference: { programme: 'POTA', ref: 'VK-0922' } })).toMatchObject({ MY_SIG: 'POTA', MY_SIG_INFO: 'VK-0922', MY_POTA_REF: 'VK-0922', MY_WWFF_REF: 'VKFF-0921' });
    expect(qsoToRecord(qso, { reference: { programme: 'WWFF', ref: 'VKFF-0921' } })).toMatchObject({ MY_SIG: 'WWFF', MY_SIG_INFO: 'VKFF-0921', MY_POTA_REF: 'VK-0921,VK-0922' });
    expect(qsoToRecord(qso, { rr73Id: true }).APP_RR73_ID).toBe(qso.id);
  });

  it('round-trips a QSO through an ADIF file', () => {
    const text = writeAdif([qsoToRecord(qso, { rr73Id: true })], { programVersion: '0.5.0', createdAt: T });
    const [rec] = parseAdif(text).records;
    const r = recordToQso(rec, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.qso).toEqual({ ...qso, source: 'import', activationId: null, decode: null, createdAt: T, updatedAt: T });
  });
});

describe('the exchange of an FT8 or FT4 QSO', () => {
  const exch = (stx: string, srx: string, rst: [string, string]) =>
    createQso({ call: 'K1ABC', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T - 30_000, endUtcMs: T, reportSent: rst[0], reportRcvd: rst[1], stx, srx }, { id: 'x', now: T, activation: null, callsign: '9V1NE' });

  it('writes text to STX_STRING and SRX_STRING, serial numbers to STX and SRX, and both for a serial with a grid', () => {
    expect(qsoToRecord(exch('6A WI', '2B EMA', ['', '']))).toMatchObject({ STX_STRING: '6A WI', SRX_STRING: '2B EMA' });
    expect(qsoToRecord(exch('6A WI', '2B EMA', ['', '']))).not.toHaveProperty('STX');
    const ru = qsoToRecord(exch('0012', 'MA', ['579', '559']));
    expect(ru).toMatchObject({ STX: '12', SRX_STRING: 'MA', RST_SENT: '579', RST_RCVD: '559' });
    expect(ru).not.toHaveProperty('STX_STRING');
    expect(qsoToRecord(exch('0003 OJ11AB', '0007 IO91WM', ['57', '59']))).toMatchObject({ STX: '3', STX_STRING: '0003 OJ11AB', SRX: '7', SRX_STRING: '0007 IO91WM' });
  });

  it('reads the exchange text back from an ADIF file', () => {
    for (const [stx, srx] of [['6A WI', '2B EMA'], ['0012', 'MA'], ['0003 OJ11AB', '0007 IO91WM']]) {
      const text = writeAdif([qsoToRecord(exch(stx, srx, ['', '']))], { programVersion: '0.5.0', createdAt: T });
      const r = recordToQso(parseAdif(text).records[0], ctx);
      expect(r.ok && [r.qso.stx, r.qso.srx], stx).toEqual([stx === '0012' ? '12' : stx, srx]);
    }
  });
});

describe('ADIF from other loggers to QSOs', () => {
  it('reads a WSJT-X record, legacy MODE FT4 and HHMM times', () => {
    const f = parseAdif(
      'WSJT-X ADIF Export<eoh>\n<call:6>JA1KXM <gridsquare:4>pm95 <mode:3>FT4 <rst_sent:3>-14 <rst_rcvd:3>-09 <qso_date:8>20261013 <time_on:4>1315 <time_off:6>131545 <band:3>20M <freq:9>14.081200 <station_callsign:5>9v1ne <eor>',
    );
    const r = recordToQso(f.records[0], ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.qso).toMatchObject({
      call: 'JA1KXM',
      gridsquare: 'PM95',
      mode: 'MFSK',
      submode: 'FT4',
      band: '20m',
      freqHz: 14_081_200,
      start: Date.UTC(2026, 9, 13, 13, 15, 0),
      end: Date.UTC(2026, 9, 13, 13, 15, 45),
      stationCallsign: '9V1NE',
      source: 'import',
    });
  });

  it('writes an LQ8 QSO as MODE DATA with SUBMODE LQ8 and reads it back, also from a bare LQ8', () => {
    const q = createQso(
      { call: 'AB4SS', grid: 'FN42', mode: 'LQ8', band: '20m', dialHz: 14_084_000, audioHz: 1500, startUtcMs: T - 45_000, endUtcMs: T, reportSent: -11, reportRcvd: 5 },
      { id: '0b8f5f0e-3d2a-4c1b-9a8e-222222222222', now: T, activation: null, callsign: '9V1NE' },
    );
    expect(q).toMatchObject({ mode: 'DATA', submode: 'LQ8', freqHz: 14_085_500 });
    const text = writeRecord(qsoToRecord(q));
    expect(text).toContain('<MODE:4>DATA');
    expect(text).toContain('<SUBMODE:3>LQ8');
    const back = recordToQso(parseAdif(text).records[0], ctx);
    if (!back.ok) throw new Error(back.reason);
    expect(back.qso).toMatchObject({ mode: 'DATA', submode: 'LQ8', call: 'AB4SS' });
    const bare = recordToQso({ CALL: 'AB4SS', QSO_DATE: '20261012', TIME_ON: '1200', BAND: '20m', MODE: 'lq8' }, ctx);
    if (!bare.ok) throw new Error(bare.reason);
    expect(bare.qso).toMatchObject({ mode: 'DATA', submode: 'LQ8' });
  });

  it('derives BAND from FREQ, keeps unknown fields and crosses midnight', () => {
    const r = recordToQso({ CALL: 'w1aw', QSO_DATE: '20261012', TIME_ON: '235930', TIME_OFF: '000115', FREQ: '7.0741', MODE: 'ft8', APP_N1MM_EXCHANGE1: '5NN', MY_CITY: 'Wien' }, ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.qso.band).toBe('40m');
    expect(r.qso.end - r.qso.start).toBe(105_000);
    expect(r.qso.extra).toEqual({ APP_N1MM_EXCHANGE1: '5NN', MY_CITY: 'Wien' });
    expect(r.qso.id).toMatch(/^id-/);
  });

  it('writes imported fields back unchanged', () => {
    const r = recordToQso({ CALL: 'W1AW', QSO_DATE: '20261012', TIME_ON: '2359', MODE: 'CW', BAND: '20m', NAME: 'Hiram', APP_LOTW_RXQSL: '2026-10-12' }, ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(qsoToRecord(r.qso)).toMatchObject({ NAME: 'Hiram', APP_LOTW_RXQSL: '2026-10-12', MODE: 'CW' });
  });

  it('warns about what it could not read and refuses records without CALL or times', () => {
    const r = recordToQso({ CALL: 'K1A', QSO_DATE: '20261012', TIME_ON: '1200', FREQ: 'abc', BAND: '33m', TIME_OFF: '99' }, ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.warnings).toEqual([
      'The QSO with K1A has an unreadable TIME_OFF. RR73 ends it at its start time.',
      'The QSO with K1A has an unreadable FREQ.',
      'The QSO with K1A has an unknown BAND "33m".',
    ]);
    expect(recordToQso({ QSO_DATE: '20261012', TIME_ON: '1200' }, ctx)).toEqual({ ok: false, reason: 'A record has no CALL.' });
    expect(recordToQso({ CALL: 'K1A', QSO_DATE: '20261312', TIME_ON: '1200' }, ctx)).toEqual({ ok: false, reason: 'The QSO with K1A has no valid QSO_DATE and TIME_ON.' });
  });

  it('checks dates and times', () => {
    expect(parseDateTime('20261013', '1315')).toBe(Date.UTC(2026, 9, 13, 13, 15));
    expect(parseDateTime('20260230', '1315')).toBeNull();
    expect(parseDateTime('20261013', '2460')).toBeNull();
    expect(parseDateTime('2026-10-13', '1315')).toBeNull();
  });
});

describe('band plan', () => {
  it('finds ADIF bands by frequency', () => {
    expect(bandOfHz(14_075_500)).toBe('20m');
    expect(bandOfHz(50_313_000)).toBe('6m');
    expect(bandOfHz(1_840_000)).toBe('160m');
    expect(bandOfHz(12_000_000)).toBeNull();
    expect(isAdifBand('20M')).toBe(true);
    expect(isAdifBand('33m')).toBe(false);
  });
});
