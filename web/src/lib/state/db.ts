/**
 * The app's IndexedDB, "rr73". Each schema version adds to the one before, so a phone upgrades
 * from any earlier version in one open:
 *
 * 1. kv: settings and other small values by key.
 * 2. The log (docs/design/log.md): qsos (indexed by start time, call, band and activation),
 *    ledger (one entry per QSO and destination), destinations and activations. Version 1 data
 *    is kept as it is.
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

let dbp: Promise<Rr73Db> | null = null;

/** Opens (and upgrades) the database. Exported for the upgrade test. */
export function openRr73(name = DB_NAME): Promise<Rr73Db> {
  return openDB<Rr73Schema>(name, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('kv', { keyPath: 'key' });
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
    // A newer version open in another tab needs this one closed to upgrade.
    blocking() {
      void dbp?.then((d) => d.close());
      dbp = null;
    },
    terminated() {
      dbp = null;
    },
  });
}

export function db(): Promise<Rr73Db> {
  dbp ??= openRr73();
  return dbp;
}

/** Closes the shared connection; tests use it to start again. */
export async function closeDb(): Promise<void> {
  const p = dbp;
  dbp = null;
  if (p) (await p).close();
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key))?.value as T | undefined;
}

/** Stores a plain copy: Svelte state proxies cannot be cloned into IndexedDB. */
export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', { key, value: JSON.parse(JSON.stringify(value)) as unknown });
}
