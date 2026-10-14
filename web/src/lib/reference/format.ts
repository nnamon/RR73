/**
 * The reference data files under `data/`, written by `tools/refdata/build.mjs` and read here.
 * Readers check the shape of what arrives over the network and throw ReferenceFormatError on
 * anything else, so a damaged or outdated file fails once, at load, with a clear cause.
 *
 * Positions are degrees, north and east positive. Dates are UTC.
 *
 * This module has no runtime imports: the build script loads it directly in Node.
 */

/** Version of the file layout. Readers refuse other versions. */
export const DATA_FORMAT = 1;

export type Continent = 'AF' | 'AN' | 'AS' | 'EU' | 'NA' | 'OC' | 'SA';
export const CONTINENTS: readonly Continent[] = ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'];

export class ReferenceFormatError extends Error {
  override name = 'ReferenceFormatError';
}

// ---------------------------------------------------------------------------------------------
// cty.json: the country file

/** One entity of the country file. */
export interface CtyEntityJson {
  /** Entity name as the country file writes it: "Sov Mil Order of Malta". */
  name: string;
  /** Primary prefix without the WAE star: "KH6", "IT9", "3D2/r". Lower-case letters mark labels that are not prefixes. */
  prefix: string;
  /** True for entities on the DARC WAEDC list only (a `*` in cty.dat): Sicily, Shetland, European Turkey. */
  wae: boolean;
  /** ADIF DXCC entity code; WAE entities carry the code of the DXCC entity they belong to. Null when unknown. */
  dxcc: number | null;
  cq: number;
  itu: number;
  cont: Continent;
  lat: number;
  lon: number;
  /** Local time, hours east of UTC. */
  utc: number;
  /** The alias list in cty.dat syntax, separated by single spaces: "KH6 =AA2TT NH7(31)[61]". */
  aliases: string;
}

export interface CtyJson {
  format: typeof DATA_FORMAT;
  /** Release date of the country file, YYYY-MM-DD, or null when it could not be read. */
  version: string | null;
  /** Where the file came from. */
  source: string;
  /** The country file's copyright and permission notice, which must travel with the data. */
  notice: string;
  entities: CtyEntityJson[];
}

// ---------------------------------------------------------------------------------------------
// lotw.json: LoTW users and their last upload

export interface LotwJson {
  format: typeof DATA_FORMAT;
  /** Newest upload date in the list, YYYY-MM-DD. */
  latest: string;
  /** Callsigns in the list. */
  count: number;
  /** Callsigns grouped by the date of their last upload: { "2026-10-12": "K1ABC 9V1NE" }. */
  byDate: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// pota/ and sota/: references split into shards

export type Programme = 'POTA' | 'SOTA';

/** One shard of a programme: the references sharing one key (a POTA prefix or a SOTA association). */
export interface RefShardInfo {
  /** "US" for POTA US-0001; "W7O" for SOTA W7O/CN-001. */
  key: string;
  /** File name in the programme's directory, with a content hash: "US.3f9c0a12b4.json". */
  file: string;
  /** References in the shard. */
  count: number;
  /** Size of the shard file, bytes. */
  bytes: number;
  /** Maidenhead squares (4 characters each, concatenated: "FN31FN42") holding the shard's references, for nearest searches. */
  squares: string;
  /** Display name of the key when the source has one: "USA - Oregon" for W7O. */
  name?: string;
}

export interface RefIndexJson {
  format: typeof DATA_FORMAT;
  programme: Programme;
  /** Joins key and id into a reference: "-" for POTA (US-0001), "/" for SOTA (W7O/CN-001). */
  separator: '-' | '/';
  /** References in all shards. */
  count: number;
  shards: RefShardInfo[];
}

/** A park: [id after the key, name, lat, lon, 1 when active]. Coordinates are null when the list has none. */
export type PotaRow = [id: string, name: string, lat: number | null, lon: number | null, active: 0 | 1];

export interface PotaShardJson {
  format: typeof DATA_FORMAT;
  programme: 'POTA';
  key: string;
  rows: PotaRow[];
}

/**
 * A summit: [id after the association, name, lat, lon, altitude m, points, valid from, valid to].
 * Dates are YYYYMMDD numbers; valid to is 0 when the summit has no end date.
 */
export type SotaRow = [id: string, name: string, lat: number | null, lon: number | null, altM: number, points: number, validFrom: number, validTo: number];

export interface SotaShardJson {
  format: typeof DATA_FORMAT;
  programme: 'SOTA';
  key: string;
  /** Association name: "USA - Oregon". */
  association: string;
  /** Region names by region code: { "CN": "Cascades North" }. */
  regions: Record<string, string>;
  rows: SotaRow[];
}

// ---------------------------------------------------------------------------------------------
// manifest.json: what the build fetched

export type SourceId = 'cty' | 'lotw' | 'pota' | 'sota';

/**
 * ok: the data was fetched or confirmed current on the build date. stale: the last attempt
 * failed and an older copy is shipped. missing: no copy, the app works without this source.
 */
export type SourceStatus = 'ok' | 'stale' | 'missing';

export interface ManifestSource {
  title: string;
  status: SourceStatus;
  /** The file downloaded. */
  url: string;
  /** Who publishes the data. */
  publisher: string;
  /** Licence or terms as published, or a statement that none were found. */
  terms: string;
  /** When the shipped copy was downloaded, ISO 8601 UTC; null when there is none. */
  fetchedAt: string | null;
  /** When the source last confirmed the copy is current, ISO 8601 UTC. */
  checkedAt: string | null;
  /** Date the publisher gives for the data, YYYY-MM-DD, when it gives one. */
  dataDate: string | null;
  /** Size of the download, bytes. */
  rawBytes: number | null;
  /** Records kept: entities, callsigns, parks or summits. */
  records: number | null;
  /**
   * The file to read first, under data/: "cty.json", "lotw.<hash>.json", "pota/index.<hash>.json".
   * Null when the build has no copy.
   */
  entry: string | null;
  /** Files written for this source. */
  files: number;
  /** Their total size, bytes, and after gzip -9 (close to what GitHub Pages sends). */
  bytes: number;
  gzipBytes: number;
  /** Plain-words reason when the status is stale or missing. */
  note?: string;
}

export interface ManifestJson {
  format: typeof DATA_FORMAT;
  generatedAt: string;
  sources: Partial<Record<SourceId, ManifestSource>>;
}

// ---------------------------------------------------------------------------------------------
// Readers

type Obj = Record<string, unknown>;

function fail(what: string, detail: string): never {
  throw new ReferenceFormatError(`${what}: ${detail}`);
}

function obj(x: unknown, what: string): Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) fail(what, 'not an object');
  return x as Obj;
}

function str(o: Obj, k: string, what: string): string {
  const v = o[k];
  if (typeof v !== 'string') fail(what, `${k} is not text`);
  return v;
}

function num(o: Obj, k: string, what: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(what, `${k} is not a number`);
  return v;
}

function strOrNull(o: Obj, k: string, what: string): string | null {
  return o[k] === null ? null : str(o, k, what);
}

function numOrNull(o: Obj, k: string, what: string): number | null {
  return o[k] === null ? null : num(o, k, what);
}

function header(x: unknown, what: string): Obj {
  const o = obj(x, what);
  if (o.format !== DATA_FORMAT) fail(what, `format ${String(o.format)} is not ${DATA_FORMAT}`);
  return o;
}

function isCoord(v: unknown, limit: number): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit);
}

export function readCtyJson(x: unknown): CtyJson {
  const what = 'cty.json';
  const o = header(x, what);
  if (!Array.isArray(o.entities)) fail(what, 'entities is not a list');
  const entities = o.entities.map((e: unknown, i: number): CtyEntityJson => {
    const w = `${what} entity ${i}`;
    const r = obj(e, w);
    const cont = str(r, 'cont', w);
    if (!(CONTINENTS as readonly string[]).includes(cont)) fail(w, `continent ${cont} is unknown`);
    if (typeof r.wae !== 'boolean') fail(w, 'wae is not true or false');
    return {
      name: str(r, 'name', w),
      prefix: str(r, 'prefix', w),
      wae: r.wae,
      dxcc: numOrNull(r, 'dxcc', w),
      cq: num(r, 'cq', w),
      itu: num(r, 'itu', w),
      cont: cont as Continent,
      lat: num(r, 'lat', w),
      lon: num(r, 'lon', w),
      utc: num(r, 'utc', w),
      aliases: str(r, 'aliases', w),
    };
  });
  return { format: DATA_FORMAT, version: strOrNull(o, 'version', what), source: str(o, 'source', what), notice: str(o, 'notice', what), entities };
}

export function readLotwJson(x: unknown): LotwJson {
  const what = 'lotw.json';
  const o = header(x, what);
  const byDate = obj(o.byDate, `${what} byDate`);
  for (const [k, v] of Object.entries(byDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof v !== 'string') fail(what, `entry ${k} is not a date and callsigns`);
  }
  return { format: DATA_FORMAT, latest: str(o, 'latest', what), count: num(o, 'count', what), byDate: byDate as Record<string, string> };
}

export function readRefIndex(x: unknown, programme: Programme): RefIndexJson {
  const what = `${programme.toLowerCase()}/index.json`;
  const o = header(x, what);
  if (o.programme !== programme) fail(what, `programme ${String(o.programme)} is not ${programme}`);
  const separator = o.separator;
  if (separator !== '-' && separator !== '/') fail(what, 'separator is not - or /');
  if (!Array.isArray(o.shards)) fail(what, 'shards is not a list');
  const shards = o.shards.map((s: unknown, i: number): RefShardInfo => {
    const w = `${what} shard ${i}`;
    const r = obj(s, w);
    const squares = str(r, 'squares', w);
    if (!/^(?:[A-R]{2}\d{2})*$/.test(squares)) fail(w, 'squares are not Maidenhead squares');
    const file = str(r, 'file', w);
    if (!/^[A-Za-z0-9._-]+\.json$/.test(file)) fail(w, `file ${file} is not a plain JSON file name`);
    const info: RefShardInfo = { key: str(r, 'key', w), file, count: num(r, 'count', w), bytes: num(r, 'bytes', w), squares };
    if (r.name !== undefined) info.name = str(r, 'name', w);
    return info;
  });
  return { format: DATA_FORMAT, programme, separator, count: num(o, 'count', what), shards };
}

export function readPotaShard(x: unknown, key: string): PotaShardJson {
  const what = `POTA shard ${key}`;
  const o = header(x, what);
  if (o.programme !== 'POTA' || o.key !== key) fail(what, 'programme or key does not match the index');
  if (!Array.isArray(o.rows)) fail(what, 'rows is not a list');
  for (const r of o.rows as unknown[]) {
    const ok =
      Array.isArray(r) && r.length === 5 && typeof r[0] === 'string' && typeof r[1] === 'string' && isCoord(r[2], 90) && isCoord(r[3], 180) && (r[4] === 0 || r[4] === 1);
    if (!ok) fail(what, `row ${JSON.stringify(r)} is not [id, name, lat, lon, active]`);
  }
  return { format: DATA_FORMAT, programme: 'POTA', key, rows: o.rows as PotaRow[] };
}

export function readSotaShard(x: unknown, key: string): SotaShardJson {
  const what = `SOTA shard ${key}`;
  const o = header(x, what);
  if (o.programme !== 'SOTA' || o.key !== key) fail(what, 'programme or key does not match the index');
  if (!Array.isArray(o.rows)) fail(what, 'rows is not a list');
  const regions = obj(o.regions, `${what} regions`);
  for (const v of Object.values(regions)) if (typeof v !== 'string') fail(what, 'a region name is not text');
  for (const r of o.rows as unknown[]) {
    const ok =
      Array.isArray(r) &&
      r.length === 8 &&
      typeof r[0] === 'string' &&
      typeof r[1] === 'string' &&
      isCoord(r[2], 90) &&
      isCoord(r[3], 180) &&
      [r[4], r[5], r[6], r[7]].every((v) => typeof v === 'number' && Number.isInteger(v));
    if (!ok) fail(what, `row ${JSON.stringify(r)} is not [id, name, lat, lon, altM, points, validFrom, validTo]`);
  }
  return {
    format: DATA_FORMAT,
    programme: 'SOTA',
    key,
    association: str(o, 'association', what),
    regions: regions as Record<string, string>,
    rows: o.rows as SotaRow[],
  };
}

export function readManifest(x: unknown): ManifestJson {
  const what = 'manifest.json';
  const o = header(x, what);
  const sources = obj(o.sources, `${what} sources`);
  const out: ManifestJson['sources'] = {};
  for (const id of ['cty', 'lotw', 'pota', 'sota'] as const) {
    if (sources[id] === undefined) continue;
    const w = `${what} ${id}`;
    const s = obj(sources[id], w);
    const status = s.status;
    if (status !== 'ok' && status !== 'stale' && status !== 'missing') fail(w, `status ${String(status)} is unknown`);
    const entry = strOrNull(s, 'entry', w);
    if (entry !== null && !/^(?:[a-z]+\/)?[A-Za-z0-9._-]+\.json$/.test(entry)) fail(w, `entry ${entry} is not a data file path`);
    const src: ManifestSource = {
      title: str(s, 'title', w),
      status,
      url: str(s, 'url', w),
      publisher: str(s, 'publisher', w),
      terms: str(s, 'terms', w),
      fetchedAt: strOrNull(s, 'fetchedAt', w),
      checkedAt: strOrNull(s, 'checkedAt', w),
      dataDate: strOrNull(s, 'dataDate', w),
      rawBytes: numOrNull(s, 'rawBytes', w),
      records: numOrNull(s, 'records', w),
      entry,
      files: num(s, 'files', w),
      bytes: num(s, 'bytes', w),
      gzipBytes: num(s, 'gzipBytes', w),
    };
    if (s.note !== undefined) src.note = str(s, 'note', w);
    out[id] = src;
  }
  return { format: DATA_FORMAT, generatedAt: str(o, 'generatedAt', what), sources: out };
}
