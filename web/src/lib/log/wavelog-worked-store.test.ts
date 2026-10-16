import { afterEach, describe, expect, it } from 'vitest';
import { CHUNK_KEYS, WORKED_DB, workedStore } from './wavelog-worked-store';
import type { WorkedMeta } from './wavelog-worked';

const names = async () => (await indexedDB.databases()).map((d) => d.name);
const now = () => Promise.resolve();

const META: WorkedMeta = { source: 'https://wavelog.example.test 0badf00d', cursors: [{ stations: ['1', '7'], lastId: 4242 }], fullAt: 1000, checkedAt: 2000, version: '3.2.4', gen: 0, chunks: 0 };
const calls = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `K${from + i}ABC 20m FT8`);

/** The records in the database, by key. */
async function records(): Promise<string[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open(WORKED_DB);
    req.onsuccess = () => {
      const keys = req.result.transaction('data').objectStore('data').getAllKeys();
      keys.onsuccess = () => {
        req.result.close();
        resolve((keys.result as string[]).sort());
      };
    };
  });
}

afterEach(() => workedStore.clear());

describe('the store of what was read from Wavelog', () => {
  it('reads nothing, and creates no database, before the first read', async () => {
    expect(await workedStore.load(now)).toBeNull();
    expect(await names()).not.toContain(WORKED_DB);
  });

  it('keeps a full read in records of 1000 keys, in a database of its own', async () => {
    const meta = (await workedStore.replace(META, calls(4500), ['PM95 20m'], now))!;
    expect(meta).toEqual({ ...META, gen: expect.any(Number), chunks: Math.ceil(4501 / CHUNK_KEYS) });
    expect(meta.chunks).toBe(5);
    expect(await names()).toContain(WORKED_DB);
    expect((await records()).filter((k) => k.startsWith('c:'))).toHaveLength(5);
    expect(await workedStore.load(now)).toEqual({ meta, calls: calls(4500), grids: ['PM95 20m'] });
  });

  it('adds a check’s keys as one record with the read, and a read alone when nothing is new', async () => {
    const meta = (await workedStore.replace(META, calls(10), [], now))!;
    const added = await workedStore.append({ ...meta, checkedAt: 3000 }, ['ZL2AB 40m FT8'], ['RE78 40m']);
    expect(added.chunks).toBe(meta.chunks + 1);
    const same = await workedStore.append({ ...added, checkedAt: 4000 }, [], []);
    expect(same.chunks).toBe(added.chunks);
    expect(await workedStore.load(now)).toEqual({ meta: { ...added, checkedAt: 4000 }, calls: [...calls(10), 'ZL2AB 40m FT8'], grids: ['RE78 40m'] });
  });

  it('replaces the last read whole, and keeps it when a new one is cut short', async () => {
    const first = (await workedStore.replace(META, calls(3000), [], now))!;
    // Cut short after its first record: the read stays the first one.
    let puts = 0;
    expect(await workedStore.replace({ ...META, fullAt: 5000 }, calls(3000, 9000), [], now, () => ++puts < 2)).toBeNull();
    expect(await workedStore.load(now)).toEqual({ meta: first, calls: calls(3000), grids: [] });
    // A whole new read replaces it, and the records of every other generation go.
    await new Promise((r) => setTimeout(r, 2));
    const second = (await workedStore.replace({ ...META, fullAt: 6000 }, calls(5, 100), [], now))!;
    expect(await workedStore.load(now)).toEqual({ meta: second, calls: calls(5, 100), grids: [] });
    expect((await records()).filter((k) => k.startsWith('c:'))).toEqual([`c:${second.gen}:000000`]);
  });

  it('reads nothing when a record the read names is missing', async () => {
    const meta = (await workedStore.replace(META, calls(10), [], now))!;
    await workedStore.append({ ...meta, chunks: meta.chunks + 1 }, [], []);
    expect(await workedStore.load(now)).toBeNull();
  });

  it('deletes the database when cleared', async () => {
    await workedStore.replace(META, calls(10), [], now);
    await workedStore.clear();
    expect(await names()).not.toContain(WORKED_DB);
    expect(await workedStore.load(now)).toBeNull();
    await workedStore.clear();
    expect(await names()).not.toContain(WORKED_DB);
  });
});
