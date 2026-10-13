import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { closeDb, db, DB_VERSION, getKv, openRr73, setKv } from './db';

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
