import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, normaliseCallsign, resetSettings, settings, updateSettings, validate } from './settings.svelte';
import { closeDb, DB_NAME, getKv, setKv } from './db';

beforeEach(async () => {
  await closeDb();
  await deleteDB(DB_NAME);
  resetSettings();
});

describe('settings', () => {
  it('starts with an empty callsign on 20m FT8', () => {
    expect(DEFAULTS.callsign).toBe('');
    expect(DEFAULTS.band).toBe('20m');
    expect(DEFAULTS.mode).toBe('FT8');
  });

  it('normalises callsigns', () => {
    expect(normaliseCallsign(' 9v1ne ')).toBe('9V1NE');
    expect(normaliseCallsign('vk3/9v1ne-p')).toBe('VK3/9V1NEP');
    expect(normaliseCallsign('ABCDEFGHIJKLMNOP')).toHaveLength(13);
  });

  it('keeps only valid stored values', () => {
    expect(validate({ callsign: '9v1ne', band: '2m', mode: 'JT65', outputLevel: 3, rxHz: 50, txHz: 1180, theme: 'dark', checklist: { focus: true, clicks: 'yes' } })).toEqual({
      ...DEFAULTS,
      callsign: '9V1NE',
      txHz: 1180,
      theme: 'dark',
      checklist: { focus: true, clicks: false, volume: false },
    });
    expect(validate(null)).toEqual(DEFAULTS);
  });

  it('stores the callsign in IndexedDB and loads it back', async () => {
    await updateSettings({ callsign: '9V1NE' });
    expect(settings.callsign).toBe('9V1NE');
    expect(await getKv<{ callsign: string }>('settings')).toMatchObject({ callsign: '9V1NE' });
    resetSettings();
    await loadSettings();
    expect(settings.callsign).toBe('9V1NE');
  });

  it('keeps a change made before the stored settings arrived, and the stored values it did not change', async () => {
    await setKv('settings', { callsign: '9V1NE', theme: 'dark' });
    void updateSettings({ band: '40m' });
    await loadSettings();
    expect(settings).toMatchObject({ callsign: '9V1NE', theme: 'dark', band: '40m' });
    await expect.poll(() => getKv('settings')).toEqual({ callsign: '9V1NE', theme: 'dark', band: '40m' });
  });
});

describe('loading beside an older copy of RR73', () => {
  it('loads the settings while a 0.4.x copy holds the database, and writes changes after it closes', async () => {
    const old = await openDB(DB_NAME, 1, { upgrade: (d) => d.createObjectStore('kv', { keyPath: 'key' }) });
    await old.put('kv', { key: 'settings', value: { callsign: '9V1NE', theme: 'dark' } });
    await loadSettings();
    expect(settings).toMatchObject({ callsign: '9V1NE', theme: 'dark' });
    // A change waits for the upgrade, then keeps what the older copy stored.
    const saved = updateSettings({ band: '40m' });
    expect(settings.band).toBe('40m');
    old.close();
    await saved;
    expect(await getKv('settings')).toMatchObject({ callsign: '9V1NE', theme: 'dark', band: '40m' });
  });
});
