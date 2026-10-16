// What RR73 read from Wavelog's log for decode colours (wavelog-worked.ts), in a database of its
// own, "rr73-wavelog-worked", apart from the log: the backup, the ADIF export and the Log never
// see it. Two records: the read (cursors and times) and the worked keys, so a check that finds
// nothing new rewrites only the first. Turning the switch off deletes the database.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredWorked, WorkedMeta, WorkedStore } from './wavelog-worked';

export const WORKED_DB = 'rr73-wavelog-worked';

interface Schema extends DBSchema {
  data: { key: string; value: { key: 'meta'; value: WorkedMeta } | { key: 'keys'; value: { calls: string[]; grids: string[] } } };
}

type Db = IDBPDatabase<Schema>;

let open: Promise<Db> | null = null;

function connect(): Promise<Db> {
  if (open) return open;
  const p = openDB<Schema>(WORKED_DB, 1, {
    upgrade(d) {
      d.createObjectStore('data', { keyPath: 'key' });
    },
    // A delete or a newer version elsewhere: let it go ahead.
    blocking() {
      if (open === p) open = null;
      void p.then((d) => d.close());
    },
    terminated() {
      if (open === p) open = null;
    },
  });
  open = p;
  p.catch(() => {
    if (open === p) open = null;
  });
  return p;
}

async function close(): Promise<void> {
  const p = open;
  open = null;
  if (p) await p.then((d) => d.close()).catch(() => undefined);
}

/** True when the database exists; without databases() (older browsers) it may. */
async function exists(): Promise<boolean> {
  const list = await globalThis.indexedDB?.databases?.().catch(() => null);
  return !list || list.some((d) => d.name === WORKED_DB);
}

export const workedStore: WorkedStore = {
  async load() {
    // Opening would create an empty database for a phone that never read Wavelog's log.
    if (!(await exists())) return null;
    const d = await connect();
    const tx = d.transaction('data', 'readonly');
    const [meta, keys] = await Promise.all([tx.store.get('meta'), tx.store.get('keys')]);
    await tx.done;
    if (meta?.key !== 'meta') return null;
    const k = keys?.key === 'keys' ? keys.value : { calls: [], grids: [] };
    return { meta: meta.value, calls: k.calls, grids: k.grids } satisfies StoredWorked;
  },
  async save(w, keys) {
    const d = await connect();
    const tx = d.transaction('data', 'readwrite');
    const puts: Promise<unknown>[] = [tx.store.put({ key: 'meta', value: w.meta })];
    if (keys) puts.push(tx.store.put({ key: 'keys', value: { calls: w.calls, grids: w.grids } }));
    await Promise.all([...puts, tx.done]);
  },
  async clear() {
    await close();
    if (!(await exists())) return;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(WORKED_DB);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      // Another copy of RR73 holds it open: the delete finishes when that copy closes it.
      req.onblocked = () => resolve();
    });
  },
};
