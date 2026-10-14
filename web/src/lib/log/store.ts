// The log's records in IndexedDB. Writes that belong together (a QSO and its ledger entries) go
// in one transaction.
//
// The practice log has the same stores in a database of its own, "rr73-practice", so practice
// QSOs never touch the log. setLogStore chooses which one the log reads and writes.

import { db, openRr73, type Rr73Db } from '../state/db';
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

export const PRACTICE_DB = 'rr73-practice';

let practiceDb: Promise<Rr73Db> | null = null;
let practice = false;

function openPractice(): Promise<Rr73Db> {
  if (practiceDb) return practiceDb;
  const p = openRr73(PRACTICE_DB, {
    // A newer version of RR73 in another tab upgrades this database too: let it.
    blocking() {
      if (practiceDb === p) practiceDb = null;
      void p.then((d) => d.close());
    },
    terminated() {
      if (practiceDb === p) practiceDb = null;
    },
  });
  practiceDb = p;
  p.catch(() => {
    if (practiceDb === p) practiceDb = null;
  });
  return p;
}

/** The log's database now. Read before any await, so a write goes where it was made. */
function logDb(): Promise<Rr73Db> {
  return practice ? openPractice() : db();
}

/** Chooses the practice log (true) or the log. */
export function setLogStore(usePractice: boolean) {
  practice = usePractice;
}

async function kvGet<T>(d: Rr73Db, key: string): Promise<T | undefined> {
  return (await d.get('kv', key))?.value as T | undefined;
}

async function kvSet(open: Promise<Rr73Db>, key: string, value: unknown): Promise<void> {
  await (await open).put('kv', { key, value: plain(value) });
}

export async function loadSnapshot(): Promise<Snapshot> {
  const d = await logDb();
  const tx = d.transaction(['qsos', 'ledger', 'activations', 'destinations'], 'readonly');
  const [qsos, ledger, activations, destinations] = await Promise.all([
    tx.objectStore('qsos').getAll(),
    tx.objectStore('ledger').getAll(),
    tx.objectStore('activations').getAll(),
    tx.objectStore('destinations').getAll(),
  ]);
  await tx.done;
  return { qsos, ledger, activations, destinations, settings: await kvGet<LoggingSettings>(d, SETTINGS_KEY), migrations: await kvGet<string[]>(d, MIGRATIONS_KEY) };
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
  const d = await logDb();
  const tx = d.transaction(stores, 'readwrite');
  const puts: Promise<unknown>[] = [];
  for (const q of c.qsos ?? []) puts.push(tx.objectStore('qsos').put(plain(q)));
  for (const e of c.ledger ?? []) puts.push(tx.objectStore('ledger').put(plain(e)));
  for (const a of c.activations ?? []) puts.push(tx.objectStore('activations').put(plain(a)));
  for (const x of c.destinations ?? []) puts.push(tx.objectStore('destinations').put(plain(x)));
  await Promise.all([...puts, tx.done]);
}

export function saveLoggingSettings(s: LoggingSettings): Promise<void> {
  return kvSet(logDb(), SETTINGS_KEY, s);
}

export function saveMigrations(applied: readonly string[]): Promise<void> {
  return kvSet(logDb(), MIGRATIONS_KEY, applied);
}

/** The practice log's QSOs, ledger and activations, as Clear practice log takes them away. */
export interface PracticeRecords {
  qsos: Qso[];
  ledger: LedgerEntry[];
  activations: Activation[];
}

const PRACTICE_STORES = ['qsos', 'ledger', 'activations'] as const;

/** QSOs in the practice log, deleted ones left out. */
export async function countPracticeQsos(): Promise<number> {
  const all = await (await openPractice()).getAll('qsos');
  return all.filter((q) => q.deletedAt === null).length;
}

/** Empties the practice log in one transaction and returns what it held, for Undo. Its Wavelog stand-in stays. */
export async function takePracticeRecords(): Promise<PracticeRecords> {
  const tx = (await openPractice()).transaction([...PRACTICE_STORES], 'readwrite');
  const [qsos, ledger, activations] = await Promise.all([tx.objectStore('qsos').getAll(), tx.objectStore('ledger').getAll(), tx.objectStore('activations').getAll()]);
  await Promise.all([...PRACTICE_STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  return { qsos, ledger, activations };
}

/** Puts back what takePracticeRecords took. */
export async function restorePracticeRecords(r: PracticeRecords): Promise<void> {
  const tx = (await openPractice()).transaction([...PRACTICE_STORES], 'readwrite');
  const puts: Promise<unknown>[] = [];
  for (const q of r.qsos) puts.push(tx.objectStore('qsos').put(q));
  for (const e of r.ledger) puts.push(tx.objectStore('ledger').put(e));
  for (const a of r.activations) puts.push(tx.objectStore('activations').put(a));
  await Promise.all([...puts, tx.done]);
}
