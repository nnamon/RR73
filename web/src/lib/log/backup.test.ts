import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, buildBackup, importText, planImport, type Backup, type ImportPlan } from './backup';
import { buildExport } from './files';
import { createQso } from './qso';
import type { Activation, LedgerEntry, Qso } from './types';

const T = Date.UTC(2026, 9, 15, 8, 0, 0);
let n = 0;
const ctx = { now: T, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
const qso = (id: string, call: string, minutes = 0, activationId: string | null = null): Qso => ({
  ...createQso(
    { call, grid: 'QF56', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T + minutes * 60_000, endUtcMs: T + minutes * 60_000 + 45_000, reportSent: -12, reportRcvd: -10 },
    { id, now: T, activation: null, callsign: '9V1NE' },
  ),
  activationId,
});
const ACT: Activation = { id: 'act-1', refs: [{ programme: 'POTA', ref: 'VK-0921' }], callsign: 'VK3/9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'typed', wavelogStationId: null, startedAt: T, endedAt: T + 3_600_000, updatedAt: T };
const entry = (qsoId: string): LedgerEntry => ({ qsoId, destinationId: 'wavelog', state: 'delivered', attempts: 1, lastAttemptAt: T, nextAttemptAt: null, lastError: null, refusal: null, remoteRef: null, deliveredAt: T, deliveredUpdatedAt: T, parts: [] }) as unknown as LedgerEntry;

const A = qso('11111111-1111-4111-8111-111111111111', 'VK2ESN', 0, 'act-1');
const B = qso('22222222-2222-4222-8222-222222222222', 'JA1KXM', 5);
const C = { ...qso('33333333-3333-4333-8333-333333333333', 'ZL1TQK', 9), deletedAt: T + 600_000 };
const LOG = { qsos: [A, B, C], activations: [ACT], ledger: [entry(A.id), entry(B.id)] };
const backupText = () => buildBackup(LOG, 'VK3/9V1NE', { programVersion: '0.20.0', now: T }).text;
const plan = (text: string, log: { qsos: Qso[]; activations: Activation[] }): ImportPlan => {
  const r = planImport(text, log, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};

describe('the backup', () => {
  it('holds every QSO with tombstones, the activations and the ledger, and no destination settings', () => {
    const f = buildBackup(LOG, 'VK3/9V1NE', { programVersion: '0.20.0', now: T });
    expect(f.name).toBe('RR73 backup VK3-9V1NE 20261015.json');
    const b = JSON.parse(f.text) as Backup;
    expect(b).toMatchObject({ format: BACKUP_FORMAT, version: 1, app: '0.20.0', exportedAt: '2026-10-15T08:00:00.000Z' });
    expect(b.qsos.map((q) => q.call)).toEqual(['VK2ESN', 'JA1KXM', 'ZL1TQK']);
    expect(b.activations).toEqual([ACT]);
    expect(b.ledger).toHaveLength(2);
    expect(Object.keys(b).sort()).toEqual(['activations', 'app', 'exportedAt', 'format', 'ledger', 'qsos', 'version']);
  });

  it('restores into an empty log whole: QSOs, tombstones, activations and what Wavelog holds', () => {
    const p = plan(backupText(), { qsos: [], activations: [] });
    expect(p).toMatchObject({ kind: 'backup', already: 0, unreadable: 0 });
    expect(p.qsos).toEqual([A, B, C]);
    expect(p.activations).toEqual([ACT]);
    expect(p.ledger.map((e) => [e.qsoId, e.state])).toEqual([
      [A.id, 'delivered'],
      [B.id, 'delivered'],
    ]);
    expect(importText(p)).toBe('Imported 3 QSOs and 1 activation.');
  });

  it('leaves what the log holds, and restores the rest with their ledger', () => {
    const p = plan(backupText(), { qsos: [A, C], activations: [ACT] });
    expect(p.qsos).toEqual([B]);
    expect(p.activations).toEqual([]);
    expect(p.ledger.map((e) => e.qsoId)).toEqual([B.id]);
    expect(p.already).toBe(2);
    expect(importText(p)).toBe('Imported 1 QSO. 2 were in the log already.');
    expect(importText(plan(backupText(), { qsos: [A, B, C], activations: [ACT] }))).toBe('No QSOs to import. 3 were in the log already.');
  });

  it('skips records it cannot read and keeps a QSO out of an activation it lacks', () => {
    const b = JSON.parse(backupText()) as Backup;
    const text = JSON.stringify({ ...b, activations: [], qsos: [...b.qsos, { id: 'x', call: '' }, 'nonsense'] });
    const p = plan(text, { qsos: [], activations: [] });
    expect(p.unreadable).toBe(2);
    expect(p.qsos.find((q) => q.id === A.id)?.activationId).toBeNull();
    expect(importText(p)).toBe('Imported 3 QSOs. 2 records could not be read.');
  });

  it('refuses a backup from a newer RR73, and a file that is no log', () => {
    const b = JSON.parse(backupText()) as Backup;
    expect(planImport(JSON.stringify({ ...b, version: 2, app: '1.2.0' }), { qsos: [], activations: [] }, ctx)).toEqual({ ok: false, reason: 'The backup is from a newer RR73 (1.2.0). Update RR73 to restore it.' });
    for (const text of ['{"format":"other"}', '{ not json', 'Hello', '']) expect(planImport(text, { qsos: [], activations: [] }, ctx)).toEqual({ ok: false, reason: 'The file is neither ADIF nor an RR73 backup.' });
    expect(planImport('RR73 <ADIF_VER:5>3.1.4 <EOH>\n', { qsos: [], activations: [] }, ctx)).toEqual({ ok: false, reason: 'The ADIF file holds no QSOs.' });
  });
});

describe('ADIF import', () => {
  const adif = (records: string[]) => `Exported by another logger <ADIF_VER:5>3.1.4 <EOH>\n${records.map((r) => `${r} <EOR>\n`).join('')}`;
  const f = (k: string, v: string) => `<${k}:${v.length}>${v}`;
  const rec = (call: string, time: string, extra = '') => `${f('CALL', call)} ${f('QSO_DATE', '20261015')} ${f('TIME_ON', time)} ${f('BAND', '20m')} ${f('MODE', 'FT8')}${extra}`;

  it('brings in what the log lacks as imported QSOs, and knows RR73’s own export by its ids', () => {
    const own = buildExport([A, B], '9V1NE', { programVersion: '0.20.0', now: T }).text;
    expect(plan(own, { qsos: [A, B], activations: [] })).toMatchObject({ kind: 'adif', qsos: [], already: 2 });
    const back = plan(own, { qsos: [], activations: [] });
    expect(back.qsos.map((q) => [q.id, q.call, q.source])).toEqual([
      [A.id, 'VK2ESN', 'import'],
      [B.id, 'JA1KXM', 'import'],
    ]);
    expect(back.ledger).toEqual([]);
  });

  it('takes a QSO with the same call, band and mode within 2 minutes as one the log holds, in the file too', () => {
    // B is JA1KXM on 20m FT8 at 08:05:00.
    const p = plan(adif([rec('JA1KXM', '080630'), rec('JA1KXM', '080800'), rec('K1ABC', '0900'), rec('K1ABC', '0901'), rec('JA1KXM', '0806', f('BAND', '40m'))]), { qsos: [B], activations: [] });
    expect(p.qsos.map((q) => `${q.call} ${q.band} ${new Date(q.start).toISOString().slice(11, 16)}`)).toEqual(['JA1KXM 20m 08:08', 'K1ABC 20m 09:00', 'JA1KXM 40m 08:06']);
    expect(p.already).toBe(2);
  });

  it('counts records it cannot read, and a deleted QSO does not hold its place', () => {
    const p = plan(adif([rec('ZL1TQK', '0809'), `${f('CALL', 'K1ABC')} ${f('BAND', '20m')}`]), { qsos: [C], activations: [] });
    expect(p.qsos.map((q) => q.call)).toEqual(['ZL1TQK']);
    expect(p.unreadable).toBe(1);
  });
});
