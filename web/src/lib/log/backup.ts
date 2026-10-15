/**
 * The RR73 backup and log import.
 *
 * A backup is one JSON file: every QSO (deleted ones as tombstones), every activation, and what
 * each destination holds (the ledger). Destination settings stay out, so the Wavelog API key
 * never leaves the phone in a file.
 *
 * Import reads a backup or an ADIF file from any logger. From a backup, QSOs and activations the
 * log does not hold come back with their ledger, so what Wavelog has stays sent. From ADIF, each
 * QSO comes in as an import, unless the log holds it already: the same RR73 id (APP_RR73_ID), or
 * the same call, band and mode within 2 minutes. Imported QSOs are not sent to Wavelog: they come
 * from another log.
 */

import { utcDayKey } from './activation';
import { parseAdif } from './adif';
import { safeName, type ExportFile, type FileOptions } from './files';
import { callKey } from './worked';
import { recordToQso, type ReadContext } from './qso-adif';
import { withAllFields } from './qso';
import { DESTINATION_IDS, LEDGER_STATES, PROGRAMMES, type Activation, type LedgerEntry, type Qso } from './types';

export const BACKUP_FORMAT = 'rr73-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** RR73's version that wrote it. */
  app: string;
  /** When, ISO 8601 UTC. */
  exportedAt: string;
  qsos: Qso[];
  activations: Activation[];
  ledger: LedgerEntry[];
}

/** The backup file, "RR73 backup 9V1NE 20261015.json". */
export function buildBackup(data: { qsos: readonly Qso[]; activations: readonly Activation[]; ledger: readonly LedgerEntry[] }, callsign: string, opts: FileOptions): ExportFile {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: opts.programVersion,
    exportedAt: new Date(opts.now).toISOString(),
    qsos: [...data.qsos].sort((a, b) => a.start - b.start),
    activations: [...data.activations].sort((a, b) => a.startedAt - b.startedAt),
    ledger: [...data.ledger],
  };
  return { name: `RR73 backup ${safeName(callsign || 'log')} ${utcDayKey(opts.now)}.json`, text: JSON.stringify(backup) };
}

/** What an import adds, and what it leaves out. */
export interface ImportPlan {
  kind: 'backup' | 'adif';
  qsos: Qso[];
  activations: Activation[];
  ledger: LedgerEntry[];
  /** QSOs the log holds already. */
  already: number;
  /** Records that could not be read. */
  unreadable: number;
}

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; reason: string };

/** Within this of a QSO in the log, a QSO from ADIF with the same call, band and mode is the same QSO, ms. */
export const SAME_QSO_MS = 120_000;

const NOT_A_LOG = 'The file is neither ADIF nor an RR73 backup.';

/** Plans the import of `text` into a log holding `qsos` and `activations`. */
export function planImport(text: string, log: { qsos: readonly Qso[]; activations: readonly Activation[] }, ctx: ReadContext): ImportResult {
  const t = text.replace(/^﻿/, '').trimStart();
  return t.startsWith('{') ? planBackup(t, log) : planAdif(t, log, ctx);
}

const sameKey = (q: Pick<Qso, 'call' | 'band' | 'mode' | 'submode'>) => `${callKey(q.call)} ${q.band.toLowerCase()} ${q.mode.toUpperCase()} ${q.submode.toUpperCase()}`;

function planAdif(text: string, log: { qsos: readonly Qso[] }, ctx: ReadContext): ImportResult {
  const file = parseAdif(text);
  if (!file.records.length) return { ok: false, reason: /<eoh>|<eor>/i.test(text) ? 'The ADIF file holds no QSOs.' : NOT_A_LOG };
  const ids = new Set(log.qsos.map((q) => q.id));
  const starts = new Map<string, number[]>();
  const note = (q: Qso) => {
    const k = sameKey(q);
    starts.set(k, [...(starts.get(k) ?? []), q.start]);
  };
  for (const q of log.qsos) if (q.deletedAt === null) note(q);
  const plan: ImportPlan = { kind: 'adif', qsos: [], activations: [], ledger: [], already: 0, unreadable: 0 };
  for (const rec of file.records) {
    const r = recordToQso(rec, ctx);
    if (!r.ok) {
      plan.unreadable++;
      continue;
    }
    const q = r.qso;
    if (ids.has(q.id) || (starts.get(sameKey(q)) ?? []).some((s) => Math.abs(s - q.start) < SAME_QSO_MS)) {
      plan.already++;
      continue;
    }
    ids.add(q.id);
    note(q);
    plan.qsos.push(q);
  }
  return { ok: true, plan };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || num(v);

function readQso(v: unknown): Qso | null {
  if (!isObject(v)) return null;
  const ok = str(v.id) && str(v.call) && v.call !== '' && str(v.band) && str(v.mode) && num(v.start) && num(v.end) && num(v.createdAt) && num(v.updatedAt) && numOrNull(v.deletedAt) && (v.activationId === null || str(v.activationId));
  return ok ? withAllFields(v as unknown as Qso) : null;
}

function readActivation(v: unknown): Activation | null {
  if (!isObject(v)) return null;
  const refs = Array.isArray(v.refs) && v.refs.every((r) => isObject(r) && PROGRAMMES.includes(r.programme as never) && str(r.ref));
  if (!(str(v.id) && refs && str(v.callsign) && num(v.startedAt) && numOrNull(v.endedAt) && num(v.updatedAt))) return null;
  const defaults: Pick<Activation, 'operator' | 'grid' | 'gridSource' | 'wavelogStationId'> = { operator: '', grid: '', gridSource: 'none', wavelogStationId: null };
  return { ...defaults, ...(v as Partial<Activation>) } as Activation;
}

function readEntry(v: unknown): LedgerEntry | null {
  if (!isObject(v)) return null;
  return str(v.qsoId) && DESTINATION_IDS.includes(v.destinationId as never) && LEDGER_STATES.includes(v.state as never) ? (v as unknown as LedgerEntry) : null;
}

function planBackup(text: string, log: { qsos: readonly Qso[]; activations: readonly Activation[] }): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: NOT_A_LOG };
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT) return { ok: false, reason: NOT_A_LOG };
  if (!num(data.version) || (data.version as number) > BACKUP_VERSION) return { ok: false, reason: `The backup is from a newer RR73 (${str(data.app) ? data.app : 'unknown version'}). Update RR73 to restore it.` };
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]) : []);
  const ids = new Set(log.qsos.map((q) => q.id));
  const activationIds = new Set(log.activations.map((a) => a.id));
  const plan: ImportPlan = { kind: 'backup', qsos: [], activations: [], ledger: [], already: 0, unreadable: 0 };
  for (const v of list('qsos')) {
    const q = readQso(v);
    if (!q) plan.unreadable++;
    else if (ids.has(q.id)) plan.already++;
    else {
      ids.add(q.id);
      plan.qsos.push(q);
    }
  }
  for (const v of list('activations')) {
    const a = readActivation(v);
    if (a && !activationIds.has(a.id)) {
      activationIds.add(a.id);
      plan.activations.push(a);
    }
  }
  const added = new Set(plan.qsos.map((q) => q.id));
  for (const v of list('ledger')) {
    const e = readEntry(v);
    if (e && added.has(e.qsoId)) plan.ledger.push(e);
  }
  // A QSO whose activation is neither in the log nor in the backup keeps out of activations.
  for (const q of plan.qsos) if (q.activationId !== null && !activationIds.has(q.activationId)) q.activationId = null;
  return { ok: true, plan };
}

/** "Imported 132 QSOs. 4 were in the log already." */
export function importText(p: ImportPlan): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [p.qsos.length ? `Imported ${n(p.qsos.length, 'QSO', 'QSOs')}${p.activations.length ? ` and ${n(p.activations.length, 'activation', 'activations')}` : ''}.` : 'No QSOs to import.'];
  if (p.already) parts.push(`${p.already} ${p.already === 1 ? 'was' : 'were'} in the log already.`);
  if (p.unreadable) parts.push(`${n(p.unreadable, 'record', 'records')} could not be read.`);
  return parts.join(' ');
}
