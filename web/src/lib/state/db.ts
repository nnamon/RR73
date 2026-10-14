/**
 * The app's IndexedDB, "rr73". Each schema version adds to the one before, so a phone upgrades
 * from any earlier version in one open:
 *
 * 1. kv: settings and other small values by key.
 * 2. The log (docs/design/log.md): qsos (indexed by start time, call, band and activation),
 *    ledger (one entry per QSO and destination), destinations and activations. Version 1 data
 *    is kept as it is.
 *
 * An upgrade waits until every other connection closes. Copies of RR73 from 0.5.0 on close
 * theirs when a newer version asks; 0.4.x and earlier never do, so while one runs the upgrade
 * waits. The open reports that wait (dbState) instead of hanging silently, and finishes by
 * itself once the other copy closes. Nothing is deleted or rewritten while it waits.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Activation, DestinationConfig, LedgerEntry, Qso } from '../log/types';

export const DB_NAME = 'rr73';
export const DB_VERSION = 2;

export interface Rr73Schema extends DBSchema {
  kv: { key: string; value: { key: string; value: unknown } };
  qsos: { key: string; value: Qso; indexes: { time: number; call: string; band: string; activation: string } };
  ledger: { key: [string, string]; value: LedgerEntry; indexes: { qso: string; destination: string; state: string } };
  destinations: { key: string; value: DestinationConfig };
  activations: { key: string; value: Activation; indexes: { start: number } };
}

export type Rr73Db = IDBPDatabase<Rr73Schema>;

/**
 * What opening the database is doing now.
 *
 * - idle: not opened yet, or closed and opened again on next use.
 * - opening: the open has not answered yet.
 * - open: ready.
 * - blocked: another copy of RR73 keeps an older version open, so the upgrade waits for it.
 * - stalled: the open has not answered for STALL_MS and reports nothing.
 * - replaced: a newer version of RR73 opened the database, so this copy closed its connection
 *   and can no longer use it.
 * - failed: the browser refused (a private window, no space).
 */
export type DbState = 'idle' | 'opening' | 'open' | 'blocked' | 'stalled' | 'replaced' | 'failed';

/** A blocked upgrade is reported after this long, ms: a copy that is closing needs a moment. */
export const BLOCKED_MS = 1500;
/** An open with no answer at all is reported after this long, ms. */
export const STALL_MS = 6000;

/** Called by openRr73 for events on the open request and the connection. */
export interface OpenHooks {
  /** Another connection holds an older version open; the upgrade waits for it to close. */
  blocked?(): void;
  /** Another copy asks for a newer version or deletes the database: this connection must close. */
  blocking?(newVersion: number | null): void;
  /** The browser closed the connection without being asked (storage cleared or evicted). */
  terminated?(): void;
}

let dbp: Promise<Rr73Db> | null = null;
let state: DbState = 'idle';
const listeners = new Set<(s: DbState) => void>();

function setState(s: DbState) {
  if (s === state) return;
  state = s;
  for (const l of listeners) l(s);
}

export function dbState(): DbState {
  return state;
}

/** Calls `fn` on every change of state. Returns the function that stops it. */
export function onDbState(fn: (s: DbState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Opens (and upgrades) the database. Exported for the upgrade test. */
export function openRr73(name = DB_NAME, hooks: OpenHooks = {}): Promise<Rr73Db> {
  return openDB<Rr73Schema>(name, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
      if (oldVersion < 2) {
        const qsos = d.createObjectStore('qsos', { keyPath: 'id' });
        qsos.createIndex('time', 'start');
        qsos.createIndex('call', 'call');
        qsos.createIndex('band', 'band');
        // QSOs outside an activation have activationId null and stay out of this index.
        qsos.createIndex('activation', 'activationId');
        const ledger = d.createObjectStore('ledger', { keyPath: ['qsoId', 'destinationId'] });
        ledger.createIndex('qso', 'qsoId');
        ledger.createIndex('destination', 'destinationId');
        ledger.createIndex('state', 'state');
        d.createObjectStore('destinations', { keyPath: 'id' });
        d.createObjectStore('activations', { keyPath: 'id' }).createIndex('start', 'startedAt');
      }
    },
    blocked: () => hooks.blocked?.(),
    blocking: (_current, next) => hooks.blocking?.(next),
    terminated: () => hooks.terminated?.(),
  });
}

let opener: typeof openRr73 = openRr73;

/** Tests replace the open, such as with one that never answers. Null restores it. */
export function setOpener(fn: typeof openRr73 | null) {
  opener = fn ?? openRr73;
}

/** The shared connection, opened on first use. Rejects when the browser refuses or a newer version owns the database. */
export function db(): Promise<Rr73Db> {
  dbp ??= openShared();
  return dbp;
}

function openShared(): Promise<Rr73Db> {
  setState('opening');
  let blockedTimer: ReturnType<typeof setTimeout> | undefined;
  const stallTimer = setTimeout(() => {
    if (state === 'opening') setState('stalled');
  }, STALL_MS);
  const p = opener(DB_NAME, {
    blocked() {
      clearTimeout(stallTimer);
      blockedTimer ??= setTimeout(() => {
        if (dbp === p) setState('blocked');
      }, BLOCKED_MS);
    },
    // A newer version (or a delete) in another copy needs this connection closed to go ahead.
    blocking(next) {
      if (dbp === p) dbp = null;
      void p.then((d) => d.close());
      setState(next === null ? 'idle' : 'replaced');
    },
    terminated() {
      if (dbp === p) dbp = null;
      setState('idle');
    },
  });
  p.then(
    () => {
      clearTimeout(stallTimer);
      clearTimeout(blockedTimer);
      if (dbp === p) setState('open');
    },
    (e: unknown) => {
      clearTimeout(stallTimer);
      clearTimeout(blockedTimer);
      // The next use tries again.
      if (dbp === p) dbp = null;
      setState(e instanceof DOMException && e.name === 'VersionError' ? 'replaced' : 'failed');
    },
  );
  return p;
}

/** Closes the shared connection, or closes it once it opens; tests use it to start again. */
export async function closeDb(): Promise<void> {
  const p = dbp;
  dbp = null;
  setState('idle');
  if (!p) return;
  const closing = p.then(
    (d) => d.close(),
    () => undefined,
  );
  // An open that never answers is left behind.
  await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 0))]);
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key))?.value as T | undefined;
}

/** Stores a plain copy: Svelte state proxies cannot be cloned into IndexedDB. */
export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', { key, value: JSON.parse(JSON.stringify(value)) as unknown });
}

/**
 * Merges `patch` into the object stored at `key` in one transaction, so stored values this copy
 * has not read (a load that failed or is still waiting) are kept.
 */
export async function mergeKv(key: string, patch: Record<string, unknown>): Promise<void> {
  const tx = (await db()).transaction('kv', 'readwrite');
  const cur = (await tx.store.get(key))?.value;
  const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};
  await tx.store.put({ key, value: { ...base, ...(JSON.parse(JSON.stringify(patch)) as Record<string, unknown>) } });
  await tx.done;
}

/**
 * Longest wait for the read in peekKv, ms. It normally takes a few ms; the first render does not
 * wait for it (main.ts), so the limit only ends a read that waits behind another copy's upgrade.
 */
const PEEK_MS = 5000;

/** A value read by peekKv; null from peekKv means it could not read. */
export interface Peeked<T> {
  value: T | undefined;
}

/**
 * Reads a key without upgrading the database, for the first screen. When the database is at
 * another version (an upgrade is due, which may wait for an older copy to close, or a newer
 * version owns it), this opens it as it is, reads and closes. Otherwise it reads through the
 * shared connection. Null when it cannot read within PEEK_MS: the caller reads again later.
 */
export async function peekKv<T>(key: string, factory: IDBFactory | undefined = globalThis.indexedDB): Promise<Peeked<T> | null> {
  if (!factory) return null;
  let version: number | undefined;
  try {
    // Lists databases without opening them; older browsers do not have it.
    version = (await factory.databases?.())?.find((d) => d.name === DB_NAME)?.version;
  } catch {
    version = undefined;
  }
  if (version === undefined || version === DB_VERSION) {
    const read = getKv<T>(key).then(
      (value) => ({ value }),
      () => null,
    );
    return Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), PEEK_MS))]);
  }
  return new Promise<Peeked<T> | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), PEEK_MS);
    const done = (v: Peeked<T> | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    // No version: the database opens as it is, with no upgrade and nothing to wait for.
    const req = factory.open(DB_NAME);
    // Deleted since the list was read: creating an empty database here would break the upgrade.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => done(null);
    req.onsuccess = () => {
      const d = req.result;
      // A new version elsewhere must not wait for this short read.
      d.onversionchange = () => d.close();
      if (!d.objectStoreNames.contains('kv')) {
        d.close();
        return done({ value: undefined });
      }
      const get = d.transaction('kv').objectStore('kv').get(key);
      get.onsuccess = () => {
        d.close();
        done({ value: (get.result as { value: T } | undefined)?.value });
      };
      get.onerror = () => {
        d.close();
        done(null);
      };
    };
  });
}
