// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogQsoRecord } from '../log/types';

const { logged } = vi.hoisted(() => ({ logged: [] as LogQsoRecord[] }));

vi.mock('../log/log.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../log/log.svelte')>();
  return {
    ...real,
    logQso: (r: LogQsoRecord) => {
      logged.push(r);
      return Promise.resolve();
    },
  };
});

import { sheets } from '../app/sheets.svelte';
import { spotFeed } from '../spots/feed.svelte';
import type { Spot } from '../spots/types';
import { Sim, T0, decode } from '../testing/qso-sim';
import { setFeature } from './features.svelte';
import { practice } from './practice.svelte';
import { dispatch, qso } from './qso.svelte';
import { resetSettings, settings, updateSettings } from './settings.svelte';
import { CHASE_MS, chaseMark, goTarget, goToSpot, linkSpotFeed, spots, withChaseRefs } from './spots.svelte';

const NOW = Date.UTC(2026, 9, 13, 13, 14, 52);

function spot(over: Partial<Spot> = {}): Spot {
  return {
    id: 'pota:1',
    source: 'pota',
    activator: 'JA1KXM/P',
    refs: [{ programme: 'POTA', ref: 'JA-1234', name: 'Example park' }],
    country: '',
    freqHz: 14_075_000,
    band: '20m',
    mode: 'FT8',
    digital: 'FT8',
    spottedAt: NOW - 60_000,
    spotter: 'W1AW',
    automatic: false,
    snrDb: null,
    qrt: false,
    comments: '',
    ...over,
  };
}

function record(over: Partial<LogQsoRecord> = {}): LogQsoRecord {
  return { call: 'JA1KXM', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: NOW, endUtcMs: NOW + 60_000, reportSent: '-10', reportRcvd: '-09', ...over };
}

beforeEach(() => {
  resetSettings();
  spots.chase = null;
  sheets.band = false;
  practice.on = false;
  logged.length = 0;
  location.hash = '#/spots';
});

describe('Go on a spot', () => {
  it('takes FT8 and FT4 spots on bands RR73 has a dial for', () => {
    expect(goTarget(spot())).toEqual({ band: '20m', mode: 'FT8' });
    expect(goTarget(spot({ band: '40m', digital: 'FT4' }))).toEqual({ band: '40m', mode: 'FT4' });
    expect(goTarget(spot({ digital: null, mode: 'CW' }))).toBeNull();
    expect(goTarget(spot({ band: '2m' }))).toEqual({ band: '2m', mode: 'FT8' });
    expect(goTarget(spot({ band: '70cm', digital: 'FT4' }))).toBeNull();
    expect(goTarget(spot({ band: '23cm' }))).toBeNull();
    expect(goTarget(spot({ band: null }))).toBeNull();
    // 160m has no FT4 frequency.
    expect(goTarget(spot({ band: '160m', digital: 'FT4' }))).toBeNull();
  });

  it('sets the band and mode, opens Operate with the band sheet and chases the station', async () => {
    await updateSettings({ band: '40m', mode: 'FT4' });
    expect(goToSpot(spot(), NOW)).toBe(true);
    expect(settings.band).toBe('20m');
    expect(settings.mode).toBe('FT8');
    expect(sheets.band).toBe(true);
    expect(location.hash).toBe('#/operate');
    expect(spots.chase).toEqual({ call: 'JA1KXM/P', band: '20m', refs: [{ programme: 'POTA', ref: 'JA-1234' }], atMs: NOW });
  });

  it('does nothing for a spot RR73 cannot work', async () => {
    await updateSettings({ band: '40m', mode: 'FT8' });
    expect(goToSpot(spot({ digital: null, mode: 'SSB' }), NOW)).toBe(false);
    expect(settings.band).toBe('40m');
    expect(sheets.band).toBe(false);
    expect(location.hash).toBe('#/spots');
    expect(spots.chase).toBeNull();
  });
});

describe('the chase', () => {
  it('marks rows with the first reference, or Spotted for a DX spot, until it lapses', () => {
    goToSpot(spot({ refs: [{ programme: 'SOTA', ref: 'JA/TK-001', name: '' }, { programme: 'POTA', ref: 'JA-1234', name: '' }] }), NOW);
    expect(chaseMark(spots.chase, NOW)).toEqual({ call: 'JA1KXM/P', text: 'JA/TK-001', spoken: 'spotted, SOTA JA/TK-001' });
    expect(chaseMark(spots.chase, NOW + CHASE_MS)).not.toBeNull();
    expect(chaseMark(spots.chase, NOW + CHASE_MS + 1)).toBeNull();
    goToSpot(spot({ refs: [] }), NOW);
    expect(chaseMark(spots.chase, NOW)?.text).toBe('Spotted');
    expect(chaseMark(null, NOW)).toBeNull();
  });

  it('gives a QSO with the station on its band the spot’s references, once', () => {
    goToSpot(spot(), NOW);
    expect(withChaseRefs(record())).toEqual({ ...record(), theirRefs: [{ programme: 'POTA', ref: 'JA-1234' }] });
    expect(spots.chase).toBeNull();
    expect(withChaseRefs(record())).toEqual(record());
  });

  it('leaves other stations, other bands, lapsed chases and references already given alone', () => {
    goToSpot(spot(), NOW);
    expect(withChaseRefs(record({ call: 'JA2XYZ' }))).toEqual(record({ call: 'JA2XYZ' }));
    expect(withChaseRefs(record({ band: '40m' }))).toEqual(record({ band: '40m' }));
    expect(withChaseRefs(record({ endUtcMs: NOW + CHASE_MS + 1 }))).toEqual(record({ endUtcMs: NOW + CHASE_MS + 1 }));
    expect(spots.chase).not.toBeNull();
    const own = record({ theirRefs: [{ programme: 'WWFF', ref: 'JAFF-0001' }] });
    expect(withChaseRefs(own)).toEqual(own);
    expect(spots.chase).toBeNull();
  });

  it('reaches the log when the sequencer logs a QSO with the chased station', () => {
    // A QSO with JA1KXM up to their RR73, played on the sequencer alone.
    const s = new Sim();
    s.hear(1, [decode('CQ JA1KXM PM95', -12, 1418, 0.2)]);
    s.call(1, decode('CQ JA1KXM PM95', -12, 1418, 0.2));
    s.run(2, 2);
    s.run(3, 4, { 3: [decode('9V1NE JA1KXM -09', -11, 1418, 0.2)] });
    s.play(5);
    goToSpot(spot(), T0);
    qso.st = s.st;
    dispatch({ type: 'slotDecoded', slotStartMs: s.at(5), pass: 'final', decodes: [decode('9V1NE JA1KXM RR73', -10, 1418, 0.2)], nowMs: s.at(6, 0.1) });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ call: 'JA1KXM', band: '20m', theirRefs: [{ programme: 'POTA', ref: 'JA-1234' }] });
    expect(spots.chase).toBeNull();
  });
});

describe('the feed’s sources', () => {
  it('follow the Optional features switches, and pause while the practice band is on', async () => {
    const enabled = () => Object.fromEntries(spotFeed.status.map((s) => [s.id, s.enabled]));
    const stop = linkSpotFeed();
    flushSync();
    expect(enabled()).toEqual({ pota: false, hamqth: false });
    await setFeature('potaSpots', true);
    flushSync();
    expect(enabled()).toEqual({ pota: true, hamqth: false });
    await setFeature('clusterSpots', true);
    flushSync();
    expect(enabled()).toEqual({ pota: true, hamqth: true });
    practice.on = true;
    flushSync();
    expect(enabled()).toEqual({ pota: false, hamqth: false });
    practice.on = false;
    flushSync();
    expect(enabled()).toEqual({ pota: true, hamqth: true });
    stop();
    spotFeed.setEnabled({ pota: false, hamqth: false });
  });
});
