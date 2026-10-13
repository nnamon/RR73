/**
 * Reference data for the screens: callsign to DXCC entity, LoTW users, POTA parks and SOTA
 * summits, and Maidenhead grid arithmetic.
 *
 * Nothing loads at app start. The country file is core: small (341 kB, 111 kB gzipped, October
 * 2026) and precached with the app. The LoTW list (1.7 MB, 0.96 MB gzipped) and the park and
 * summit lists are optional: their loaders take the feature switch as a boolean and return null
 * without touching the network when it is off. The app passes the "LoTW users" switch to lotw()
 * and the "Activations" switch to parks() and summits().
 *
 *     import { reference } from '../lib/reference';
 *     const countries = await reference.countries();
 *     countries.lookup('VK3/9V1NE');                    // Australia, CQ 30, ITU 59
 *     const lotw = await reference.lotw(settings.lotwUsers);
 *     lotw?.lookup('9V1NE')?.lastUpload;                // "2026-10-11"
 *     const parks = reference.parks(settings.activations);
 *     await parks?.nearest({ lat: 1.35, lon: 103.82 });  // nearest active parks, km and bearing
 */

import { DxccIndex } from './dxcc';
import { readManifest, type ManifestJson, type SourceId } from './format';
import { LotwIndex } from './lotw';
import { parkList, summitList, type Park, type ReferenceList, type Summit } from './refs';
import { HttpStore, ReferenceUnavailableError, type DataStore } from './store';

export { DxccIndex, type DxccMatch, type DxccMiss, type DxccResult } from './dxcc';
export { LotwIndex, daysSince, type LotwUser } from './lotw';
export {
  ReferenceList,
  splitReference,
  type NearestOptions,
  type NearestResult,
  type Nearby,
  type OfflineStatus,
  type Park,
  type Reference,
  type Summit,
} from './refs';
export { bearingDeg, distanceKm, gridBounds, gridCentre, gridFromLatLon, gridPath, isGrid, normaliseGrid, type GridBounds, type LatLon } from './grid';
export { normaliseCallsign, parsePortable, type PortableCall } from './callsign';
export { HttpStore, ReferenceUnavailableError, type DataStore, type ReferenceProblem } from './store';
export { ReferenceFormatError, type Continent, type ManifestJson, type ManifestSource, type SourceId, type SourceStatus } from './format';

export interface ReferenceData {
  /** What this build holds: sources, dates, counts, sizes and terms. Null when the build has no reference data. */
  manifest(): Promise<ManifestJson | null>;
  /** The country file. Rejects with ReferenceUnavailableError when the build has none or it cannot be read. */
  countries(): Promise<DxccIndex>;
  /** The country file when it has loaded, for synchronous use in lists; else null. */
  loadedCountries(): DxccIndex | null;
  /** The LoTW list when the "LoTW users" feature is on, else null without a request. */
  lotw(enabled: boolean): Promise<LotwIndex | null>;
  /** The LoTW list when it has loaded and the feature is on; else null. */
  loadedLotw(enabled: boolean): LotwIndex | null;
  /** POTA parks when Activations is on, else null. Loads shard by shard as it is used. */
  parks(enabled: boolean): ReferenceList<Park> | null;
  /** SOTA summits when Activations is on, else null. Loads shard by shard as it is used. */
  summits(enabled: boolean): ReferenceList<Summit> | null;
  /** Loads the country file, and the LoTW list when its feature is on, once the page is idle. */
  warm(features: { lotwUsers: boolean }): void;
  /** Removes an optional source's copies from the phone, for when its feature is turned off. */
  forget(source: Exclude<SourceId, 'cty'>): Promise<void>;
}

/** Memoises a load; a failed load is forgotten so the next call retries. */
function once<T>(load: () => Promise<T>): { get: () => Promise<T>; value: () => T | null; reset: () => void } {
  let p: Promise<T> | null = null;
  let v: T | null = null;
  return {
    get() {
      p ??= load().then(
        (x) => (v = x),
        (e: unknown) => {
          p = null;
          throw e;
        },
      );
      return p;
    },
    value: () => v,
    reset() {
      p = null;
      v = null;
    },
  };
}

export function createReferenceData(store: DataStore, opts: { now?: () => Date } = {}): ReferenceData {
  const manifest = once(async () => {
    try {
      return readManifest(await store.json('manifest.json'));
    } catch (e) {
      if (e instanceof ReferenceUnavailableError && e.problem === 'missing') return null;
      throw e;
    }
  });
  const entry = async (id: SourceId) => (await manifest.get())?.sources[id]?.entry ?? null;
  const countries = once(async () => DxccIndex.fromJson(await store.json('cty.json')));
  const lotw = once(async () => {
    const file = await entry('lotw');
    if (!file) throw new ReferenceUnavailableError('lotw.json', 'missing', 'this build has no LoTW list');
    return LotwIndex.fromJson((await store.kept('lotw.json', file)).data);
  });
  let parks: ReferenceList<Park> | null = null;
  let summits: ReferenceList<Summit> | null = null;

  return {
    manifest: () => manifest.get(),
    countries: () => countries.get(),
    loadedCountries: () => countries.value(),
    lotw: async (enabled) => (enabled ? lotw.get() : null),
    loadedLotw: (enabled) => (enabled ? lotw.value() : null),
    parks(enabled) {
      if (!enabled) return null;
      parks ??= parkList(store, () => entry('pota'));
      return parks;
    },
    summits(enabled) {
      if (!enabled) return null;
      summits ??= summitList(store, () => entry('sota'), opts.now);
      return summits;
    },
    warm(features) {
      const run = () => {
        void countries.get().catch(() => undefined);
        if (features.lotwUsers) void lotw.get().catch(() => undefined);
      };
      // A timer stands in where requestIdleCallback is missing.
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 });
      else setTimeout(run, 2000);
    },
    async forget(source) {
      if (source === 'lotw') {
        lotw.reset();
        await store.drop('lotw.json');
      } else if (source === 'pota') {
        await (parks ?? parkList(store, () => entry('pota'))).forget();
        parks = null;
      } else {
        await (summits ?? summitList(store, () => entry('sota'))).forget();
        summits = null;
      }
    },
  };
}

/** The app's reference data, read from data/ under the app's base path. */
export const reference: ReferenceData = createReferenceData(new HttpStore(`${import.meta.env.BASE_URL}data/`));
