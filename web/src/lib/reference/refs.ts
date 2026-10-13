/**
 * POTA parks and SOTA summits: lookup by reference and nearest references to a position.
 *
 * Each programme's list is split into shards by its key (POTA prefix US, VK; SOTA association
 * W7O, G), so a lookup downloads one shard: the median POTA shard is under 1 kB gzipped, the
 * largest (FR) about 390 kB. The index lists the Maidenhead squares (2° by 1°) holding each
 * shard's references; a nearest search reads shards in order of their nearest square and stops
 * when no unread shard can hold anything closer.
 *
 * Nothing loads until a method is called, and the app calls none unless Activations is on. Shards
 * stay on the phone once read (store.ts), so an operator who looks up the area before leaving, or
 * calls keepNear() or keepAll(), has it offline.
 */

import { distanceKm, bearingDeg, distanceToBoundsKm, gridBounds, gridFromLatLon, type LatLon } from './grid';
import { readPotaShard, readRefIndex, readSotaShard, type Programme, type RefIndexJson, type RefShardInfo } from './format';
import { ReferenceUnavailableError, type DataStore } from './store';

interface ReferenceBase {
  programme: Programme;
  /** The reference as written: "US-0001", "W7O/CN-001". */
  ref: string;
  name: string;
  /** Degrees, north and east positive; null when the list gives no position. */
  lat: number | null;
  lon: number | null;
  /** 6-character locator of the position, null without one. */
  grid: string | null;
  /** True when the reference counts for activations today. */
  active: boolean;
}

export interface Park extends ReferenceBase {
  programme: 'POTA';
}

export interface Summit extends ReferenceBase {
  programme: 'SOTA';
  /** Association name: "USA - Oregon". */
  association: string;
  /** Region name: "Cascades North"; "" when the list has none. */
  region: string;
  /** Height, m. */
  altM: number;
  /** Activation points. */
  points: number;
  /** First day the summit counts, YYYY-MM-DD. */
  validFrom: string;
  /** Last day the summit counts, YYYY-MM-DD; null when open-ended. Retired summits have one in the past. */
  validTo: string | null;
}

export type Reference = Park | Summit;

export interface Nearby<T extends Reference> {
  ref: T;
  /** Great-circle distance, km. */
  km: number;
  /** Initial bearing from the position, degrees from true north. */
  bearingDeg: number;
}

export interface NearestResult<T extends Reference> {
  /** Nearest first. */
  refs: Nearby<T>[];
  /** False when a shard that could hold a nearer reference was neither on the phone nor reachable. */
  complete: boolean;
}

export interface NearestOptions {
  /** Most references to return. Default 10. */
  limit?: number;
  /** Farthest distance, km. Default no limit. */
  maxKm?: number;
  /** Include references that do not count today (inactive parks, retired summits). Default false. */
  includeInactive?: boolean;
}

export interface OfflineStatus {
  /** Shards on the phone, of all shards. */
  shardsKept: number;
  shardsTotal: number;
  /** Shards on the phone that match this build; the others are older copies. */
  shardsCurrent: number;
  /** References in the shards on the phone, of all references. */
  refsKept: number;
  refsTotal: number;
  /** Size of the shards on the phone and of all shards, bytes. */
  bytesKept: number;
  bytesTotal: number;
}

/** The parts of a reference: key (shard) and id inside it. Null when the text is not this programme's form. */
export function splitReference(programme: Programme, text: string): { ref: string; key: string; id: string } | null {
  const ref = text.trim().toUpperCase().replace(/\s+/g, '');
  const m = programme === 'POTA' ? /^([A-Z0-9]{1,4})-(\d{4,5})$/.exec(ref) : /^([A-Z0-9]{1,6})\/([A-Z0-9]{2}-\d{3})$/.exec(ref);
  return m ? { ref, key: m[1], id: m[2] } : null;
}

/** YYYYMMDD number to YYYY-MM-DD. */
const isoDate = (n: number) => `${String(Math.floor(n / 10000)).padStart(4, '0')}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;

/** Today, UTC, as a YYYYMMDD number. */
export function dayNumber(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

const gridOf = (lat: number | null, lon: number | null) => (lat === null || lon === null ? null : gridFromLatLon(lat, lon, 6));

type Decoder<T extends Reference> = (json: unknown, info: RefShardInfo, index: RefIndexJson) => T[];

const decodePota: Decoder<Park> = (json, info, index) =>
  readPotaShard(json, info.key).rows.map(([id, name, lat, lon, active]) => ({
    programme: 'POTA',
    ref: info.key + index.separator + id,
    name,
    lat,
    lon,
    grid: gridOf(lat, lon),
    active: active === 1,
  }));

function sotaDecoder(now: () => Date): Decoder<Summit> {
  return (json, info, index) => {
    const shard = readSotaShard(json, info.key);
    const today = dayNumber(now());
    return shard.rows.map(([id, name, lat, lon, altM, points, from, to]) => ({
      programme: 'SOTA',
      ref: info.key + index.separator + id,
      name,
      lat,
      lon,
      grid: gridOf(lat, lon),
      active: from <= today && (to === 0 || today <= to),
      association: shard.association,
      region: shard.regions[id.split('-')[0]] ?? '',
      altM,
      points,
      validFrom: isoDate(from),
      validTo: to === 0 ? null : isoDate(to),
    }));
  };
}

/** One programme's references, loaded shard by shard. */
export class ReferenceList<T extends Reference> {
  readonly programme: Programme;
  private readonly store: DataStore;
  private readonly decode: Decoder<T>;
  private readonly entry: () => Promise<string | null>;
  private readonly dir: string;
  private index: Promise<RefIndexJson> | null = null;
  private readonly shards = new Map<string, Promise<Map<string, T>>>();

  /** entry gives the index file under data/ from the manifest, or null when the build has none. */
  constructor(programme: Programme, store: DataStore, decode: Decoder<T>, entry: () => Promise<string | null>) {
    this.programme = programme;
    this.store = store;
    this.decode = decode;
    this.entry = entry;
    this.dir = programme.toLowerCase();
  }

  private indexSlot(): string {
    return `${this.dir}/index.json`;
  }

  private shardSlot(key: string): string {
    return `${this.dir}/${key}.json`;
  }

  private loadIndex(): Promise<RefIndexJson> {
    this.index ??= (async () => {
      const entry = await this.entry();
      if (!entry) throw new ReferenceUnavailableError(this.indexSlot(), 'missing', `this build has no ${this.programme} list`);
      const kept = await this.store.kept(this.indexSlot(), entry);
      const index = readRefIndex(kept.data, this.programme);
      if (!kept.stale) {
        // Shards whose key left the list take space until dropped.
        const slots = new Set([this.indexSlot(), ...index.shards.map((s) => this.shardSlot(s.key))]);
        void this.store.drop(`${this.dir}/`, (slot) => slots.has(slot)).catch(() => undefined);
      }
      return index;
    })();
    this.index.catch(() => (this.index = null));
    return this.index;
  }

  private loadShard(info: RefShardInfo, index: RefIndexJson): Promise<Map<string, T>> {
    let p = this.shards.get(info.key);
    if (!p) {
      p = this.store
        .kept(this.shardSlot(info.key), `${this.dir}/${info.file}`)
        .then((kept) => new Map(this.decode(kept.data, info, index).map((r) => [r.ref, r] as const)));
      p.catch(() => this.shards.delete(info.key));
      this.shards.set(info.key, p);
    }
    return p;
  }

  /** True when this build has the programme's list. */
  async available(): Promise<boolean> {
    try {
      await this.loadIndex();
      return true;
    } catch (e) {
      if (e instanceof ReferenceUnavailableError) return false;
      throw e;
    }
  }

  /** References in the list, all shards together. */
  async count(): Promise<number> {
    return (await this.loadIndex()).count;
  }

  /**
   * The reference with this id, or null when the list has none. Throws ReferenceUnavailableError
   * when its shard is neither on the phone nor reachable.
   */
  async get(text: string): Promise<T | null> {
    const parts = splitReference(this.programme, text);
    if (!parts) return null;
    const index = await this.loadIndex();
    const info = index.shards.find((s) => s.key === parts.key);
    if (!info) return null;
    return (await this.loadShard(info, index)).get(parts.ref) ?? null;
  }

  /** The references nearest a position, such as the phone's GPS fix. */
  async nearest(at: LatLon, opts: NearestOptions = {}): Promise<NearestResult<T>> {
    const limit = opts.limit ?? 10;
    const maxKm = opts.maxKm ?? Infinity;
    const index = await this.loadIndex();
    const order = index.shards
      .map((info) => ({ info, km: shardDistanceKm(at, info) }))
      .filter((s) => s.km <= maxKm)
      .sort((a, b) => a.km - b.km);
    const best: Nearby<T>[] = [];
    let complete = true;
    for (const { info, km } of order) {
      if (best.length >= limit && km > best[best.length - 1].km) break;
      let refs: Map<string, T>;
      try {
        refs = await this.loadShard(info, index);
      } catch (e) {
        if (!(e instanceof ReferenceUnavailableError)) throw e;
        complete = false;
        continue;
      }
      for (const ref of refs.values()) {
        if ((!opts.includeInactive && !ref.active) || ref.lat === null || ref.lon === null) continue;
        const d = distanceKm(at, { lat: ref.lat, lon: ref.lon });
        if (d > maxKm || (best.length >= limit && d >= best[best.length - 1].km)) continue;
        let i = best.length;
        while (i > 0 && best[i - 1].km > d) i--;
        best.splice(i, 0, { ref, km: d, bearingDeg: 0 });
        if (best.length > limit) best.pop();
      }
    }
    for (const n of best) n.bearingDeg = bearingDeg(at, { lat: n.ref.lat ?? 0, lon: n.ref.lon ?? 0 });
    return { refs: best, complete };
  }

  /** How much of the list is on the phone. */
  async offline(): Promise<OfflineStatus> {
    const index = await this.loadIndex();
    const kept = await this.store.keptFiles(`${this.dir}/`);
    const status: OfflineStatus = { shardsKept: 0, shardsTotal: index.shards.length, shardsCurrent: 0, refsKept: 0, refsTotal: index.count, bytesKept: 0, bytesTotal: 0 };
    for (const s of index.shards) {
      status.bytesTotal += s.bytes;
      const file = kept.get(this.shardSlot(s.key));
      if (!file) continue;
      status.shardsKept++;
      if (file === `${this.dir}/${s.file}`) status.shardsCurrent++;
      status.refsKept += s.count;
      status.bytesKept += s.bytes;
    }
    return status;
  }

  /** Removes the list from the phone, for when Activations is turned off. */
  async forget(): Promise<void> {
    this.index = null;
    this.shards.clear();
    await this.store.drop(`${this.dir}/`);
  }

  /** Keeps on the phone every shard that may hold a reference within km of a position. */
  async keepNear(at: LatLon, km: number): Promise<OfflineStatus> {
    const index = await this.loadIndex();
    await Promise.all(index.shards.filter((s) => shardDistanceKm(at, s) <= km).map((s) => this.loadShard(s, index)));
    return this.offline();
  }

  /** Keeps the whole list on the phone, one shard at a time. onProgress gets shards done and the total. */
  async keepAll(onProgress?: (done: number, total: number) => void): Promise<OfflineStatus> {
    const index = await this.loadIndex();
    let done = 0;
    for (const s of index.shards) {
      await this.loadShard(s, index);
      onProgress?.(++done, index.shards.length);
    }
    return this.offline();
  }
}

/** Shortest distance from a position to any square holding a shard's references, km. */
function shardDistanceKm(at: LatLon, info: RefShardInfo): number {
  let best = Infinity;
  for (let i = 0; i < info.squares.length; i += 4) {
    const b = gridBounds(info.squares.slice(i, i + 4));
    if (b) best = Math.min(best, distanceToBoundsKm(at, b));
  }
  return best;
}

export function parkList(store: DataStore, entry: () => Promise<string | null>): ReferenceList<Park> {
  return new ReferenceList('POTA', store, decodePota, entry);
}

export function summitList(store: DataStore, entry: () => Promise<string | null>, now: () => Date = () => new Date()): ReferenceList<Summit> {
  return new ReferenceList('SOTA', store, sotaDecoder(now), entry);
}
