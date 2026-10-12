// The app's IndexedDB. Settings live in the key-value store; the log arrives in a later version.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface Schema extends DBSchema {
  kv: { key: string; value: { key: string; value: unknown } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbp ??= openDB<Schema>('rr73', 1, {
    upgrade(d) {
      d.createObjectStore('kv', { keyPath: 'key' });
    },
  });
  return dbp;
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key))?.value as T | undefined;
}

/** Stores a plain copy: Svelte state proxies cannot be cloned into IndexedDB. */
export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', { key, value: JSON.parse(JSON.stringify(value)) as unknown });
}
