/**
 * The log as reactive state for the screens, and the actions that change it. The log in
 * IndexedDB is the record (ADR 0003); this module keeps a copy in memory, writes every change
 * through, keeps the ledger in step and runs the outbox.
 *
 * Sequencer wiring: on the logQso(record) effect, call `logQso(record)`. It stores the QSO,
 * queues it for each destination and shows "Logged … · Edit · Undo". `undoQso(id)` removes it.
 */

import { settings } from '../state/settings.svelte';
import { checkRefs } from './activation';
import { fileParts, markHandled, markSubmitted, reconcile, requeue, retry, UNDO_MS, type DestinationFacts } from './ledger';
import { Outbox, systemClock, type DestinationStatus, type SendingDestination } from './outbox';
import { adifChanged, createQso, displayMode, newId, stampActivation } from './qso';
import { loadSnapshot, saveChanges, saveLoggingSettings, type Changes } from './store';
import { byQso, reportsText } from './view';
import { wavelogAdapter } from './destinations';
import { testConnection, type FetchLike, type TestResult } from './wavelog';
import type {
  Activation,
  DestinationConfig,
  DestinationId,
  FileDestinationConfig,
  FileDestinationId,
  LedgerEntry,
  LoggingSettings,
  LogQsoRecord,
  Qso,
  Reference,
  WavelogConfig,
} from './types';

export const DEFAULT_WAVELOG: WavelogConfig = { id: 'wavelog', kind: 'wavelog', enabled: true, url: '', apiKey: '', stationId: null, stations: [], lastTest: null };
const FILE_IDS: FileDestinationId[] = ['adif-file', 'pota-file', 'sota-file', 'wwff-file'];
/** POTA, SOTA and WWFF files are on by default; the ADIF file per activation is off. */
export const DEFAULT_FILES: Record<FileDestinationId, FileDestinationConfig> = {
  'adif-file': { id: 'adif-file', kind: 'adif-file', enabled: false },
  'pota-file': { id: 'pota-file', kind: 'pota-file', enabled: true },
  'sota-file': { id: 'sota-file', kind: 'sota-file', enabled: true },
  'wwff-file': { id: 'wwff-file', kind: 'wwff-file', enabled: true },
};
export const DEFAULT_LOGGING: LoggingSettings = { sendAutomatically: true, sendEdits: true };

export const DESTINATION_NAMES: Record<DestinationId, string> = { wavelog: 'Wavelog', 'adif-file': 'ADIF', 'pota-file': 'POTA', 'sota-file': 'SOTA', 'wwff-file': 'WWFF' };

const STORAGE_FAILED = 'This phone refused to store the log. QSOs stay only until RR73 closes: export them as ADIF before closing.';

export function wavelogReady(w: WavelogConfig): boolean {
  return w.enabled && !!w.url && !!w.apiKey;
}

export interface LogNotice {
  /** Changes with every notice, so a new one restarts its timer. */
  seq: number;
  kind: 'logged' | 'deleted' | 'removed' | 'info';
  qsoId: string | null;
  text: string;
}

class LogState {
  ready = $state(false);
  /** Every QSO including tombstones, newest first. */
  qsos = $state.raw<Qso[]>([]);
  ledger = $state.raw<LedgerEntry[]>([]);
  activations = $state.raw<Activation[]>([]);
  wavelog = $state.raw<WavelogConfig>(DEFAULT_WAVELOG);
  files = $state.raw<Record<FileDestinationId, FileDestinationConfig>>(DEFAULT_FILES);
  settings = $state.raw<LoggingSettings>(DEFAULT_LOGGING);
  storageError = $state<string | null>(null);
  online = $state(true);
  /** When the phone went offline, UTC ms. */
  offlineSince = $state<number | null>(null);
  outbox = $state.raw<Partial<Record<DestinationId, DestinationStatus>>>({});
  notice = $state.raw<LogNotice | null>(null);
  /** The QSO sheet: closed, a new QSO (null id) or an existing one. */
  editor = $state.raw<{ open: boolean; qsoId: string | null }>({ open: false, qsoId: null });

  /** QSOs that are not deleted, newest first. */
  live = $derived(this.qsos.filter((q) => q.deletedAt === null));
  index = $derived(byQso(this.ledger));
  current = $derived(this.activations.find((a) => a.endedAt === null) ?? null);
  facts = $derived(destinationFacts(this.wavelog, this.files));
}

export const log = new LogState();

/** The ledger's view of the destinations. Wavelog's API cannot change a QSO it holds. */
export function destinationFacts(w: WavelogConfig, files: Record<FileDestinationId, FileDestinationConfig>): DestinationFacts[] {
  return [
    { id: 'wavelog', name: 'Wavelog', transport: 'direct', active: wavelogReady(w), canUpdate: false },
    ...FILE_IDS.map((id): DestinationFacts => ({ id, name: DESTINATION_NAMES[id], transport: 'file', active: files[id].enabled, canUpdate: false })),
  ];
}

const byId = new Map<string, Qso>();
const now = () => systemClock.now();
let fetchFn: FetchLike = (input, init) => fetch(input, init);

/** Tests replace fetch to talk to a fake Wavelog. */
export function setFetch(f: FetchLike) {
  fetchFn = f;
}

function activationOf(id: string | null): Activation | null {
  return id ? (log.activations.find((a) => a.id === id) ?? null) : null;
}

function entryOf(qsoId: string, dest: DestinationId): LedgerEntry | null {
  return log.index.get(qsoId)?.find((e) => e.destinationId === dest) ?? null;
}

/** The Wavelog station location for a QSO: its activation's, else the default. */
export function stationFor(q: Pick<Qso, 'activationId'>): string | null {
  return activationOf(q.activationId)?.wavelogStationId || log.wavelog.stationId;
}

/** Ledger entries for a QSO after a change, only those that differ. */
function settleQso(q: Qso, at: number, only?: DestinationId): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const dest of log.facts) {
    if (only && dest.id !== only) continue;
    const cur = entryOf(q.id, dest.id);
    const next = reconcile({ entry: cur, dest, qso: q, activation: activationOf(q.activationId), sendEdits: log.settings.sendEdits, now: at });
    if (next && JSON.stringify(next) !== JSON.stringify(cur)) out.push(next);
  }
  return out;
}

function sortQsos(list: Qso[]): Qso[] {
  return list.sort((a, b) => b.start - a.start || b.createdAt - a.createdAt);
}

/** Applies changes in memory first, so the screens and the outbox see them even when storage fails, then stores them. */
async function commit(c: Changes): Promise<void> {
  if (c.qsos?.length) {
    for (const q of c.qsos) byId.set(q.id, q);
    log.qsos = sortQsos([...byId.values()]);
  }
  if (c.ledger?.length) {
    const key = (e: LedgerEntry) => `${e.qsoId}|${e.destinationId}`;
    const m = new Map(log.ledger.map((e) => [key(e), e]));
    for (const e of c.ledger) m.set(key(e), e);
    log.ledger = [...m.values()];
  }
  if (c.activations?.length) {
    const m = new Map(log.activations.map((a) => [a.id, a]));
    for (const a of c.activations) m.set(a.id, a);
    log.activations = [...m.values()].sort((a, b) => b.startedAt - a.startedAt);
  }
  if (c.destinations?.length) {
    for (const d of c.destinations) {
      if (d.kind === 'wavelog') log.wavelog = d;
      else log.files = { ...log.files, [d.id]: d };
    }
  }
  try {
    await saveChanges(c);
  } catch {
    log.storageError = STORAGE_FAILED;
  }
}

/** The destinations the outbox sends to: Wavelog when set up. Relay destinations join here later. */
function sending(): SendingDestination[] {
  if (!wavelogReady(log.wavelog)) return [];
  const a = wavelogAdapter(log.wavelog, stationFor, fetchFn, now);
  return a.send ? [{ id: a.id, send: a.send }] : [];
}

export const outbox = new Outbox({
  clock: systemClock,
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  destinations: sending,
  entries: () => log.ledger,
  qso: (id) => byId.get(id),
  settle: (e) => {
    const q = byId.get(e.qsoId);
    const dest = log.facts.find((f) => f.id === e.destinationId);
    if (!q || !dest) return e;
    return reconcile({ entry: e, dest, qso: q, activation: activationOf(q.activationId), sendEdits: log.settings.sendEdits, now: now() }) ?? e;
  },
  commit: (ledger) => commit({ ledger }),
  onStatus: (id, s) => (log.outbox = { ...log.outbox, [id]: s }),
});

let loading: Promise<void> | null = null;

/** Loads the log from IndexedDB and starts the outbox. Safe to call more than once. */
export function loadLog(): Promise<void> {
  loading ??= (async () => {
    try {
      const s = await loadSnapshot();
      for (const q of s.qsos) byId.set(q.id, q);
      log.qsos = sortQsos([...byId.values()]);
      log.ledger = s.ledger;
      log.activations = s.activations.sort((a, b) => b.startedAt - a.startedAt);
      for (const d of s.destinations) {
        if (d.kind === 'wavelog') log.wavelog = { ...DEFAULT_WAVELOG, ...d };
        else if (FILE_IDS.includes(d.id)) log.files = { ...log.files, [d.id]: { ...DEFAULT_FILES[d.id], ...d } };
      }
      log.settings = { ...DEFAULT_LOGGING, ...s.settings };
    } catch {
      log.storageError = STORAGE_FAILED;
    }
    log.ready = true;
    watchNetwork();
    if (log.settings.sendAutomatically) outbox.start();
  })();
  return loading;
}

let watching = false;
function watchNetwork() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  log.online = navigator.onLine;
  log.offlineSince = navigator.onLine ? null : now();
  window.addEventListener('online', () => {
    log.online = true;
    log.offlineSince = null;
    outbox.online();
  });
  window.addEventListener('offline', () => {
    log.online = false;
    log.offlineSince = now();
  });
}

let askedToPersist = false;
/** Asks the browser not to evict the log under storage pressure. */
function persistStorage() {
  if (askedToPersist || typeof navigator === 'undefined') return;
  askedToPersist = true;
  const asked = navigator.storage?.persist?.();
  if (asked) void asked.catch(() => undefined);
}

/**
 * Stores a QSO and queues it for every destination. New QSOs wait UNDO_MS before the outbox
 * sends them, so Undo needs nothing from a destination. Returns the stored QSO.
 */
export async function addQso(record: LogQsoRecord): Promise<Qso> {
  await loadLog();
  const at = now();
  const activation = record.activationId === undefined ? log.current : activationOf(record.activationId);
  const q = createQso(record, { id: newId(), now: at, activation, callsign: settings.callsign });
  byId.set(q.id, q);
  await commit({ qsos: [q], ledger: settleQso(q, at) });
  persistStorage();
  outbox.kick();
  return q;
}

/** The sequencer's logQso effect: stores the QSO and shows "Logged … · Edit · Undo". */
export async function logQso(record: LogQsoRecord): Promise<Qso> {
  const q = await addQso(record);
  showLogged(q);
  return q;
}

/** Changes a QSO. Destinations that hold it see the change as Changed, or get it again where they accept changes. */
export async function updateQso(id: string, patch: Partial<Qso>): Promise<Qso> {
  await loadLog();
  const q = byId.get(id);
  if (!q) throw new Error(`No QSO ${id}`);
  const draft: Qso = { ...q, ...patch, id: q.id, createdAt: q.createdAt, source: q.source };
  if (!adifChanged(q, draft) && draft.deletedAt === q.deletedAt) return q;
  const at = Math.max(now(), q.updatedAt + 1);
  const next = { ...draft, updatedAt: at };
  byId.set(id, next);
  await commit({ qsos: [next], ledger: settleQso(next, at) });
  outbox.kick();
  return next;
}

async function setDeleted(id: string, deleted: boolean): Promise<Qso | null> {
  await loadLog();
  const q = byId.get(id);
  if (!q || (q.deletedAt !== null) === deleted) return q ?? null;
  const at = Math.max(now(), q.updatedAt + 1);
  const next = { ...q, deletedAt: deleted ? at : null, updatedAt: at };
  byId.set(id, next);
  await commit({ qsos: [next], ledger: settleQso(next, at) });
  outbox.kick();
  return next;
}

/** Deletes a QSO, keeping a tombstone so destinations that hold it can be told. */
export async function deleteQso(id: string): Promise<void> {
  const q = await setDeleted(id, true);
  if (q) show({ kind: 'deleted', qsoId: id, text: `Deleted ${q.call}` });
}

/** Undo from the logged notice: removes the QSO. Within 10 s of logging no destination has it yet. */
export async function undoQso(id: string): Promise<void> {
  const q = await setDeleted(id, true);
  if (q) show({ kind: 'removed', qsoId: id, text: `Removed ${q.call} from the log` });
}

/** Brings back a deleted QSO. */
export async function restoreQso(id: string): Promise<void> {
  const q = await setDeleted(id, false);
  if (q) show({ kind: 'info', qsoId: id, text: `Restored ${q.call}` });
}

let seq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function show(n: Omit<LogNotice, 'seq'>, ms = UNDO_MS) {
  log.notice = { ...n, seq: ++seq };
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (log.notice = null), ms);
}

/** "Logged ZL1TQK 20m FT8 −08 / −11" with Edit and Undo, for UNDO_MS. */
export function showLogged(q: Qso) {
  show({ kind: 'logged', qsoId: q.id, text: `Logged ${q.call} ${q.band} ${displayMode(q)} ${reportsText(q)}` });
}

export function dismissNotice() {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  log.notice = null;
}

/** Opens the QSO sheet: null for a new QSO. */
export function openEditor(qsoId: string | null) {
  log.editor = { open: true, qsoId };
}

export function closeEditor() {
  log.editor = { open: false, qsoId: log.editor.qsoId };
}

export interface ActivationInput {
  refs: Reference[];
  callsign: string;
  operator: string;
  grid: string;
  gridSource: Activation['gridSource'];
  wavelogStationId: string | null;
}

/** Starts an activation; QSOs logged from now on belong to it. */
export async function startActivation(input: ActivationInput): Promise<Activation> {
  await loadLog();
  const problem = checkRefs(input.refs);
  if (problem) throw new Error(problem);
  const at = now();
  const running = log.current;
  if (running) await endActivation(running.id);
  const a: Activation = { id: newId(), ...input, startedAt: at, endedAt: null, updatedAt: at };
  await commit({ activations: [a] });
  return a;
}

/** Changes an activation and restamps its QSOs: references, the call on air, the grid and the station location. */
export async function updateActivation(id: string, patch: Partial<ActivationInput>): Promise<Activation> {
  await loadLog();
  const a = activationOf(id);
  if (!a) throw new Error(`No activation ${id}`);
  if (patch.refs) {
    const problem = checkRefs(patch.refs);
    if (problem) throw new Error(problem);
  }
  const at = now();
  const next: Activation = { ...a, ...patch, updatedAt: at };
  await commit({ activations: [next] });
  const qsos: Qso[] = [];
  for (const q of byId.values()) {
    if (q.activationId !== id) continue;
    const stamped = stampActivation(q, next);
    if (adifChanged(q, stamped)) qsos.push({ ...stamped, updatedAt: Math.max(at, q.updatedAt + 1) });
  }
  for (const q of qsos) byId.set(q.id, q);
  const ledger = [...byId.values()].filter((q) => q.activationId === id).flatMap((q) => settleQso(q, at));
  // A new station location may cure refusals for this activation's QSOs.
  if (patch.wavelogStationId !== undefined && patch.wavelogStationId !== a.wavelogStationId) {
    ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.fix === 'wavelog-station' && byId.get(e.qsoId)?.activationId === id));
  }
  await commit({ qsos, ledger });
  outbox.kick();
  return next;
}

export async function endActivation(id: string): Promise<void> {
  const a = activationOf(id);
  if (!a || a.endedAt !== null) return;
  await commit({ activations: [{ ...a, endedAt: now(), updatedAt: now() }] });
}

/** Changes Wavelog's settings. A new address, key or station location sends refused QSOs again. */
export async function setWavelog(patch: Partial<WavelogConfig>): Promise<void> {
  await loadLog();
  const before = log.wavelog;
  const next: WavelogConfig = { ...before, ...patch, id: 'wavelog', kind: 'wavelog' };
  await commit({ destinations: [next] });
  const at = now();
  const ledger: LedgerEntry[] = [];
  if (next.url !== before.url || next.apiKey !== before.apiKey) {
    ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.scope === 'destination' || e.refusal?.fix === 'wavelog-address' || e.refusal?.fix === 'wavelog-key'));
  }
  if (next.stationId !== before.stationId) ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.fix === 'wavelog-station'));
  if (wavelogReady(next) !== wavelogReady(before)) for (const q of byId.values()) ledger.push(...settleQso(q, at, 'wavelog'));
  await commit({ ledger });
  outbox.kick();
}

/** Runs Test connection with the given address and key, and stores the result with the station locations. */
export async function testWavelog(cfg: Pick<WavelogConfig, 'url' | 'apiKey' | 'stationId'>): Promise<TestResult> {
  const r = await testConnection(cfg, fetchFn, now());
  const patch: Partial<WavelogConfig> = { lastTest: { at: r.at, ok: r.ok, message: r.message, rights: r.rights, version: r.version } };
  if (r.stations.length) patch.stations = r.stations;
  if (r.ok && !log.wavelog.stationId) patch.stationId = r.stationId;
  await setWavelog(patch);
  if (r.ok) {
    // The key and station location work now: send what was refused for them.
    await commit({ ledger: requeue(log.ledger, 'wavelog', now(), (e) => e.refusal?.scope === 'destination') });
    outbox.kick();
  }
  return r;
}

/** Removes the Wavelog address and key from this phone. QSOs keep their delivery history. */
export async function forgetWavelog(): Promise<void> {
  await setWavelog({ url: '', apiKey: '', stationId: null, stations: [], lastTest: null });
}

/** Switches a file destination on or off. Switching on adds the activation QSOs it takes. */
export async function setFileDestination(id: FileDestinationId, enabled: boolean): Promise<void> {
  await loadLog();
  const next: DestinationConfig = { ...log.files[id], enabled };
  await commit({ destinations: [next] });
  const at = now();
  await commit({ ledger: [...byId.values()].flatMap((q) => settleQso(q, at, id)) });
}

export async function setLoggingSettings(patch: Partial<LoggingSettings>): Promise<void> {
  await loadLog();
  log.settings = { ...log.settings, ...patch };
  try {
    await saveLoggingSettings(log.settings);
  } catch {
    log.storageError = STORAGE_FAILED;
  }
  if (log.settings.sendAutomatically) outbox.start();
  else outbox.stop();
}

/** Send again: one refused QSO back in the outbox, sent at once. */
export async function retryQso(qsoId: string, dest: DestinationId): Promise<void> {
  const e = entryOf(qsoId, dest);
  if (!e) return;
  await commit({ ledger: [retry(e, now())] });
  await outbox.sendNow();
}

/** The operator made the edit or delete at the destination by hand. */
export async function markQsoHandled(qsoId: string, dest: DestinationId): Promise<void> {
  const e = entryOf(qsoId, dest);
  const q = byId.get(qsoId);
  if (!e || !q) return;
  const keys = dest === 'wavelog' ? null : fileParts(dest, q, activationOf(q.activationId));
  await commit({ ledger: [markHandled(e, q, keys)] });
}

/** The operator uploaded one file: its QSOs move to submitted. */
export async function markFileSubmitted(partKey: string): Promise<void> {
  const at = now();
  const ledger = log.ledger.filter((e) => e.parts.some((p) => p.key === partKey)).map((e) => markSubmitted(e, partKey, byId.get(e.qsoId)!, at));
  await commit({ ledger });
}

/** The operator dealt with a file that changed after submission: corrected it, or removed the QSO there. */
export async function markFileHandled(partKey: string): Promise<void> {
  const ledger: LedgerEntry[] = [];
  for (const e of log.ledger) {
    if (e.state !== 'changed' || e.destinationId === 'wavelog' || !e.parts.some((p) => p.key === partKey)) continue;
    const q = byId.get(e.qsoId);
    if (q) ledger.push(markHandled(e, q, fileParts(e.destinationId, q, activationOf(q.activationId))));
  }
  await commit({ ledger });
}

/** Send now: every waiting QSO, whether or not RR73 sends by itself. */
export function sendNow(): Promise<void> {
  return outbox.sendNow();
}

/** Chooses the Wavelog station location for an activation, or the default for QSOs outside one, and sends refused QSOs again. */
export async function chooseStation(stationId: string, activationId: string | null): Promise<void> {
  if (activationId) await updateActivation(activationId, { wavelogStationId: stationId });
  else await setWavelog({ stationId });
}

export function qsoById(id: string): Qso | undefined {
  return byId.get(id);
}
