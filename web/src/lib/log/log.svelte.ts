/**
 * The log as reactive state for the screens, and the actions that change it. The log in
 * IndexedDB is the record (ADR 0003); this module keeps a copy in memory, writes every change
 * through, keeps the ledger in step and runs the outbox.
 *
 * Sequencer wiring: on the logQso(record) effect, call `logQso(record)`. It stores the QSO,
 * queues it for each destination and shows "Logged … · Edit · Undo". `undoQso(id)` removes it.
 *
 * Send automatically is off by default: QSOs wait as not sent until the operator reviews the log
 * and taps Send to Wavelog (`sendToWavelog`). With it on, the outbox sends by itself as in 0.5.0.
 */

import { features } from '../state/features.svelte';
import { settings } from '../state/settings.svelte';
import { checkRefs } from './activation';
import { fileParts, markHandled, markSubmitted, reconcile, requeue, retry, UNDO_MS, type DestinationFacts } from './ledger';
import { migrateLogging } from './migrations';
import { Outbox, systemClock, type DestinationStatus, type SendingDestination } from './outbox';
import { adifChanged, createQso, displayMode, newId, stampActivation, withAllFields } from './qso';
import { loadSnapshot, removeRecords, saveChanges, saveLoggingSettings, saveMigrations, setLogStore, type Changes } from './store';
import { buildBackup, importText, planImport, type ImportPlan, type ImportResult } from './backup';
import type { ExportFile } from './files';
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

export const DEFAULT_WAVELOG: WavelogConfig = { id: 'wavelog', kind: 'wavelog', enabled: true, url: '', apiKey: '', stationId: null, stations: [], lastTest: null, readWorked: false };
const FILE_IDS: FileDestinationId[] = ['adif-file', 'pota-file', 'sota-file', 'wwff-file'];
/** POTA, SOTA and WWFF files are on by default; the ADIF file per activation is off. */
export const DEFAULT_FILES: Record<FileDestinationId, FileDestinationConfig> = {
  'adif-file': { id: 'adif-file', kind: 'adif-file', enabled: false },
  'pota-file': { id: 'pota-file', kind: 'pota-file', enabled: true },
  'sota-file': { id: 'sota-file', kind: 'sota-file', enabled: true },
  'wwff-file': { id: 'wwff-file', kind: 'wwff-file', enabled: true },
};
/** The operator reviews the log before anything goes to Wavelog, so sending automatically starts off. */
export const DEFAULT_LOGGING: LoggingSettings = { sendAutomatically: false, sendEdits: true };

export const DESTINATION_NAMES: Record<DestinationId, string> = { wavelog: 'Wavelog', 'adif-file': 'ADIF', 'pota-file': 'POTA', 'sota-file': 'SOTA', 'wwff-file': 'WWFF' };

const STORAGE_FAILED = 'This phone refused to store the log. QSOs stay only until RR73 closes: export them as ADIF before closing.';

/**
 * Wavelog takes QSOs once it has an address, a key and a station location, which a passing Test
 * connection chooses. Until then QSOs get no Wavelog entry, and get one when it is ready.
 */
export function wavelogReady(w: WavelogConfig): boolean {
  return w.enabled && !!w.url && !!w.apiKey && !!w.stationId;
}

export interface LogNotice {
  /** Changes with every notice, so a new one restarts its timer. */
  seq: number;
  kind: 'logged' | 'deleted' | 'removed' | 'info' | 'cleared';
  qsoId: string | null;
  text: string;
  /** Undo for a 'cleared' notice. */
  undo?: () => void;
}

class LogState {
  ready = $state(false);
  /** The practice log is loaded (store.ts), or loading. Changes with the data, so it holds whenever `ready` is true. */
  practice = $state(false);
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
  /** The QSO sheet: closed, a new QSO (null id), an existing one, or a keyboard mode's strip to log. */
  editor = $state.raw<{ open: boolean; qsoId: string | null; draft?: QsoDraftInit | null }>({ open: false, qsoId: null });
  /** Send to Wavelog: progress while it runs, then what happened. */
  sync = $state.raw<SyncState>({ running: false, total: 0, done: 0, summary: null });

  /** QSOs that are not deleted, newest first. */
  live = $derived(this.qsos.filter((q) => q.deletedAt === null));
  index = $derived(byQso(this.ledger));
  current = $derived(this.activations.find((a) => a.endedAt === null) ?? null);
  facts = $derived(destinationFacts(this.wavelog, this.files));
}

export interface SyncSummary {
  at: number;
  total: number;
  delivered: number;
  refused: number;
  /** Tried and failed (network, server), or not tried because a failure stopped the run. */
  unsent: number;
  /** "3 delivered. 1 refused: see To do." */
  text: string;
  ok: boolean;
}

export interface SyncState {
  running: boolean;
  total: number;
  /** QSOs Wavelog has answered for so far. */
  done: number;
  summary: SyncSummary | null;
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
const pageFetch: FetchLike = (input, init) => fetch(input, init);
let fetchFn: FetchLike = pageFetch;

/** Tests replace fetch to talk to a fake Wavelog, and the practice log to talk to its stand-in. Null restores the page's fetch. */
export function setFetch(f: FetchLike | null) {
  fetchFn = f ?? pageFetch;
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
    const next = reconcile({ entry: cur, dest, qso: q, activation: activationOf(q.activationId), sendEdits: log.settings.sendEdits, sendAutomatically: log.settings.sendAutomatically, now: at });
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
    if (log.sync.running) trackProgress();
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
  const a = wavelogAdapter(log.wavelog, stationFor, fetchFn, now, () => log.settings.sendAutomatically);
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
    return reconcile({ entry: e, dest, qso: q, activation: activationOf(q.activationId), sendEdits: log.settings.sendEdits, sendAutomatically: log.settings.sendAutomatically, now: now() }) ?? e;
  },
  commit: async (ledger) => {
    await commit({ ledger });
    if (ledger.some((e) => e.destinationId === 'wavelog' && e.state === 'delivered')) for (const fn of delivered) fn();
  },
  onStatus: (id, s) => (log.outbox = { ...log.outbox, [id]: s }),
});

const delivered = new Set<() => void>();

/** Calls `fn` after Wavelog takes a QSO. Returns the function that stops it. */
export function onDelivered(fn: () => void): () => void {
  delivered.add(fn);
  return () => delivered.delete(fn);
}

let loading: Promise<void> | null = null;

/** Loads the log from IndexedDB and starts the outbox. Safe to call more than once. */
export function loadLog(): Promise<void> {
  loading ??= (async () => {
    try {
      const s = await loadSnapshot();
      for (const q of s.qsos) byId.set(q.id, withAllFields(q));
      log.qsos = sortQsos([...byId.values()]);
      log.ledger = s.ledger;
      log.activations = s.activations.sort((a, b) => b.startedAt - a.startedAt);
      for (const d of s.destinations) {
        if (d.kind === 'wavelog') log.wavelog = { ...DEFAULT_WAVELOG, ...d };
        else if (FILE_IDS.includes(d.id)) log.files = { ...log.files, [d.id]: { ...DEFAULT_FILES[d.id], ...d } };
      }
      const m = migrateLogging(s.settings, s.migrations, DEFAULT_LOGGING);
      log.settings = m.settings;
      if (m.changed) {
        await saveLoggingSettings(m.settings);
        await saveMigrations(m.applied);
      }
    } catch {
      log.storageError = STORAGE_FAILED;
    }
    // Entries follow Send automatically: none waiting while it is off, none not sent while it is on.
    const at = now();
    await commit({ ledger: [...byId.values()].flatMap((q) => settleQso(q, at, 'wavelog')) });
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

let practiceLog = false;

/**
 * Switches between the log and the practice log (a database of its own, store.ts). The outbox
 * stops, the copy in memory is dropped and the chosen log loads. Nothing is written to the
 * log being left.
 */
export async function useLog(practice: boolean, again = false): Promise<void> {
  if (!again && practice === practiceLog && loading) return loading;
  practiceLog = practice;
  outbox.stop();
  await loading?.catch(() => undefined);
  setLogStore(practice);
  byId.clear();
  log.ready = false;
  log.practice = practice;
  log.qsos = [];
  log.ledger = [];
  log.activations = [];
  log.wavelog = DEFAULT_WAVELOG;
  log.files = DEFAULT_FILES;
  log.settings = DEFAULT_LOGGING;
  log.outbox = {};
  log.sync = { running: false, total: 0, done: 0, summary: null };
  log.storageError = null;
  log.editor = { open: false, qsoId: null };
  dismissNotice();
  loading = null;
  await loadLog();
}

/** Loads the current log again from storage, after Clear practice log or its Undo. */
export function reloadLog(): Promise<void> {
  return useLog(practiceLog, true);
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
  // With Activations off (Settings › Optional features) a running activation is hidden, and new QSOs stay out of it.
  const activation = record.activationId === undefined ? (features.activations ? log.current : null) : activationOf(record.activationId);
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
  if (!adifChanged(q, draft) && draft.deletedAt === q.deletedAt && draft.activationId === q.activationId) return q;
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

/** The backup file of the log (lib/log/backup.ts), built at once so the share sheet keeps the tap. */
export function backupFile(): ExportFile {
  return buildBackup({ qsos: log.qsos, activations: log.activations, ledger: log.ledger }, settings.callsign, { programVersion: __APP_VERSION__, now: now() });
}

/**
 * Imports a backup or an ADIF file into the log, and says what came in with Undo. Returns why
 * the file was refused, or what was imported.
 */
export async function importLog(text: string): Promise<ImportResult> {
  await loadLog();
  const r = planImport(text, { qsos: log.qsos, activations: log.activations }, { now: now(), newId });
  if (!r.ok) return r;
  const p = r.plan;
  const any = p.qsos.length > 0 || p.activations.length > 0;
  if (any) {
    await commit({ qsos: p.qsos, activations: p.activations, ledger: p.ledger });
    persistStorage();
    outbox.kick();
  }
  show({ kind: 'cleared', qsoId: null, text: importText(p), undo: any ? () => void undoImport(p) : undefined });
  return r;
}

/** Takes an import back out of the log: its QSOs, their ledger and its activations. */
async function undoImport(p: ImportPlan): Promise<void> {
  const qsoIds = new Set(p.qsos.map((q) => q.id));
  const activationIds = new Set(p.activations.map((a) => a.id));
  for (const id of qsoIds) byId.delete(id);
  log.qsos = sortQsos([...byId.values()]);
  log.ledger = log.ledger.filter((e) => !qsoIds.has(e.qsoId));
  log.activations = log.activations.filter((a) => !activationIds.has(a.id));
  try {
    await removeRecords({ qsoIds: [...qsoIds], activationIds: [...activationIds] });
  } catch {
    log.storageError = STORAGE_FAILED;
  }
  const n = p.qsos.length;
  show({ kind: 'info', qsoId: null, text: `Removed the ${n} imported ${n === 1 ? 'QSO' : 'QSOs'}` });
}

let seq = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function show(n: Omit<LogNotice, 'seq'>, ms = UNDO_MS) {
  log.notice = { ...n, seq: ++seq };
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (log.notice = null), ms);
}

/** A notice from outside the log, such as Clear practice log with its Undo. */
export function notify(n: Omit<LogNotice, 'seq'>) {
  show(n);
}

/** "Logged ZL1TQK 20m FT8 −08 / −11" with Edit and Undo, for UNDO_MS. */
export function showLogged(q: Qso) {
  show({ kind: 'logged', qsoId: q.id, text: ['Logged', q.call, q.band, displayMode(q), reportsText(q)].filter(Boolean).join(' ') });
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

/** A keyboard mode's QSO strip, opened in the QSO sheet to log (the strip's chevron). */
export interface QsoDraftInit {
  call: string;
  startMs: number;
  band: string;
  mode: 'RTTY';
  /** Dial plus mark tone, Hz. */
  freqHz: number;
  rstSent: string;
  rstRcvd: string;
  name: string;
  qth: string;
  grid: string;
  notes: string;
  /** Contest serial numbers, sent and received; '' outside the Contest set. */
  stx: string;
  srx: string;
  contestId: string;
  /** Called once the sheet has logged the QSO: the strip clears and the serial steps on. */
  onlogged: () => void;
}

/** Opens the QSO sheet with a keyboard mode's strip, to log it. */
export function openDraft(draft: QsoDraftInit) {
  log.editor = { open: true, qsoId: null, draft };
}

export function closeEditor() {
  log.editor = { open: false, qsoId: log.editor.qsoId, draft: null };
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
    ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.fix === 'wavelog-station' && byId.get(e.qsoId)?.activationId === id, log.settings.sendAutomatically));
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
    ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.scope === 'destination' || e.refusal?.fix === 'wavelog-address' || e.refusal?.fix === 'wavelog-key', log.settings.sendAutomatically));
  }
  if (next.stationId !== before.stationId) ledger.push(...requeue(log.ledger, 'wavelog', at, (e) => e.refusal?.fix === 'wavelog-station', log.settings.sendAutomatically));
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
    await commit({ ledger: requeue(log.ledger, 'wavelog', now(), (e) => e.refusal?.scope === 'destination', log.settings.sendAutomatically) });
    outbox.kick();
  }
  return r;
}

/**
 * Removes the Wavelog address and key from this phone, and what Read Wavelog's log read with them.
 * QSOs keep their delivery history.
 */
export async function forgetWavelog(): Promise<void> {
  await setWavelog({ url: '', apiKey: '', stationId: null, stations: [], lastTest: null, readWorked: false });
}

/** Switches a file destination on or off. Switching on adds the activation QSOs it takes. */
export async function setFileDestination(id: FileDestinationId, enabled: boolean): Promise<void> {
  await loadLog();
  const next: DestinationConfig = { ...log.files[id], enabled };
  await commit({ destinations: [next] });
  const at = now();
  await commit({ ledger: [...byId.values()].flatMap((q) => settleQso(q, at, id)) });
}

/**
 * Changes the logging settings. Switching Send automatically on queues every QSO not sent;
 * switching it off takes what is queued back to not sent.
 */
export async function setLoggingSettings(patch: Partial<LoggingSettings>): Promise<void> {
  await loadLog();
  const before = log.settings;
  log.settings = { ...log.settings, ...patch };
  try {
    await saveLoggingSettings(log.settings);
  } catch {
    log.storageError = STORAGE_FAILED;
  }
  if (log.settings.sendAutomatically !== before.sendAutomatically) {
    const at = now();
    await commit({ ledger: [...byId.values()].flatMap((q) => settleQso(q, at, 'wavelog')) });
  }
  if (log.settings.sendAutomatically) outbox.start();
  else outbox.stop();
}

/** Send again: one refused QSO sent at once. */
export async function retryQso(qsoId: string, dest: DestinationId): Promise<void> {
  if (dest === 'wavelog') await sendToWavelog([qsoId]);
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

/** Wavelog entries ready to send: not sent, or queued, for QSOs that are not deleted. */
export function unsentForWavelog(): LedgerEntry[] {
  return log.ledger.filter((e) => e.destinationId === 'wavelog' && (e.state === 'not-sent' || e.state === 'waiting') && byId.get(e.qsoId)?.deletedAt === null);
}

let batch: { ids: Set<string>; start: number } | null = null;

function trackProgress() {
  if (!batch) return;
  const b = batch;
  const done = log.ledger.filter((e) => e.destinationId === 'wavelog' && b.ids.has(e.qsoId) && (e.lastAttemptAt ?? 0) >= b.start).length;
  if (done !== log.sync.done) log.sync = { ...log.sync, done };
}

/**
 * Send to Wavelog: every QSO not yet sent (or the ones given, refused ones included), oldest
 * first, one request each. Progress shows in `log.sync`; the summary is returned, kept in
 * `log.sync.summary` and shown as a notice. A refused key or a failure stops the run; with Send
 * automatically off, QSOs left unsent stay not sent.
 */
export async function sendToWavelog(qsoIds?: readonly string[]): Promise<SyncSummary | null> {
  await loadLog();
  if (log.sync.running) return null;
  const want = qsoIds ? new Set(qsoIds) : null;
  const picked = (want ? log.ledger.filter((e) => e.destinationId === 'wavelog' && want.has(e.qsoId) && ['not-sent', 'waiting', 'refused'].includes(e.state)) : unsentForWavelog())
    .filter((e) => byId.get(e.qsoId)?.deletedAt === null)
    .sort((a, b) => byId.get(a.qsoId)!.start - byId.get(b.qsoId)!.start || byId.get(a.qsoId)!.createdAt - byId.get(b.qsoId)!.createdAt);
  if (!picked.length) return null;
  const start = now();
  batch = { ids: new Set(picked.map((e) => e.qsoId)), start };
  log.sync = { running: true, total: picked.length, done: 0, summary: null };
  try {
    // Queued: the outbox sends waiting entries only.
    await commit({ ledger: picked.map((e) => (e.state === 'refused' ? retry(e, start) : { ...e, state: 'waiting', nextAttemptAt: start })) });
    await outbox.sendNow();
  } finally {
    // Left queued when a failure stopped the run: not sent again while Send automatically is off.
    const at = now();
    const ids = batch.ids;
    batch = null;
    await commit({ ledger: [...ids].flatMap((id) => settleQso(byId.get(id)!, at, 'wavelog')) });
    const summary = summarise(ids, start);
    log.sync = { running: false, total: picked.length, done: summary.delivered + summary.refused, summary };
    show({ kind: 'info', qsoId: ids.size === 1 ? [...ids][0] : null, text: summary.text });
  }
  return log.sync.summary;
}

function summarise(ids: Set<string>, start: number): SyncSummary {
  const entries = log.ledger.filter((e) => e.destinationId === 'wavelog' && ids.has(e.qsoId));
  const delivered = entries.filter((e) => (e.state === 'delivered' || e.state === 'changed') && (e.deliveredAt ?? 0) >= start);
  const refused = entries.filter((e) => e.state === 'refused');
  const unsent = entries.filter((e) => e.state === 'not-sent' || e.state === 'waiting');
  const failure = unsent.find((e) => e.lastError && (e.lastAttemptAt ?? 0) >= start)?.lastError ?? null;
  const auto = log.settings.sendAutomatically;
  const parts: string[] = [];
  if (ids.size === 1) {
    const call = byId.get([...ids][0])?.call ?? 'The QSO';
    if (delivered.length) parts.push(`Delivered ${call} to Wavelog.`);
    else if (refused.length) parts.push(`Wavelog refused ${call}: see To do.`);
    else parts.push(failure ?? `${call} was not sent.`);
  } else {
    if (delivered.length) parts.push(`${delivered.length} delivered.`);
    if (refused.length) parts.push(`${refused.length} refused: see To do.`);
    if (unsent.length) {
      if (failure) parts.push(failure);
      parts.push(`${unsent.length} ${unsent.length === 1 ? 'QSO is' : 'QSOs are'} ${auto ? 'waiting' : 'not sent'}.`);
    }
  }
  return { at: now(), total: ids.size, delivered: delivered.length, refused: refused.length, unsent: unsent.length, text: parts.join(' '), ok: !refused.length && !unsent.length };
}

/** Chooses the Wavelog station location for an activation, or the default for QSOs outside one, and sends refused QSOs again. */
export async function chooseStation(stationId: string, activationId: string | null): Promise<void> {
  if (activationId) await updateActivation(activationId, { wavelogStationId: stationId });
  else await setWavelog({ stationId });
}

export function qsoById(id: string): Qso | undefined {
  return byId.get(id);
}
