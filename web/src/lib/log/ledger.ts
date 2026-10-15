/**
 * The delivery ledger: one entry per QSO and destination, as pure functions of the entry, the
 * QSO, its activation and the destination (docs/design/log.md). No IndexedDB, fetch or timers.
 *
 * States: not sent (Send automatically is off and the operator has not sent it), waiting (in the
 * outbox), delivered, refused (not retried until the operator acts), changed (edited or deleted
 * after delivery or submission), file ready, submitted, not needed.
 *
 * Send automatically decides between the first two: with it off no entry is waiting, so nothing
 * goes out until the operator sends it; with it on no entry is not sent.
 */

import { utcDayKey } from './activation';
import type { Activation, DestinationId, FileDestinationId, LedgerEntry, Qso, Refusal, Transport } from './types';

/** New QSOs wait this long before the outbox sends them, so Undo on the logged notice needs no remote delete. */
export const UNDO_MS = 10_000;
/** Backoff after a failed send: 30 s, doubling to 30 min. */
export const BACKOFF_FIRST_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/** Wait after `failures` consecutive failures, ms. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_FIRST_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

/** What the ledger needs to know about a destination. */
export interface DestinationFacts {
  id: DestinationId;
  /** On screen: Wavelog, POTA. */
  name: string;
  transport: Transport;
  /** Switched on and set up: new QSOs get an entry and the outbox sends. */
  active: boolean;
  /** Accepts changes to QSOs it already holds. */
  canUpdate: boolean;
}

export function emptyEntry(qsoId: string, destinationId: DestinationId): LedgerEntry {
  return {
    qsoId,
    destinationId,
    state: 'not-needed',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
    refusal: null,
    remoteRef: null,
    deliveredAt: null,
    deliveredUpdatedAt: null,
    possibleDuplicate: false,
    duplicate: false,
    parts: [],
  };
}

export type FilePartKey =
  | { programme: 'POTA' | 'SOTA'; ref: string; day: string }
  | { programme: 'WWFF'; ref: string; activationId: string }
  | { programme: 'ADIF'; activationId: string };

export function partKey(p: FilePartKey): string {
  if (p.programme === 'ADIF') return `adif|${p.activationId}`;
  if (p.programme === 'WWFF') return `wwff|${p.ref}|${p.activationId}`;
  return `${p.programme.toLowerCase()}|${p.ref}|${p.day}`;
}

export function parsePartKey(key: string): FilePartKey | null {
  const [kind, a, b] = key.split('|');
  if (kind === 'adif' && a) return { programme: 'ADIF', activationId: a };
  if (kind === 'wwff' && a && b) return { programme: 'WWFF', ref: a, activationId: b };
  if ((kind === 'pota' || kind === 'sota') && a && b) return { programme: kind === 'pota' ? 'POTA' : 'SOTA', ref: a, day: b };
  return null;
}

/**
 * The files a QSO belongs to: POTA one per park and UTC day, SOTA one per summit and UTC day,
 * WWFF one per reference and activation, ADIF one per activation. QSOs outside an activation
 * belong to none.
 */
export function fileParts(dest: FileDestinationId, q: Qso, a: Activation | null): string[] {
  if (!a || q.activationId !== a.id) return [];
  const day = utcDayKey(q.start);
  if (dest === 'adif-file') return [partKey({ programme: 'ADIF', activationId: a.id })];
  if (dest === 'wwff-file') return a.refs.filter((r) => r.programme === 'WWFF').map((r) => partKey({ programme: 'WWFF', ref: r.ref, activationId: a.id }));
  const programme = dest === 'pota-file' ? 'POTA' : 'SOTA';
  return a.refs.filter((r) => r.programme === programme).map((r) => partKey({ programme, ref: r.ref, day }));
}

const editedNote = (d: DestinationFacts) =>
  d.transport === 'file'
    ? `Edited after the ${d.name} file was submitted. Submit a corrected file, then mark it handled.`
    : `Edited after ${d.name} received it. ${d.name} does not take changes from RR73: make the same edit in ${d.name}, then mark it handled.`;
const deletedNote = (d: DestinationFacts) =>
  d.transport === 'file'
    ? `Deleted after the ${d.name} file was submitted. Remove it from the ${d.name} log, then mark it handled.`
    : `Deleted on this phone after ${d.name} received it. Delete it in ${d.name} too, then mark it handled.`;

function waiting(e: LedgerEntry, now: number): LedgerEntry {
  return { ...e, state: 'waiting', attempts: 0, nextAttemptAt: now, lastError: null, refusal: null };
}

/** Ready to go: queued with Send automatically on, else not sent until the operator sends it. */
function ready(e: LedgerEntry, auto: boolean, at: number): LedgerEntry {
  return auto ? waiting(e, at) : { ...e, state: 'not-sent', attempts: 0, nextAttemptAt: null, lastError: null, refusal: null };
}

export interface ReconcileInput {
  entry: LedgerEntry | null;
  dest: DestinationFacts;
  qso: Qso;
  /** The QSO's activation, or null. */
  activation: Activation | null;
  /** Settings › Logging › Send edits to QSOs already sent. */
  sendEdits: boolean;
  /** Settings › Logging › Send automatically. */
  sendAutomatically: boolean;
  now: number;
}

/**
 * The entry after the QSO, its activation or the destination changed: a new QSO, an edit, a
 * delete, an Undo, a restore, an activation edit, or a destination switched on. Returns null
 * when the destination needs no entry.
 */
export function reconcile(i: ReconcileInput): LedgerEntry | null {
  return i.dest.transport === 'file' ? reconcileFile(i) : reconcileDirect(i);
}

function reconcileDirect({ entry, dest, qso, sendEdits, sendAutomatically: auto, now }: ReconcileInput): LedgerEntry | null {
  const deleted = qso.deletedAt !== null;
  // New and restored QSOs wait UNDO_MS before the outbox may send them.
  const hold = Math.max(now, qso.createdAt + UNDO_MS);
  if (!entry) {
    // Imported QSOs come from another log, which sends its own: they are not sent from here.
    if (!dest.active || deleted || qso.source === 'import') return null;
    return ready(emptyEntry(qso.id, dest.id), auto, hold);
  }
  const held = entry.deliveredAt !== null;
  const edited = entry.deliveredUpdatedAt !== null && qso.updatedAt > entry.deliveredUpdatedAt;
  const resend = dest.canUpdate && sendEdits;
  const gone = (e: LedgerEntry): LedgerEntry =>
    held ? { ...e, state: 'changed', nextAttemptAt: null, refusal: null, lastError: deletedNote(dest) } : { ...e, state: 'not-needed', nextAttemptAt: null, lastError: null, refusal: null };
  switch (entry.state) {
    case 'waiting':
      if (deleted) return gone(entry);
      // Send automatically switched off: what was queued waits for the operator, keeping why a send failed.
      return auto ? entry : { ...entry, state: 'not-sent', nextAttemptAt: null };
    case 'not-sent':
      if (deleted) return gone(entry);
      return auto ? { ...entry, state: 'waiting', nextAttemptAt: hold } : entry;
    case 'refused':
      if (deleted) return gone(entry);
      // An edit after a refusal of this QSO is the operator's fix: it is ready to send again.
      if (entry.refusal?.scope === 'qso' && entry.refusal.fix === 'edit-qso' && qso.updatedAt > (entry.lastAttemptAt ?? 0)) return ready(entry, auto, now);
      return entry;
    case 'delivered':
      if (deleted) return { ...entry, state: 'changed', lastError: deletedNote(dest) };
      if (edited) return resend ? ready(entry, auto, now) : { ...entry, state: 'changed', lastError: editedNote(dest) };
      return entry;
    case 'changed':
      if (deleted) return { ...entry, lastError: deletedNote(dest) };
      if (!edited) return { ...entry, state: 'delivered', lastError: null };
      return resend ? ready(entry, auto, now) : { ...entry, lastError: editedNote(dest) };
    case 'not-needed':
      if (deleted || !dest.active) return entry;
      if (held) return edited ? { ...entry, state: 'changed', lastError: editedNote(dest) } : { ...entry, state: 'delivered', lastError: null };
      // Restored after Undo or Delete.
      return ready(entry, auto, hold);
    default:
      return entry;
  }
}

function reconcileFile({ entry, dest, qso, activation }: ReconcileInput): LedgerEntry | null {
  const deleted = qso.deletedAt !== null;
  const keys = deleted ? [] : fileParts(dest.id as FileDestinationId, qso, activation);
  if (!entry) {
    if (!dest.active || deleted) return null;
    if (!keys.length) return emptyEntry(qso.id, dest.id);
    return { ...emptyEntry(qso.id, dest.id), state: 'file-ready', parts: keys.map((key) => ({ key, submittedAt: null })) };
  }
  if (!dest.active && entry.state === 'not-needed') return entry;
  const old = new Map(entry.parts.map((p) => [p.key, p.submittedAt]));
  const current = keys.map((key) => ({ key, submittedAt: old.get(key) ?? null }));
  // Submitted files that no longer hold this QSO: it was deleted, or its activation lost the reference.
  const stale = entry.parts.filter((p) => p.submittedAt !== null && !keys.includes(p.key));
  const parts = [...current, ...stale];
  if (stale.length) return { ...entry, parts, state: 'changed', lastError: deleted ? deletedNote(dest) : editedNote(dest) };
  if (!current.length) return { ...entry, parts, state: 'not-needed', lastError: null };
  const all = current.every((p) => p.submittedAt !== null);
  const edited = entry.deliveredUpdatedAt !== null && qso.updatedAt > entry.deliveredUpdatedAt;
  if (all && edited) return { ...entry, parts, state: 'changed', lastError: editedNote(dest) };
  return { ...entry, parts, state: all ? 'submitted' : 'file-ready', lastError: null };
}

/** What a destination said about one QSO. */
export type Receipt =
  | { qsoId: string; outcome: 'delivered'; remoteRef: string | null; duplicate: boolean }
  | { qsoId: string; outcome: 'refused'; message: string; refusal: Refusal }
  | { qsoId: string; outcome: 'retry'; message: string; timeout: boolean; retryAfterMs: number | null };

/**
 * The entry after a send. `sentUpdatedAt` is the QSO's updatedAt when it was sent, so an edit
 * made while the request was in flight shows as changed after the next reconcile. `retryAt` is
 * when the outbox will try again after a failure.
 */
export function applyReceipt(entry: LedgerEntry, r: Receipt, sentUpdatedAt: number, now: number, retryAt: number): LedgerEntry {
  const e: LedgerEntry = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now };
  if (r.outcome === 'delivered') {
    return {
      ...e,
      state: 'delivered',
      deliveredAt: now,
      deliveredUpdatedAt: sentUpdatedAt,
      remoteRef: r.remoteRef ?? e.remoteRef,
      duplicate: r.duplicate,
      possibleDuplicate: false,
      lastError: null,
      refusal: null,
      nextAttemptAt: null,
    };
  }
  if (r.outcome === 'refused') return { ...e, state: 'refused', lastError: r.message, refusal: r.refusal, nextAttemptAt: null };
  return { ...e, state: 'waiting', lastError: r.message, nextAttemptAt: retryAt, possibleDuplicate: e.possibleDuplicate || r.timeout };
}

/** Every waiting or not-sent entry of a destination, refused for the destination-wide reason another QSO met. */
export function refuseWaiting(entries: readonly LedgerEntry[], dest: DestinationId, message: string, refusal: Refusal): LedgerEntry[] {
  return entries
    .filter((e) => e.destinationId === dest && (e.state === 'waiting' || e.state === 'not-sent'))
    .map((e) => ({ ...e, state: 'refused', lastError: message, refusal, nextAttemptAt: null }));
}

/**
 * Refused entries of a destination ready again, after the operator changed what caused them:
 * back in the outbox with Send automatically on, else not sent.
 */
export function requeue(entries: readonly LedgerEntry[], dest: DestinationId, now: number, which: (e: LedgerEntry) => boolean = () => true, auto = true): LedgerEntry[] {
  return entries.filter((e) => e.destinationId === dest && e.state === 'refused' && which(e)).map((e) => ready(e, auto, now));
}

/** Send again: one refused entry back in the outbox. */
export function retry(entry: LedgerEntry, now: number): LedgerEntry {
  return entry.state === 'refused' ? waiting(entry, now) : entry;
}

/**
 * The operator made the edit or delete at the destination by hand. `fileKeys` are the files the
 * QSO belongs to now (file destinations), or null for a direct destination.
 */
export function markHandled(entry: LedgerEntry, qso: Qso, fileKeys: readonly string[] | null): LedgerEntry {
  if (entry.state !== 'changed') return entry;
  if (qso.deletedAt !== null) {
    // Deleted there too: the destination holds nothing, so a later restore sends it again.
    return { ...entry, state: 'not-needed', lastError: null, deliveredAt: null, deliveredUpdatedAt: null, parts: [] };
  }
  if (fileKeys === null) return { ...entry, state: 'delivered', lastError: null, deliveredUpdatedAt: qso.updatedAt };
  const parts = entry.parts.filter((p) => fileKeys.includes(p.key));
  const all = parts.length > 0 && parts.every((p) => p.submittedAt !== null);
  return { ...entry, parts, state: all ? 'submitted' : parts.length ? 'file-ready' : 'not-needed', lastError: null, deliveredUpdatedAt: qso.updatedAt };
}

/** The operator confirmed uploading one file: its QSOs move from file ready to submitted once every file holding them is. */
export function markSubmitted(entry: LedgerEntry, key: string, qso: Qso, now: number): LedgerEntry {
  if (!entry.parts.some((p) => p.key === key)) return entry;
  const parts = entry.parts.map((p) => (p.key === key ? { ...p, submittedAt: now } : p));
  const all = parts.every((p) => p.submittedAt !== null);
  return { ...entry, parts, state: all ? 'submitted' : entry.state, deliveredAt: now, deliveredUpdatedAt: qso.updatedAt, lastError: null };
}

/**
 * The oldest QSO that is due at a destination: waiting, and its next attempt time has come (or
 * `force`). Oldest by start time, then by when it was logged; `orderOf` gives both for a QSO.
 */
export function pickNext(
  entries: readonly LedgerEntry[],
  dest: DestinationId,
  now: number,
  orderOf: (qsoId: string) => readonly [start: number, loggedAt: number],
  force = false,
): LedgerEntry | null {
  let best: LedgerEntry | null = null;
  let bestKey: readonly [number, number] = [Infinity, Infinity];
  for (const e of entries) {
    if (e.destinationId !== dest || e.state !== 'waiting') continue;
    if (!force && (e.nextAttemptAt ?? 0) > now) continue;
    const k = orderOf(e.qsoId);
    const before = k[0] < bestKey[0] || (k[0] === bestKey[0] && (k[1] < bestKey[1] || (k[1] === bestKey[1] && best !== null && e.qsoId < best.qsoId)));
    if (!best || before) {
      best = e;
      bestKey = k;
    }
  }
  return best;
}

/** The earliest next attempt among waiting entries of these destinations, or null. */
export function earliestAttempt(entries: readonly LedgerEntry[], dests: readonly DestinationId[]): number | null {
  let t: number | null = null;
  for (const e of entries) {
    if (e.state !== 'waiting' || !dests.includes(e.destinationId)) continue;
    const n = e.nextAttemptAt ?? 0;
    if (t === null || n < t) t = n;
  }
  return t;
}
