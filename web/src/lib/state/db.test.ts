import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCKED_MS, closeDb, db, DB_NAME, dbState, DB_VERSION, getKv, mergeKv, onDbState, openRr73, peekKv, setKv, setOpener, STALL_MS } from './db';

const STORES = ['activations', 'destinations', 'kv', 'ledger', 'qsos'];

describe('the rr73 database', () => {
  it('upgrades a version 1 database and keeps its settings', async () => {
    const v1 = await openDB('upgrade-test', 1, { upgrade: (d) => d.createObjectStore('kv', { keyPath: 'key' }) });
    await v1.put('kv', { key: 'settings', value: { callsign: '9V1NE', theme: 'dark', band: '40m' } });
    await v1.put('kv', { key: 'other', value: 42 });
    v1.close();

    const d = await openRr73('upgrade-test');
    expect(d.version).toBe(DB_VERSION);
    expect([...d.objectStoreNames].sort()).toEqual(STORES);
    expect(await d.get('kv', 'settings')).toEqual({ key: 'settings', value: { callsign: '9V1NE', theme: 'dark', band: '40m' } });
    expect(await d.get('kv', 'other')).toEqual({ key: 'other', value: 42 });
    const tx = d.transaction(['qsos', 'ledger', 'activations']);
    expect([...tx.objectStore('qsos').indexNames].sort()).toEqual(['activation', 'band', 'call', 'time']);
    expect([...tx.objectStore('ledger').indexNames].sort()).toEqual(['destination', 'qso', 'state']);
    expect([...tx.objectStore('activations').indexNames]).toEqual(['start']);
    expect(tx.objectStore('ledger').keyPath).toEqual(['qsoId', 'destinationId']);
    d.close();
  });

  it('creates every store on a phone with no database', async () => {
    const d = await openRr73('fresh-test');
    expect([...d.objectStoreNames].sort()).toEqual(STORES);
    d.close();
  });

  it('opens again at the same version without losing data', async () => {
    const a = await openRr73('again-test');
    await a.put('qsos', { id: 'q1', start: 1, call: 'K1A', band: '20m', activationId: null } as never);
    a.close();
    const b = await openRr73('again-test');
    expect(await b.count('qsos')).toBe(1);
    b.close();
  });

  it('indexes QSOs by time, call, band and activation, leaving QSOs outside an activation out of that index', async () => {
    const d = await openRr73('index-test');
    const put = (id: string, start: number, call: string, band: string, activationId: string | null) => d.put('qsos', { id, start, call, band, activationId } as never);
    await put('q1', 300, 'VK2ESN', '20m', 'a1');
    await put('q2', 100, 'JA1KXM', '20m', null);
    await put('q3', 200, 'VK2ESN', '40m', 'a1');
    expect((await d.getAllFromIndex('qsos', 'time')).map((q) => q.id)).toEqual(['q2', 'q3', 'q1']);
    expect((await d.getAllFromIndex('qsos', 'call', 'VK2ESN')).map((q) => q.id).sort()).toEqual(['q1', 'q3']);
    expect((await d.getAllFromIndex('qsos', 'band', '20m')).map((q) => q.id).sort()).toEqual(['q1', 'q2']);
    expect((await d.getAllFromIndex('qsos', 'activation')).map((q) => q.id).sort()).toEqual(['q1', 'q3']);
    d.close();
  });

  it('keeps the shared connection and the key-value helpers working', async () => {
    await setKv('k', { a: 1 });
    expect(await getKv('k')).toEqual({ a: 1 });
    expect((await db()).version).toBe(DB_VERSION);
    await closeDb();
    expect(await getKv('k')).toEqual({ a: 1 });
  });
});

describe('opening alongside other copies of RR73', () => {
  /** A copy of RR73 0.4.x: version 1 with the settings, and no handler to close for a newer version. */
  async function olderCopy(settings: unknown) {
    const old = await openDB(DB_NAME, 1, { upgrade: (d) => d.createObjectStore('kv', { keyPath: 'key' }) });
    await old.put('kv', { key: 'settings', value: settings });
    return old;
  }

  beforeEach(async () => {
    await closeDb();
    await deleteDB(DB_NAME);
  });

  it('reads the settings without upgrading while an older copy holds the database', async () => {
    const old = await olderCopy({ callsign: '9V1NE', theme: 'dark' });
    expect(await peekKv('settings')).toEqual({ value: { callsign: '9V1NE', theme: 'dark' } });
    // The read leaves the database as it was.
    expect((await indexedDB.databases()).find((d) => d.name === DB_NAME)?.version).toBe(1);
    old.close();
  });

  it('says when an older copy blocks the upgrade, and finishes it with the data once that copy closes', async () => {
    const old = await olderCopy({ callsign: '9V1NE' });
    const states: string[] = [];
    const stop = onDbState((s) => states.push(s));
    const opening = db();
    await vi.waitFor(() => expect(dbState()).toBe('blocked'), { timeout: BLOCKED_MS * 3 });
    old.close();
    const d = await opening;
    expect(d.version).toBe(DB_VERSION);
    expect(dbState()).toBe('open');
    expect(await getKv('settings')).toEqual({ callsign: '9V1NE' });
    expect(states).toEqual(['opening', 'blocked', 'open']);
    stop();
  });

  it('closes its connection for a newer version and says so', async () => {
    await db();
    const newer = await openDB(DB_NAME, DB_VERSION + 1);
    expect(dbState()).toBe('replaced');
    newer.close();
    await expect(db()).rejects.toMatchObject({ name: 'VersionError' });
    expect(dbState()).toBe('replaced');
    await deleteDB(DB_NAME);
  });

  it('says so when the open does not answer', async () => {
    setOpener(() => new Promise(() => undefined));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      void db();
      expect(dbState()).toBe('opening');
      vi.advanceTimersByTime(STALL_MS - 1);
      expect(dbState()).toBe('opening');
      vi.advanceTimersByTime(1);
      expect(dbState()).toBe('stalled');
    } finally {
      vi.useRealTimers();
      setOpener(null);
      await closeDb();
    }
  });

  it('keeps stored values a merge does not name', async () => {
    await setKv('settings', { callsign: '9V1NE', theme: 'dark' });
    await mergeKv('settings', { theme: 'light', band: '40m' });
    expect(await getKv('settings')).toEqual({ callsign: '9V1NE', theme: 'light', band: '40m' });
  });
});
