import { describe, expect, it } from 'vitest';
import { ageSpoken, ageText, emptyText, freqModeText, mhzText, noteText, referenceText, refsText, rowSpoken, spottedText, statusText } from './copy';
import type { FailingSource, SpotFeedView } from './feed.svelte';
import { defaultFilter, type FilterContext } from './filter';
import { SPOT_CLASSES } from './types';
import { dxSpot, NOW, spot } from '../testing/spots';

const MIN = 60_000;
const at = (h: number, m: number) => Date.UTC(2026, 9, 13, h, m, 0);
const POTA_ONLY = { sources: [{ id: 'pota' as const, name: 'POTA' }], classes: ['POTA' as const] };
const BOTH = {
  sources: [
    { id: 'pota' as const, name: 'POTA' },
    { id: 'hamqth' as const, name: 'HamQTH' },
  ],
  classes: SPOT_CLASSES,
};
const view = (over: Partial<SpotFeedView> = {}): SpotFeedView => ({ ...POTA_ONLY, online: true, updatedAt: at(13, 21), loading: false, failing: [], credits: [], ...over });
const ctx: FilterContext = { myBands: [], isNew: null };

describe('ages', () => {
  it('rounds down to minutes, then hours', () => {
    expect(ageText(NOW, NOW)).toBe('now');
    expect(ageText(NOW - 59_999, NOW)).toBe('now');
    expect(ageText(NOW - MIN, NOW)).toBe('1 min');
    expect(ageText(NOW - 59 * MIN, NOW)).toBe('59 min');
    expect(ageText(NOW - 60 * MIN, NOW)).toBe('1 h');
    expect(ageText(NOW - 150 * MIN, NOW)).toBe('2 h');
  });

  it('counts a spot ahead of the phone clock as now', () => {
    expect(ageText(NOW + 5 * MIN, NOW)).toBe('now');
  });

  it('spells ages out for screen readers', () => {
    expect(ageSpoken(NOW - 10_000, NOW)).toBe('less than a minute ago');
    expect(ageSpoken(NOW - MIN, NOW)).toBe('1 minute ago');
    expect(ageSpoken(NOW - 14 * MIN, NOW)).toBe('14 minutes ago');
    expect(ageSpoken(NOW - 60 * MIN, NOW)).toBe('1 hour ago');
    expect(ageSpoken(NOW - 125 * MIN, NOW)).toBe('2 hours ago');
  });
});

describe('row text', () => {
  it('writes MHz with 3 decimals, more where needed', () => {
    expect(mhzText(14_074_000)).toBe('14.074');
    expect(mhzText(7_010_500)).toBe('7.0105');
    expect(mhzText(7_047_500)).toBe('7.0475');
    expect(mhzText(1_840_000)).toBe('1.840');
    expect(mhzText(144_300_000)).toBe('144.300');
    expect(mhzText(10_489_770_000)).toBe('10489.770');
  });

  it('pairs frequency and mode', () => {
    expect(freqModeText(spot())).toBe('14.074 FT8');
    expect(freqModeText(spot({ mode: 'DATA', digital: 'FT4', freqHz: 14_080_000 }))).toBe('14.080 FT4');
    expect(freqModeText(spot({ mode: '', digital: null, freqHz: 10_123_000 }))).toBe('10.123');
    expect(freqModeText(spot({ mode: 'CW', digital: null, freqHz: null }))).toBe('CW');
    expect(freqModeText(spot({ mode: '', digital: null, freqHz: null }))).toBe('');
  });

  it('names references, the first known name, or the country of a DX spot', () => {
    expect(referenceText(spot())).toBe('POTA VK-0921 · Example park');
    expect(referenceText(spot({ refs: [{ programme: 'POTA', ref: 'VK-0921', name: '' }] }))).toBe('POTA VK-0921');
    const two = spot({
      refs: [
        { programme: 'POTA', ref: 'NZ-0008', name: 'Long Bay Regional Park' },
        { programme: 'IOTA', ref: 'OC-134', name: '' },
      ],
    });
    expect(referenceText(two)).toBe('POTA NZ-0008, IOTA OC-134 · Long Bay Regional Park');
    expect(refsText(two)).toBe('POTA NZ-0008, IOTA OC-134');
    expect(referenceText(dxSpot())).toBe('DX · New Zealand');
    expect(referenceText(dxSpot({ country: '' }))).toBe('DX');
  });

  it('says who spotted it, when, and the skimmer SNR with a minus sign', () => {
    const t = at(13, 19);
    expect(spottedText(spot({ spottedAt: t }))).toBe('Spotted by VK2ESN at 13:19 UTC');
    expect(spottedText(spot({ spottedAt: t, spotter: 'JI1HFJ', automatic: true, snrDb: -15 }))).toBe('Spotted by JI1HFJ (RBN) at 13:19 UTC · −15 dB');
    expect(spottedText(spot({ spottedAt: t, spotter: 'JA1CCA', automatic: true, snrDb: 10 }))).toBe('Spotted by JA1CCA (RBN) at 13:19 UTC · 10 dB');
    expect(spottedText(spot({ spottedAt: t, spotter: '' }))).toBe('Spotted at 13:19 UTC');
  });

  it('shows a person’s comments unless they repeat the mode', () => {
    expect(noteText(spot({ comments: 'FT8 2-fer JP-1207' }))).toBe('FT8 2-fer JP-1207');
    expect(noteText(spot({ comments: 'FT8' }))).toBe('');
    expect(noteText(spot({ comments: 'ft8' }))).toBe('');
    expect(noteText(dxSpot({ comments: 'ft8', mode: '', digital: 'FT8' }))).toBe('');
    expect(noteText(spot({ comments: 'RBN -15 dB via JI1HFJ-#', automatic: true }))).toBe('');
    expect(noteText(spot({ comments: '' }))).toBe('');
  });

  it('gives a row a spoken label that starts with the callsign', () => {
    expect(rowSpoken(spot(), 'New park', NOW)).toBe('VK3QRP, New park, 14.074 MHz FT8, POTA VK-0921, Example park, 2 minutes ago');
    expect(rowSpoken(spot({ freqHz: null, refs: [{ programme: 'POTA', ref: 'VK-0921', name: '' }] }), null, NOW)).toBe('VK3QRP, FT8, POTA VK-0921, 2 minutes ago');
    expect(rowSpoken(dxSpot({ activator: 'ZL3TX' }), null, NOW)).toBe('ZL3TX, 14.074 MHz FT8, DX, New Zealand, 2 minutes ago');
  });
});

describe('emptyText', () => {
  it('says how to turn spots on when no source is enabled', () => {
    expect(emptyText(view({ sources: [], classes: [] }), defaultFilter(), ctx)).toBe('Spots are off. Turn on POTA spots or Cluster spots in Settings › Optional features.');
  });

  it('names the filters that hide everything', () => {
    expect(emptyText(view(), defaultFilter(), ctx)).toBe('No FT8 or FT4 spots.');
    expect(emptyText(view(), { ...defaultFilter(), digitalOnly: false }, ctx)).toBe('No spots.');
    const full = { myBands: ['20m'], isNew: () => true };
    expect(emptyText(view(), { ...defaultFilter(), myBandsOnly: true, newOnly: true }, full)).toBe('No new FT8 or FT4 spots on your bands.');
    expect(emptyText(view(), { ...defaultFilter(), myBandsOnly: true, newOnly: true }, ctx)).toBe('No FT8 or FT4 spots.');
  });

  it('names the classes when some are hidden', () => {
    expect(emptyText(view(BOTH), defaultFilter(), ctx)).toBe('No FT8 or FT4 activation spots.');
    expect(emptyText(view(BOTH), { ...defaultFilter(), classes: SPOT_CLASSES }, ctx)).toBe('No FT8 or FT4 spots.');
    expect(emptyText(view(BOTH), { ...defaultFilter(), classes: ['SOTA'] }, ctx)).toBe('No FT8 or FT4 SOTA spots.');
    expect(emptyText(view(BOTH), { ...defaultFilter(), classes: ['SOTA', 'DX'] }, ctx)).toBe('No FT8 or FT4 SOTA or DX spots.');
    expect(emptyText(view(BOTH), { ...defaultFilter(), classes: [] }, ctx)).toBe('Choose POTA, SOTA, WWFF, IOTA or DX to see spots.');
    expect(emptyText(view(), { ...defaultFilter(), classes: ['SOTA'] }, ctx)).toBe('Choose POTA to see spots.');
  });

  it('says what happens before the first list', () => {
    expect(emptyText(view({ updatedAt: null, loading: true }), defaultFilter(), ctx)).toBe('Fetching spots.');
    expect(emptyText(view({ updatedAt: null, online: false }), defaultFilter(), ctx)).toBe('Spots appear here when the phone is back online.');
    const failing: FailingSource = { source: 'hamqth', name: 'HamQTH', kind: 'network', status: null, afterMs: null, retryAt: at(13, 25) };
    expect(emptyText(view({ updatedAt: null, failing: [failing] }), defaultFilter(), ctx)).toBe('Spots appear here when HamQTH answers.');
  });
});

describe('statusText', () => {
  const failing = (kind: FailingSource['kind'], extra: Partial<FailingSource> = {}): FailingSource => ({
    source: 'pota',
    name: 'POTA',
    kind,
    status: null,
    afterMs: null,
    retryAt: at(13, 25),
    ...extra,
  });

  it('says how often the list refreshes and when it last did', () => {
    expect(statusText(view())).toBe('Spots refresh every minute while online. Last update 13:21 UTC.');
    expect(statusText(view({ updatedAt: null }))).toBe('Spots refresh every minute while online.');
  });

  it('says nothing while spots are off', () => {
    expect(statusText(view({ sources: [], classes: [] }))).toBe('');
  });

  it('says when the list is offline and how old it is', () => {
    expect(statusText(view({ online: false }))).toBe('Offline. The list is from 13:21 UTC and refreshes when the phone is back online.');
    expect(statusText(view({ online: false, updatedAt: null }))).toBe('');
  });

  it('explains each failure and gives the next try', () => {
    expect(statusText(view({ failing: [failing('network')] }))).toBe('POTA is unreachable. Showing spots from 13:21 UTC. Next try at 13:25 UTC.');
    expect(statusText(view({ failing: [failing('timeout', { afterMs: 15_000 })] }))).toBe('POTA did not answer within 15 s. Showing spots from 13:21 UTC. Next try at 13:25 UTC.');
    expect(statusText(view({ failing: [failing('http', { status: 503 })] }))).toBe('POTA answered with error 503. Showing spots from 13:21 UTC. Next try at 13:25 UTC.');
    expect(statusText(view({ failing: [failing('http')] }))).toBe('POTA answered with an error. Showing spots from 13:21 UTC. Next try at 13:25 UTC.');
    expect(statusText(view({ failing: [failing('format')], updatedAt: null }))).toBe('POTA sent spots RR73 cannot read. Next try at 13:25 UTC.');
    expect(statusText(view({ failing: [failing('network', { retryAt: null })] }))).toBe('POTA is unreachable. Showing spots from 13:21 UTC.');
  });

  it('lists two failing sources and the earlier retry', () => {
    const two = [failing('network'), failing('http', { source: 'hamqth', name: 'HamQTH', status: 500, retryAt: at(13, 23) })];
    expect(statusText(view({ failing: two }))).toBe('POTA is unreachable. HamQTH answered with error 500. Showing spots from 13:21 UTC. Next try at 13:23 UTC.');
  });
});
