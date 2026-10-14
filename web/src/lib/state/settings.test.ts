import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, FEATURES_OFF, WSPR_DEFAULTS, loadSettings, migration, normaliseCallsign, resetSettings, settings, settingsStatus, SETTINGS_SCHEMA, updateSettings, validate } from './settings.svelte';
import { closeDb, DB_NAME, getKv, setKv } from './db';
import { defaultHighlights } from '../decode/highlight';

const SEQ = { run: false, tailEnd: true, huntOrder: 'unworked', watchdog: true, watchdogMin: 6 };

beforeEach(async () => {
  await closeDb();
  await deleteDB(DB_NAME);
  resetSettings();
});

describe('settings', () => {
  it('starts with an empty callsign on 20m FT8 and every optional feature off', () => {
    expect(DEFAULTS.callsign).toBe('');
    expect(DEFAULTS.band).toBe('20m');
    expect(DEFAULTS.mode).toBe('FT8');
    expect(DEFAULTS.features).toEqual({ activations: false, potaSpots: false, clusterSpots: false, lotw: false });
  });

  it('normalises callsigns', () => {
    expect(normaliseCallsign(' 9v1ne ')).toBe('9V1NE');
    expect(normaliseCallsign('vk3/9v1ne-p')).toBe('VK3/9V1NEP');
    expect(normaliseCallsign('ABCDEFGHIJKLMNOP')).toHaveLength(13);
  });

  it('reads and normalises the grid and the operating choices', () => {
    expect(validate({ grid: 'oj11AB', ack: 'RRR', workDupes: true, cqParity: 'odd', queueOrder: 'strongest' })).toMatchObject({
      grid: 'OJ11ab',
      ack: 'RRR',
      workDupes: true,
      cqParity: 'odd',
      queueOrder: 'strongest',
    });
    expect(validate({ grid: 'ZZ99', ack: 'R', cqParity: 'third', queueOrder: 'random' })).toMatchObject({ grid: '', ack: 'RR73', cqParity: 'even', queueOrder: 'first' });
  });

  it('reads Hold Tx and whether a frequency was set from the waterfall', () => {
    expect(DEFAULTS).toMatchObject({ holdTx: true, freqPicked: false });
    expect(validate({ holdTx: false, freqPicked: true })).toMatchObject({ holdTx: false, freqPicked: true });
    expect(validate({ holdTx: 'no', freqPicked: 1 })).toMatchObject({ holdTx: true, freqPicked: false });
  });

  it('keeps only valid stored values', () => {
    expect(
      validate({
        callsign: '9v1ne',
        band: '4m',
        mode: 'JT65',
        outputLevel: 3,
        rxHz: 50,
        txHz: 1180,
        theme: 'dark',
        checklist: { focus: true, clicks: 'yes' },
        features: { activations: true, potaSpots: 'on', lotw: 1 },
      }),
    ).toEqual({
      ...DEFAULTS,
      callsign: '9V1NE',
      txHz: 1180,
      theme: 'dark',
      checklist: { focus: true, clicks: false, volume: false },
      features: { ...FEATURES_OFF, activations: true },
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
    expect(settingsStatus.loaded).toBe(true);
  });
});

describe('the optional features migration', () => {
  it('turns every feature off on a phone that ran 0.5.0, and stores that once', async () => {
    // 0.5.0 stored settings with no schema; it always showed activations.
    await setKv('settings', { callsign: '9V1NE', theme: 'dark', band: '40m' });
    await loadSettings();
    expect(settings).toMatchObject({ callsign: '9V1NE', theme: 'dark', band: '40m', features: FEATURES_OFF });
    await expect.poll(() => getKv('settings')).toEqual({ callsign: '9V1NE', theme: 'dark', band: '40m', features: FEATURES_OFF, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, schema: SETTINGS_SCHEMA });
  });

  it('keeps the features of a current record', async () => {
    await setKv('settings', { callsign: '9V1NE', features: { ...FEATURES_OFF, activations: true, lotw: true }, schema: SETTINGS_SCHEMA });
    await loadSettings();
    expect(settings.features).toEqual({ ...FEATURES_OFF, activations: true, lotw: true });
    expect(migration(await getKv('settings'))).toEqual({});
  });

  it('migrates nothing on a new phone', async () => {
    await loadSettings();
    expect(settings).toEqual(DEFAULTS);
    expect(await getKv('settings')).toBeUndefined();
    expect(migration(undefined)).toEqual({ schema: SETTINGS_SCHEMA, features: FEATURES_OFF, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS });
  });

  it('keeps a feature turned on before the stored settings arrived', async () => {
    await setKv('settings', { callsign: '9V1NE' });
    void updateSettings({ features: { ...FEATURES_OFF, potaSpots: true } });
    await loadSettings();
    expect(settings.features.potaSpots).toBe(true);
    await expect.poll(() => getKv('settings')).toMatchObject({ callsign: '9V1NE', features: { potaSpots: true }, schema: SETTINGS_SCHEMA });
  });
});

describe('the decode colours migration', () => {
  it('turns every category on at the WSJT-X defaults on a phone that ran 0.7, and stores that once', async () => {
    await setKv('settings', { callsign: '9V1NE', features: { ...FEATURES_OFF, activations: true }, schema: 2 });
    await loadSettings();
    expect(settings.highlights).toEqual(defaultHighlights());
    expect(settings.highlights.every((h) => h.on)).toBe(true);
    expect(settings.features.activations).toBe(true);
    await expect.poll(() => getKv('settings')).toEqual({ callsign: '9V1NE', features: { ...FEATURES_OFF, activations: true }, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, schema: SETTINGS_SCHEMA });
  });

  it('keeps a stored order, colours and switches', async () => {
    const mine = [...defaultHighlights()].reverse().map((h, i) => ({ ...h, on: i % 2 === 0, colour: i === 0 ? '#123abc' : h.colour }));
    await setKv('settings', { callsign: '9V1NE', highlights: mine, schema: SETTINGS_SCHEMA });
    await loadSettings();
    expect(settings.highlights.map((h) => h.id)).toEqual(mine.map((h) => h.id));
    expect(settings.highlights.map((h) => h.on)).toEqual(mine.map((h) => h.on));
    expect(settings.highlights[0].colour).toBe('#123ABC');
    expect(migration(await getKv('settings'))).toEqual({});
  });
});

describe('the sequencer settings migration', () => {
  it('stores Run off, tail-ending on, not worked first and a 6 min watchdog on a phone that ran 0.9', async () => {
    const stored = { callsign: '9V1NE', highlights: defaultHighlights(), schema: 3 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS });
    await loadSettings();
    expect(settings).toMatchObject({ callsign: '9V1NE', ...SEQ });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, schema: SETTINGS_SCHEMA });
  });

  it('keeps sequencer settings the operator changed', async () => {
    const mine = { run: true, tailEnd: false, huntOrder: 'farthest', watchdog: false, watchdogMin: 2.5 };
    await setKv('settings', { callsign: '9V1NE', ...mine, schema: SETTINGS_SCHEMA });
    await loadSettings();
    expect(settings).toMatchObject(mine);
  });

  it('takes any positive watchdog limit and refuses the rest', () => {
    expect(validate({ watchdogMin: 0.25 }).watchdogMin).toBe(0.3);
    expect(validate({ watchdogMin: 90 }).watchdogMin).toBe(90);
    for (const bad of [0, -3, Number.NaN, 10_000]) expect(validate({ watchdogMin: bad }).watchdogMin).toBe(6);
    expect(validate({ huntOrder: 'loudest', run: 'yes' })).toMatchObject({ huntOrder: 'unworked', run: false });
  });
});

describe('the waterfall contrast migration', () => {
  it('starts at Normal on a phone that ran 0.10.0, keeping its sequencer settings, and stores that once', async () => {
    const mine = { run: true, tailEnd: false, huntOrder: 'farthest', watchdog: false, watchdogMin: 2.5 };
    const stored = { callsign: '9V1NE', highlights: defaultHighlights(), ...mine, schema: 5 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS });
    await loadSettings();
    expect(settings).toMatchObject({ ...mine, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, schema: SETTINGS_SCHEMA });
  });

  it('keeps a stored contrast and drops an unknown one', async () => {
    await setKv('settings', { waterfallContrast: 'high', schema: SETTINGS_SCHEMA });
    await loadSettings();
    expect(settings.waterfallContrast).toBe('high');
    expect(validate({ waterfallContrast: 'max' }).waterfallContrast).toBe('normal');
  });
});

describe('the WSPR settings migration', () => {
  it('adds WSPR at its defaults on a phone that ran 0.11, keeping every other value, and stores that once', async () => {
    const mine = { callsign: '9V1NE', band: '40m', mode: 'FT4', rxHz: 900, txHz: 1200, watchdogMin: 4, waterfallContrast: 'high' };
    const stored = { ...mine, schema: 6 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, wspr: WSPR_DEFAULTS });
    await loadSettings();
    expect(settings).toMatchObject({ ...mine, wspr: WSPR_DEFAULTS });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, wspr: WSPR_DEFAULTS, schema: SETTINGS_SCHEMA });
  });

  it('starts at 20%, 37 dBm, 1500 Hz, Stop beacon after 1 h, sorted by distance', () => {
    expect(WSPR_DEFAULTS).toEqual({ txPct: 20, powerDbm: 37, txHz: 1500, stopAfterMin: 60, sort: 'distance' });
  });

  it('keeps stored WSPR values that are valid and drops the rest', () => {
    expect(validate({ mode: 'WSPR', wspr: { txPct: 35, powerDbm: 23, txHz: 1555.4, stopAfterMin: 0, sort: 'snr' } })).toMatchObject({
      mode: 'WSPR',
      wspr: { txPct: 35, powerDbm: 23, txHz: 1555, stopAfterMin: 0, sort: 'snr' },
    });
    expect(validate({ wspr: { txPct: 33, powerDbm: 31, txHz: 1700, stopAfterMin: -1, sort: 'newest' } }).wspr).toEqual({ ...WSPR_DEFAULTS, txHz: 1590 });
    expect(validate({ wspr: 'x' }).wspr).toEqual(WSPR_DEFAULTS);
  });

  it('keeps a band and mode pair that has a dial frequency, and takes WSPR on 2m', () => {
    expect(validate({ band: '2m', mode: 'WSPR' })).toMatchObject({ band: '2m', mode: 'WSPR' });
    expect(validate({ band: '2m', mode: 'FT8' })).toMatchObject({ band: '2m', mode: 'WSPR' });
    expect(validate({ band: '2m' })).toMatchObject({ band: '2m', mode: 'WSPR' });
    expect(validate({ band: '60m', mode: 'FT4' })).toMatchObject({ band: '60m', mode: 'FT8' });
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
    expect(await getKv('settings')).toMatchObject({ callsign: '9V1NE', theme: 'dark', band: '40m', features: FEATURES_OFF });
  });
});
