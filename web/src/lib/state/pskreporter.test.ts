import { describe, expect, it } from 'vitest';
import { PSK_DEFAULTS, pskHold, pskReporter, validatePskReporter } from './pskreporter.svelte';
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
});
