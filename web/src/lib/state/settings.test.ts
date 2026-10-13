import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, normaliseCallsign, settings, updateSettings, validate } from './settings.svelte';
import { getKv } from './db';

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
    settings.callsign = '';
    await loadSettings();
    expect(settings.callsign).toBe('9V1NE');
  });
});
