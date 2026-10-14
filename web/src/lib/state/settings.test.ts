import { deleteDB, openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, FEATURES_OFF, WSPR_DEFAULTS, loadSettings, migration, normaliseCallsign, resetSettings, settings, settingsStatus, SETTINGS_SCHEMA, updateSettings, validate } from './settings.svelte';
import { closeDb, DB_NAME, getKv, setKv } from './db';
import { defaultHighlights, presetHighlights } from '../decode/highlight';
import { RTTY_DEFAULTS } from '../rtty/settings';
import { keyboardDefaults } from '../keyboard/settings';

const SEQ = { run: false, tailEnd: true, huntOrder: 'unworked', watchdog: true, watchdogMin: 6 };
/** What schema 8 adds: RTTY, the keyboard modes' macros and contest, and the operator's name and QTH. */
const KB = { myName: '', myQth: '', rtty: { ...RTTY_DEFAULTS, dialHz: {} }, keyboard: keyboardDefaults() };

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
    await expect.poll(() => getKv('settings')).toEqual({ callsign: '9V1NE', theme: 'dark', band: '40m', features: FEATURES_OFF, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB, schema: SETTINGS_SCHEMA });
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
    expect(migration(undefined)).toEqual({ schema: SETTINGS_SCHEMA, features: FEATURES_OFF, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB });
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
    await expect.poll(() => getKv('settings')).toEqual({ callsign: '9V1NE', features: { ...FEATURES_OFF, activations: true }, highlights: defaultHighlights(), ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB, schema: SETTINGS_SCHEMA });
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

describe('the colour scheme migration', () => {
  /** The decode colours 0.8.0 to 0.19.2 shipped, every category on. */
  const SHIPPED = [
    { id: 'myCall', on: true, colour: '#FF6666' },
    { id: 'newGrid', on: true, colour: '#FF8000' },
    { id: 'newGridBand', on: true, colour: '#FFCC99' },
    { id: 'newCall', on: true, colour: '#3399FF' },
    { id: 'newCallBand', on: true, colour: '#99CCFF' },
    { id: 'ending', on: true, colour: '#FFE2C8' },
    { id: 'cq', on: true, colour: '#66FF66' },
    { id: 'sent', on: true, colour: '#C98A1A' },
    { id: 'worked', on: true, colour: '#8C93A0' },
  ];
  const QUIET_OFF = ['newGrid', 'newGridBand', 'newCall', 'newCallBand', 'worked'];

  it('gives the shipped colours RR73’s scheme, and the shipped Quiet the new Quiet, and stores that once', async () => {
    const stored = { callsign: '9V1NE', highlights: SHIPPED, schema: 9 };
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, highlights: presetHighlights('rr73') });
    const quiet = SHIPPED.map((e) => ({ ...e, on: !QUIET_OFF.includes(e.id) }));
    expect(migration({ highlights: quiet, schema: 9 })).toEqual({ schema: SETTINGS_SCHEMA, highlights: presetHighlights('quiet') });
    await setKv('settings', stored);
    await loadSettings();
    expect(settings.highlights).toEqual(presetHighlights('rr73'));
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, highlights: presetHighlights('rr73'), schema: SETTINGS_SCHEMA });
  });

  it('keeps colours the operator changed, moved or switched', () => {
    const recoloured = SHIPPED.map((e) => (e.id === 'cq' ? { ...e, colour: '#00AA00' } : e));
    const moved = [SHIPPED[1], SHIPPED[0], ...SHIPPED.slice(2)];
    const switched = SHIPPED.map((e) => (e.id === 'worked' ? { ...e, on: false } : e));
    for (const highlights of [recoloured, moved, switched]) expect(migration({ highlights, schema: 9 })).toEqual({ schema: SETTINGS_SCHEMA });
  });
});

describe('the sequencer settings migration', () => {
  it('stores Run off, tail-ending on, not worked first and a 6 min watchdog on a phone that ran 0.9', async () => {
    const stored = { callsign: '9V1NE', highlights: defaultHighlights(), schema: 3 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB });
    await loadSettings();
    expect(settings).toMatchObject({ callsign: '9V1NE', ...SEQ });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, ...SEQ, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB, schema: SETTINGS_SCHEMA });
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

  it('starts Hunt at 4 calls a station and takes any whole number from 1 to 99', () => {
    expect(validate({}).huntCalls).toBe(4);
    expect(validate({ huntCalls: 1 }).huntCalls).toBe(1);
    expect(validate({ huntCalls: 99 }).huntCalls).toBe(99);
    for (const bad of [0, 100, 2.5, -1, Number.NaN, '3']) expect(validate({ huntCalls: bad }).huntCalls).toBe(4);
  });

  it('starts with Responses refresh watchdog off and keeps what the operator sets', () => {
    expect(validate({}).watchdogRefresh).toBe(false);
    expect(validate({ watchdogRefresh: true }).watchdogRefresh).toBe(true);
    expect(validate({ watchdogRefresh: 'yes' }).watchdogRefresh).toBe(false);
  });
});

describe('the waterfall contrast migration', () => {
  it('starts at Normal on a phone that ran 0.10.0, keeping its sequencer settings, and stores that once', async () => {
    const mine = { run: true, tailEnd: false, huntOrder: 'farthest', watchdog: false, watchdogMin: 2.5 };
    const stored = { callsign: '9V1NE', highlights: defaultHighlights(), ...mine, schema: 5 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB });
    await loadSettings();
    expect(settings).toMatchObject({ ...mine, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, waterfallContrast: 'normal', wspr: WSPR_DEFAULTS, ...KB, schema: SETTINGS_SCHEMA });
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
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, wspr: WSPR_DEFAULTS, ...KB });
    await loadSettings();
    expect(settings).toMatchObject({ ...mine, wspr: WSPR_DEFAULTS });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, wspr: WSPR_DEFAULTS, ...KB, schema: SETTINGS_SCHEMA });
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

describe('the RTTY settings migration', () => {
  it('adds RTTY, the macros and the name and QTH at their defaults on a phone that ran 0.12, keeping every other value', async () => {
    const mine = { callsign: '9V1NE', band: '40m', mode: 'WSPR', rxHz: 900, wspr: { ...WSPR_DEFAULTS, txPct: 35 } };
    const stored = { ...mine, schema: 7 };
    await setKv('settings', stored);
    expect(migration(stored)).toEqual({ schema: SETTINGS_SCHEMA, ...KB });
    await loadSettings();
    expect(settings).toMatchObject({ ...mine, ...KB });
    await expect.poll(() => getKv('settings')).toEqual({ ...stored, ...KB, schema: SETTINGS_SCHEMA });
  });

  it('keeps RTTY on a band with an RTTY dial and refuses it on 60m and 2m', () => {
    expect(validate({ band: '20m', mode: 'RTTY' })).toMatchObject({ band: '20m', mode: 'RTTY' });
    expect(validate({ band: '60m', mode: 'RTTY' })).toMatchObject({ band: '60m', mode: 'FT8' });
    expect(validate({ band: '2m', mode: 'RTTY' })).toMatchObject({ band: '2m', mode: 'WSPR' });
  });

  it('keeps stored RTTY values that are valid and drops the rest', () => {
    const r = validate({ rtty: { baud: 50, shiftHz: 425, stopBits: 2, squelchDb: null, figures: 'ita2', idleStopS: 0, watchdogMin: 0, markHz: 2210, dialHz: { '20m': 14085000, '9m': 1 } } }).rtty;
    expect(r).toMatchObject({ baud: 50, shiftHz: 425, stopBits: 2, squelchDb: null, figures: 'ita2', idleStopS: 0, watchdogMin: 0, markHz: 2210, dialHz: { '20m': 14085000 } });
    const bad = validate({ rtty: { baud: 300, shiftHz: 20, stopBits: 3, squelchDb: -40, figures: 'x', idleStopS: 5, repeatGapS: 0, markHz: 2950 } }).rtty;
    expect(bad).toMatchObject({ baud: 45.45, shiftHz: 170, stopBits: 1.5, squelchDb: -14, figures: 'us', idleStopS: 60, repeatGapS: 3 });
    // The mark keeps both tones inside 200 to 2900 Hz.
    expect(bad.markHz).toBe(2900);
    expect(validate({ myName: '  amon ', myQth: 'singapore   city' })).toMatchObject({ myName: 'AMON', myQth: 'SINGAPORE CITY' });
  });

  it('gives the Report macro 0.14.0 stored Return to Rx once, and keeps one the operator edited', async () => {
    const shipped = keyboardDefaults().macros;
    const old = { ...shipped, qso: shipped.qso.map((m) => (m.id === 'q-report' ? { ...m, returnToRx: false } : m)) };
    const stored = { callsign: '9V1NE', keyboard: { ...keyboardDefaults(), macros: old, nextSerial: 42 }, schema: 8 };
    await setKv('settings', stored);
    await loadSettings();
    expect(settings.keyboard.macros.qso.find((m) => m.id === 'q-report')?.returnToRx).toBe(true);
    expect(settings.keyboard.nextSerial).toBe(42);
    await expect.poll(async () => ((await getKv('settings')) as { schema: number }).schema).toBe(SETTINGS_SCHEMA);

    const edited = { ...old, qso: old.qso.map((m) => (m.id === 'q-report' ? { ...m, text: 'UR RST {RST} {RST}' } : m)) };
    expect(migration({ keyboard: { macros: edited }, schema: 8 })).toMatchObject({ keyboard: { macros: { qso: expect.arrayContaining([expect.objectContaining({ id: 'q-report', returnToRx: false })]) } } });
    // Off by the operator's choice after the fix: schema 9 leaves it off.
    expect(migration({ keyboard: { macros: old }, schema: SETTINGS_SCHEMA })).toEqual({});
  });

  it('keeps the macro sets, contest and serial, and drops what is malformed', () => {
    const k = validate({ keyboard: { set: 'contest', contestId: 'cq-wpx-rtty!', nextSerial: 42, serialDigits: 4, exchange: '599 {NR}', macros: { qso: [{ id: 'a', label: 'Hi', text: 'HI {CALL}', returnToRx: false }, { id: 2 }] } } }).keyboard;
    expect(k).toMatchObject({ set: 'contest', contestId: 'CQ-WPX-RTTY', nextSerial: 42, serialDigits: 4 });
    expect(k.macros.qso).toEqual([{ id: 'a', label: 'Hi', text: 'HI {CALL}', returnToRx: false, logWhenSent: false }]);
    expect(k.macros.contest).toEqual(keyboardDefaults().macros.contest);
    expect(validate({ keyboard: { nextSerial: 0, serialDigits: 9 } }).keyboard).toMatchObject({ nextSerial: 1, serialDigits: 3 });
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
