import { describe, expect, it } from 'vitest';
import { editField, emptyDraft, firstMention, record, refill, setCall, worked } from './draft';
import type { RxRun } from './transcript';
import { createQso } from '../log/qso';
import { qsoToRecord, recordToQso } from '../log/qso-adif';
import { parseAdif, writeAdif } from '../log/adif';
import type { Qso } from '../log/types';

const T = Date.UTC(2026, 9, 14, 14, 4, 12);
const run = (text: string, s: number): RxRun => ({ text, atMs: T + s * 1000 });

/** The mockup's QSO with JA1XYZ, from their CQ to their over. */
const RUNS: RxRun[] = [
  run('BV2KQ DE VK4TQ', -300),
  run('NAME BOB QTH PERTH', -290),
  run('CQ CQ CQ DE JA1XYZ JA1XYZ JA1XYZ', 0),
  run('PSE K', 2),
  run('9V1NE DE JA1XYZ', 30),
  run('GE OM TNX FER CALL. UR RST 579 579', 33),
  run('NAME TARO TARO QTH YOKOHAMA YOKOHAMA', 38),
  run('HW CPY? 9V1NE DE JA1XYZ K', 44),
];

describe('the QSO strip', () => {
  it('fills from the station text since its callsign first appeared, with time on there', () => {
    const d = setCall(emptyDraft(), 'ja1xyz', RUNS, T + 60_000, false);
    expect(d.fields).toMatchObject({ call: 'JA1XYZ', rstSent: '599', rstRcvd: '579', name: 'TARO', qth: 'YOKOHAMA' });
    expect(d.startMs).toBe(T);
    expect(firstMention(RUNS, 'VK4TQ')?.index).toBe(0);
  });

  it('never overwrites a field the operator typed, even emptied', () => {
    let d = setCall(emptyDraft(), 'JA1XYZ', RUNS.slice(0, 5), T + 31_000, false);
    d = editField(d, 'name', 'taro-san');
    d = editField(d, 'qth', '');
    d = refill(d, RUNS, false);
    expect(d.fields).toMatchObject({ name: 'TARO-SAN', qth: '', rstRcvd: '579' });
  });

  it('starts a new QSO for a new callsign, at the time it was set when it is not in the text', () => {
    const d = setCall(setCall(emptyDraft(), 'JA1XYZ', RUNS, T, false), 'OH2BAX', RUNS, T + 99_000, false);
    expect(d.fields).toMatchObject({ call: 'OH2BAX', name: '', qth: '', rstRcvd: '', rstSent: '599' });
    expect(d.startMs).toBe(T + 99_000);
  });

  it('fills the received number in the Contest set', () => {
    const runs = [run('CQ TEST OH2BAX OH2BAX', 0), run('9V1NE 599 0877 0877', 10)];
    const d = setCall(emptyDraft(), 'OH2BAX', runs, T + 20_000, true);
    expect(d.fields).toMatchObject({ rstRcvd: '599', srx: '0877' });
    expect(setCall(emptyDraft(), 'OH2BAX', runs, T + 20_000, false).fields.srx).toBe('');
  });
});

const ctx = { mode: 'RTTY' as const, band: '20m', dialHz: 14_083_000, markHz: 1612, nowMs: T + 120_000, contest: false, stx: '042', contestId: '' };

describe('logging the strip', () => {
  it('builds an RTTY record: FREQ is dial plus mark, reports as sent, name and QTH', () => {
    const d = editField(setCall(emptyDraft(), 'JA1XYZ', RUNS, T + 60_000, false), 'notes', 'IC-7300 100W YAGI');
    const r = record(d, ctx);
    expect(r).toMatchObject({ call: 'JA1XYZ', mode: 'RTTY', band: '20m', dialHz: 14_083_000, audioHz: 1612, startUtcMs: T, endUtcMs: T + 120_000, reportSent: '599', reportRcvd: '579', name: 'TARO', qth: 'YOKOHAMA', stx: '', srx: '', contestId: '', comment: 'IC-7300 100W YAGI', source: 'keyboard' });
  });

  it('writes the ADIF of an RTTY QSO: MODE RTTY with no SUBMODE, 3-digit reports, NAME, QTH, and reads it back', () => {
    const d = setCall(emptyDraft(), 'JA1XYZ', RUNS, T + 60_000, false);
    const q = createQso(record(d, ctx), { id: '0b8f5f0e-3d2a-4c1b-9a8e-222222222222', now: T, activation: null, callsign: '9V1NE' });
    const rec = qsoToRecord(q);
    expect(rec).toMatchObject({ CALL: 'JA1XYZ', MODE: 'RTTY', SUBMODE: '', BAND: '20m', FREQ: '14.084612', RST_SENT: '599', RST_RCVD: '579', NAME: 'TARO', QTH: 'YOKOHAMA', QSO_DATE: '20261014', TIME_ON: '140412', TIME_OFF: '140612' });
    expect(rec.STX).toBeUndefined();
    expect(rec.CONTEST_ID).toBe('');
    const text = writeAdif([rec], { programVersion: '0.13.0', createdAt: T });
    expect(text).toContain('<MODE:4>RTTY');
    expect(text).not.toContain('<SUBMODE');
    expect(text).toContain('<NAME:4>TARO');
    const back = recordToQso(parseAdif(text).records[0], { now: T, newId: () => 'x' });
    expect(back.ok && back.qso).toMatchObject({ call: 'JA1XYZ', mode: 'RTTY', submode: '', name: 'TARO', qth: 'YOKOHAMA', rstSent: '599', rstRcvd: '579', freqHz: 14_084_612 });
  });

  it('writes contest serial numbers as STX and SRX integers, with CONTEST_ID', () => {
    const d = editField(setCall(emptyDraft(), 'OH2BAX', [run('CQ TEST OH2BAX', -10), run('9V1NE 599 0877 0877', 0)], T + 10_000, true), 'rstRcvd', '599');
    const q = createQso(record(d, { ...ctx, contest: true, contestId: 'CQ-WPX-RTTY' }), { id: '0b8f5f0e-3d2a-4c1b-9a8e-333333333333', now: T, activation: null, callsign: '9V1NE' });
    expect(q).toMatchObject({ stx: '042', srx: '0877', contestId: 'CQ-WPX-RTTY' });
    expect(qsoToRecord(q)).toMatchObject({ STX: '42', SRX: '877', CONTEST_ID: 'CQ-WPX-RTTY' });
    const odd = createQso({ ...record(d, { ...ctx, contest: true }), srx: 'CA' }, { id: '0b8f5f0e-3d2a-4c1b-9a8e-444444444444', now: T, activation: null, callsign: '9V1NE' });
    expect(qsoToRecord(odd)).toMatchObject({ SRX_STRING: 'CA' });
  });
});

describe('dupes', () => {
  const q = (call: string, band: string, mode: string, contestId = '', deleted = false) => ({ call, band, mode, submode: '', contestId, deletedAt: deleted ? 1 : null }) as Qso;
  const log = [q('JA1XYZ', '20m', 'RTTY'), q('OH2BAX', '20m', 'RTTY', 'CQ-WPX-RTTY'), q('DL5ABC', '40m', 'RTTY'), q('VK4TQ', '20m', 'FT8'), q('BV2KQ', '20m', 'RTTY', '', true)];

  it('counts QSOs on this band and mode; in a contest, only that contest', () => {
    expect(worked(log, 'JA1XYZ', '20m', 'RTTY', null)).toBe(true);
    expect(worked(log, 'DL5ABC', '20m', 'RTTY', null)).toBe(false);
    expect(worked(log, 'VK4TQ', '20m', 'RTTY', null)).toBe(false);
    expect(worked(log, 'BV2KQ', '20m', 'RTTY', null)).toBe(false);
    expect(worked(log, 'OH2BAX', '20m', 'RTTY', 'CQ-WPX-RTTY')).toBe(true);
    expect(worked(log, 'JA1XYZ', '20m', 'RTTY', 'CQ-WPX-RTTY')).toBe(false);
  });
});
