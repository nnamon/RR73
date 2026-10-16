// What RR73 read from Wavelog's log for decode colours (wavelog-worked.ts), in a database of its
// own, "rr73-wavelog-worked", apart from the log: the backup, the ADIF export and the Log never
// see it. Turning the switch off deletes the database.
//
// The keys go in records of CHUNK_KEYS each, so no write or read clones a large list in one task
// on the main thread. A full read writes its records under a new generation, one transaction
// each, and only then the read itself (`meta`), which names the generation and how many records
// it has: a write cut short leaves the last complete read in place. A check that finds new QSOs
// adds one record and the read in one transaction.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { inSlices, yieldToMain, type Yield } from './slices';
import type { StoredWorked, WorkedMeta, WorkedStore } from './wavelog-worked';

export const WORKED_DB = 'rr73-wavelog-worked';
/** Keys per record: writing or reading one clones its list in one task. */
export const CHUNK_KEYS = 1000;

interface Chunk {
  calls: string[];
  grids: string[];
}

interface Schema extends DBSchema {
  data: { key: string; value: { key: string; meta?: WorkedMeta; chunk?: Chunk } };
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

const chunkKey = (gen: number, i: number) => `c:${gen}:${String(i).padStart(6, '0')}`;

/** The keys in records of CHUNK_KEYS, made in slices. */
async function chunksOf(calls: Iterable<string>, grids: Iterable<string>, give: Yield): Promise<Chunk[]> {
  const out: Chunk[] = [];
  let cur: Chunk = { calls: [], grids: [] };
  const push = (kind: 'calls' | 'grids', k: string) => {
    cur[kind].push(k);
    if (cur.calls.length + cur.grids.length >= CHUNK_KEYS) {
      out.push(cur);
      cur = { calls: [], grids: [] };
    }
  };
  await inSlices(calls, (k) => push('calls', k), { yield: give });
  await inSlices(grids, (k) => push('grids', k), { yield: give });
  if (cur.calls.length + cur.grids.length) out.push(cur);
  return out;
}

export const workedStore: WorkedStore = {
  async load(give = yieldToMain) {
    // Opening would create an empty database for a phone that never read Wavelog's log.
    if (!(await exists())) return null;
    const d = await connect();
    const meta = (await d.get('data', 'meta'))?.meta;
    if (!meta) return null;
    const calls: string[] = [];
    const grids: string[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      await give();
      const c = (await d.get('data', chunkKey(meta.gen, i)))?.chunk;
      // A record missing: what is stored is not a whole read.
      if (!c) return null;
      for (const k of c.calls) calls.push(k);
      for (const k of c.grids) grids.push(k);
    }
    return { meta, calls, grids };
  },

  async replace(meta, calls, grids, give = yieldToMain, alive = () => true) {
    const chunks = await chunksOf(calls, grids, give);
    const d = await connect();
    const gen = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      if (!alive()) return null;
      await d.put('data', { key: chunkKey(gen, i), chunk: chunks[i] });
      await give();
    }
    if (!alive()) return null;
    const next: WorkedMeta = { ...meta, gen, chunks: chunks.length };
    await d.put('data', { key: 'meta', meta: next });
    // Every record of other generations goes: the read before, and any write cut short.
    const tx = d.transaction('data', 'readwrite');
    await Promise.all([tx.store.delete(IDBKeyRange.bound('c:', chunkKey(gen, 0), false, true)), tx.store.delete(IDBKeyRange.bound(`c:${gen}:\uffff`, 'c:\uffff', true, false)), tx.done]);
    return next;
  },

  async append(meta, calls, grids) {
    const d = await connect();
    const tx = d.transaction('data', 'readwrite');
    const ops: Promise<unknown>[] = [];
    let next = meta;
    if (calls.length || grids.length) {
      ops.push(tx.store.put({ key: chunkKey(meta.gen, meta.chunks), chunk: { calls: [...calls], grids: [...grids] } }));
      next = { ...meta, chunks: meta.chunks + 1 };
    }
    ops.push(tx.store.put({ key: 'meta', meta: next }));
    await Promise.all([...ops, tx.done]);
    return next;
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
