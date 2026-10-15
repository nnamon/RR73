import { describe, expect, it, vi } from 'vitest';
import { PSK_DEFAULTS, initPskReporter, pskHold, pskReporter, pskStatus, validatePskReporter } from './pskreporter.svelte';
import { deliverDecodes, deliverEarly } from './station.svelte';
import { RELAY_DEFAULTS, relay } from './relay.svelte';
import { practice, PRACTICE_DEFAULTS } from './practice.svelte';
import { settings } from './settings.svelte';

describe('PSK Reporter reports', () => {
  it('are off by default, and keep only stored values of the right type', () => {
    expect(PSK_DEFAULTS).toEqual({ on: false, antenna: '' });
    expect(validatePskReporter(undefined)).toEqual(PSK_DEFAULTS);
    expect(validatePskReporter({ on: 'yes', antenna: 'Dipole' })).toEqual({ on: false, antenna: 'Dipole' });
  });

  it('come only from the radio, in FT8 and FT4, with a relay, callsign and grid', () => {
    const before = { callsign: settings.callsign, grid: settings.grid, mode: settings.mode };
    const base = 'https://relay.example.org/qsp';
    Object.assign(pskReporter, { on: false });
    expect(pskHold()).toBe('off');
    Object.assign(pskReporter, { on: true });
    expect(pskHold()).toBe('relay');
    Object.assign(relay, { base, relays: [{ base, key: '' }], sdrOn: false, receiver: null, receiverName: '' });
    Object.assign(settings, { callsign: '9V1NE', grid: '', mode: 'FT8' });
    expect(pskHold()).toBe('station');
    settings.grid = 'OJ11';
    expect(pskHold()).toBeNull();
    practice.on = true;
    expect(pskHold()).toBe('practice');
    practice.on = false;
    Object.assign(relay, { sdrOn: true, receiver: 'r1', receiverName: 'R1' });
    expect(pskHold()).toBe('web-sdr');
    Object.assign(relay, { sdrOn: false });
    settings.mode = 'WSPR';
    expect(pskHold()).toBe('mode');
    Object.assign(settings, before);
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
    Object.assign(practice, PRACTICE_DEFAULTS);
    Object.assign(pskReporter, PSK_DEFAULTS);
  });

  it('go out once for each slot: with the final pass, which carries the early pass decodes again', () => {
    // The queue sends on a timer; fake timers keep it from firing, and fetch refuses.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('no network in tests'))));
    const before = { callsign: settings.callsign, grid: settings.grid, mode: settings.mode };
    const base = 'https://relay.example.org/qsp';
    Object.assign(relay, { base, relays: [{ base, key: '' }], sdrOn: false, receiver: null, receiverName: '' });
    Object.assign(settings, { callsign: '9V1NE', grid: 'OJ11', mode: 'FT8' });
    Object.assign(pskReporter, { on: true });
    expect(pskHold()).toBeNull();
    initPskReporter();
    const start = Date.UTC(2026, 9, 15, 10, 0, 0);
    const d = (text: string, freq_hz: number) => ({ text, freq_hz, dt_s: 0.1, snr_db: -10 });
    deliverEarly({ startUtcMs: start, mode: 'FT8', decodes: [d('CQ K1ABC FN42', 1000)], ms: 30, early: true });
    expect(pskStatus.waiting).toBe(0);
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [d('CQ K1ABC FN42', 1001), d('CQ JA1KXM PM95', 1500)], ms: 90 });
    expect(pskStatus.waiting).toBe(2);
    Object.assign(settings, before);
    Object.assign(relay, { ...RELAY_DEFAULTS, relays: [] });
    Object.assign(pskReporter, PSK_DEFAULTS);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
