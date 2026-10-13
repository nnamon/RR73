/**
 * Optional features: activations, POTA spots, cluster spots and LoTW users, each off until the
 * operator turns it on in Settings › Optional features. Code that downloads or polls for a
 * feature checks it first and does nothing while it is off:
 *
 *   import { features, watchFeatures } from '../state/features.svelte';
 *   if (features.lotw) void lotw.get();
 *   const stop = watchFeatures((f) => spotFeed.enable({ pota: f.potaSpots, hamqth: f.clusterSpots }));
 *
 * Every read is reactive in components and effects. The values come from the stored settings,
 * which load before the first screen; until then every feature reads off.
 */

import { untrack } from 'svelte';
import { settings, updateSettings, type FeatureId, type Features } from './settings.svelte';

export { FEATURE_IDS, FEATURES_OFF, type FeatureId, type Features } from './settings.svelte';

/** The current switches. Read-only: change them with setFeature. */
export const features: Readonly<Features> = {
  get activations() {
    return settings.features.activations;
  },
  get potaSpots() {
    return settings.features.potaSpots;
  },
  get clusterSpots() {
    return settings.features.clusterSpots;
  },
  get lotw() {
    return settings.features.lotw;
  },
};

/** Turns a feature on or off and stores the choice. Data a feature kept stays on the phone. */
export function setFeature(id: FeatureId, on: boolean): Promise<void> {
  return updateSettings({ features: { ...settings.features, [id]: on } });
}

/** The Spots tab shows while activations or either spot source is on. */
export function spotsShown(f: Readonly<Features> = features): boolean {
  return f.activations || f.potaSpots || f.clusterSpots;
}

/**
 * Calls `fn` with the switches now and after every change, outside components (a spot feed, a
 * reference-data loader). Returns the function that stops it.
 */
export function watchFeatures(fn: (f: Readonly<Features>) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const now: Features = { ...settings.features };
      untrack(() => fn(now));
    });
  });
}
