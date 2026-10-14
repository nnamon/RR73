import { describe, expect, it } from 'vitest';
import { RELAY_DEFAULTS, addRelay, chooseRelay, currentDialHz, relay, relayKey, relayName, removeRelay, setRelayKey, validateRelay, webSdrInput } from './relay.svelte';
import { settings } from './settings.svelte';
import { log } from '../log/log.svelte';

const A = 'https://relay.example.org/qsp';
const B = 'http://192.168.1.20:7373';

describe('the relay', () => {
  it('is none by default, and the app knows none', () => {
    expect(RELAY_DEFAULTS).toEqual({ base: '', relays: [], sdrOn: false, receiver: null, receiverName: '' });
    expect(validateRelay(undefined)).toEqual(RELAY_DEFAULTS);
  });

  it('keeps only stored values of the right type, and a chosen relay only when it was added', () => {
    expect(validateRelay({ base: A, relays: [{ base: `${A}/`, key: 7 }, { base: 'nowhere' }, { base: A, key: 'x' }, 3], sdrOn: 'yes', receiver: '', receiverName: 'X' })).toEqual({
      base: A,
      relays: [{ base: A, key: '' }],
      sdrOn: false,
      receiver: null,
      receiverName: 'X',
    });
    expect(validateRelay({ base: B, relays: [], receiver: 'r1', receiverName: 'R1' })).toMatchObject({ base: '', receiver: null, receiverName: '' });
  });

  it('shows by host', () => {
    expect(relayName('')).toBe('None');
    expect(relayName('https://relay.example.org:8443/qsp')).toBe('relay.example.org:8443');
  });

  it('adds relays to the list, each with its own key, and chooses the one added', () => {
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
    expect(addRelay('relay.example.org')).toBeNull();
    expect(addRelay(` ${A}/ `)).toBe(A);
    expect(addRelay(B)).toBe(B);
    expect(relay.relays.map((r) => r.base)).toEqual([A, B]);
    expect(relay.base).toBe(B);
    setRelayKey(A, 'a'.repeat(16));
    expect([relayKey(), relayKey(A)]).toEqual(['', 'a'.repeat(16)]);
    // Adding one again chooses it and keeps its key.
    expect(addRelay(A)).toBe(A);
    expect(relay.relays).toEqual([
      { base: A, key: 'a'.repeat(16) },
      { base: B, key: '' },
    ]);
    expect(relayKey()).toBe('a'.repeat(16));
    chooseRelay('https://unknown.example.org/qsp');
    expect(relay.base).toBe(A);
    chooseRelay('');
    expect(relay.base).toBe('');
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
  });

  it('gives the web SDR input only once it is on with a relay and a receiver', () => {
    Object.assign(relay, { base: A, relays: [{ base: A, key: '' }, { base: B, key: '' }], sdrOn: false, receiver: 'r1', receiverName: 'R1' });
    expect(webSdrInput()).toBeNull();
    relay.sdrOn = true;
    expect(webSdrInput()).not.toBeNull();
    // Another relay forgets the receiver, whose id belonged to the old one.
    chooseRelay(B);
    expect([relay.receiver, relay.receiverName]).toEqual([null, '']);
    expect(webSdrInput()).toBeNull();
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
  });

  it('removes a relay with Undo, and none is in use after removing the one in use', () => {
    Object.assign(relay, { base: A, relays: [{ base: A, key: 'a'.repeat(16) }, { base: B, key: '' }], sdrOn: true, receiver: 'r1', receiverName: 'R1' });
    removeRelay(B);
    expect(relay.relays.map((r) => r.base)).toEqual([A]);
    expect(relay.base).toBe(A);
    removeRelay(A);
    expect(relay).toMatchObject({ base: '', relays: [], receiver: null, receiverName: '' });
    expect(webSdrInput()).toBeNull();
    expect(log.notice?.text).toBe('Removed relay.example.org');
    log.notice!.undo!();
    expect(relay).toMatchObject({ base: A, relays: [{ base: A, key: 'a'.repeat(16) }], sdrOn: true, receiver: 'r1', receiverName: 'R1' });
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
  });

  it('tunes the receiver to the radio’s dial for the band and mode', () => {
    const before = { band: settings.band, mode: settings.mode, rtty: settings.rtty };
    Object.assign(settings, { band: '20m', mode: 'FT8' });
    expect(currentDialHz()).toBe(14074000);
    Object.assign(settings, { band: '40m', mode: 'FT4' });
    expect(currentDialHz()).toBe(7047500);
    Object.assign(settings, { band: '20m', mode: 'RTTY', rtty: { ...settings.rtty, dialHz: { '20m': 14085000 } } });
    expect(currentDialHz()).toBe(14085000);
    Object.assign(settings, before);
  });
});
