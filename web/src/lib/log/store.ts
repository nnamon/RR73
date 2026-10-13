// The log's records in IndexedDB. Writes that belong together (a QSO and its ledger entries) go
// in one transaction.

import { db, getKv, setKv } from '../state/db';
import type { Activation, DestinationConfig, LedgerEntry, LoggingSettings, Qso } from './types';

export interface Snapshot {
  qsos: Qso[];
  ledger: LedgerEntry[];
  activations: Activation[];
  destinations: DestinationConfig[];
  settings: LoggingSettings | undefined;
  /** Ids of the one-time migrations that have run (migrations.ts). */
  migrations: string[] | undefined;
}

const SETTINGS_KEY = 'logging';
const MIGRATIONS_KEY = 'migrations';

export async function loadSnapshot(): Promise<Snapshot> {
  const d = await db();
  const tx = d.transaction(['qsos', 'ledger', 'activations', 'destinations'], 'readonly');
  const [qsos, ledger, activations, destinations] = await Promise.all([
    tx.objectStore('qsos').getAll(),
    tx.objectStore('ledger').getAll(),
    tx.objectStore('activations').getAll(),
    tx.objectStore('destinations').getAll(),
  ]);
  await tx.done;
  return { qsos, ledger, activations, destinations, settings: await getKv<LoggingSettings>(SETTINGS_KEY), migrations: await getKv<string[]>(MIGRATIONS_KEY) };
}

export interface Changes {
  qsos?: readonly Qso[];
  ledger?: readonly LedgerEntry[];
  activations?: readonly Activation[];
  destinations?: readonly DestinationConfig[];
}

/** Plain copies: reactive proxies cannot be cloned into IndexedDB. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function saveChanges(c: Changes): Promise<void> {
  const stores = (['qsos', 'ledger', 'activations', 'destinations'] as const).filter((s) => c[s]?.length);
  if (!stores.length) return;
  const d = await db();
  const tx = d.transaction(stores, 'readwrite');
  const puts: Promise<unknown>[] = [];
  for (const q of c.qsos ?? []) puts.push(tx.objectStore('qsos').put(plain(q)));
  for (const e of c.ledger ?? []) puts.push(tx.objectStore('ledger').put(plain(e)));
  for (const a of c.activations ?? []) puts.push(tx.objectStore('activations').put(plain(a)));
  for (const x of c.destinations ?? []) puts.push(tx.objectStore('destinations').put(plain(x)));
  await Promise.all([...puts, tx.done]);
}

export function saveLoggingSettings(s: LoggingSettings): Promise<void> {
  return setKv(SETTINGS_KEY, s);
}

export function saveMigrations(applied: readonly string[]): Promise<void> {
  return setKv(MIGRATIONS_KEY, applied);
}
