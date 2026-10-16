import { describe, expect, it } from 'vitest';
import { WORKED_DB, workedStore } from './wavelog-worked-store';
import type { StoredWorked } from './wavelog-worked';

const names = async () => (await indexedDB.databases()).map((d) => d.name);

const READ: StoredWorked = {
  meta: { source: 'https://wavelog.example.test 0badf00d', cursors: [{ stations: ['1', '7'], lastId: 4242 }], fullAt: 1000, checkedAt: 2000 },
  calls: ['JA1KXM 20m FT8', 'VK3/9V1NE 40m FT4'],
  grids: ['PM95 20m'],
};

describe('the store of what was read from Wavelog', () => {
  it('reads nothing, and creates no database, before the first read', async () => {
    expect(await workedStore.load()).toBeNull();
    expect(await names()).not.toContain(WORKED_DB);
  });

  it('keeps the read in a database of its own, apart from the log', async () => {
    await workedStore.save(READ, true);
    expect(await names()).toContain(WORKED_DB);
    expect(await workedStore.load()).toEqual(READ);
    // A check that found nothing new rewrites the read and leaves the keys.
    await workedStore.save({ ...READ, meta: { ...READ.meta, checkedAt: 3000 }, calls: [], grids: [] }, false);
    expect(await workedStore.load()).toEqual({ ...READ, meta: { ...READ.meta, checkedAt: 3000 } });
  });

  it('deletes the database when cleared', async () => {
    await workedStore.save(READ, true);
    await workedStore.clear();
    expect(await names()).not.toContain(WORKED_DB);
    expect(await workedStore.load()).toBeNull();
    // Clearing again, with nothing there, does nothing.
    await workedStore.clear();
    expect(await names()).not.toContain(WORKED_DB);
  });
});
