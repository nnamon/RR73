// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { features, setFeature, spotsShown, watchFeatures } from './features.svelte';
import { FEATURES_OFF, resetSettings } from './settings.svelte';
import { getKv } from './db';

beforeEach(() => resetSettings());

describe('optional features', () => {
  it('are all off by default', () => {
    expect({ ...features }).toEqual({ activations: false, potaSpots: false, clusterSpots: false, lotw: false });
  });

  it('change and are stored', async () => {
    await setFeature('clusterSpots', true);
    expect(features.clusterSpots).toBe(true);
    expect(await getKv('settings')).toMatchObject({ features: { ...FEATURES_OFF, clusterSpots: true } });
    await setFeature('clusterSpots', false);
    expect(features.clusterSpots).toBe(false);
  });

  it('show the Spots tab while activations or a spot source is on, and not for LoTW users alone', () => {
    expect(spotsShown(FEATURES_OFF)).toBe(false);
    expect(spotsShown({ ...FEATURES_OFF, lotw: true })).toBe(false);
    expect(spotsShown({ ...FEATURES_OFF, activations: true })).toBe(true);
    expect(spotsShown({ ...FEATURES_OFF, potaSpots: true })).toBe(true);
    expect(spotsShown({ ...FEATURES_OFF, clusterSpots: true })).toBe(true);
  });

  it('tell a watcher now and after each change, until it stops', async () => {
    const seen: boolean[] = [];
    const stop = watchFeatures((f) => seen.push(f.lotw));
    flushSync();
    await setFeature('lotw', true);
    flushSync();
    await setFeature('activations', true);
    flushSync();
    stop();
    await setFeature('lotw', false);
    flushSync();
    expect(seen).toEqual([false, true, true]);
  });
});
