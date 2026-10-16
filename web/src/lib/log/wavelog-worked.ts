/**
 * Read Wavelog's log (Settings › Logging › Wavelog): what the operator's Wavelog log holds, read
 * for decode colours, the New chip and Hide worked only (docs/design/wavelog-worked.md). Nothing
 * here reaches the log, the ledger, the sequencer, Hunt, Repeat CQ or dupes.
 *
 * The API contract comes from Wavelog's application/controllers/Api.php and
 * models/Adif_data.php (MIT licence), read at tag 3.2.4:
 *
 * - POST /api/get_contacts_adif with JSON { key, station_id, fetchfromid, limit, output_format:
 *   "json", fields }: the QSOs of the station locations with a primary key above fetchfromid,
 *   lowest first, at most `limit`. 200 { status: "successful", message, lastfetchedid,
 *   exported_records, qsos: [{ CALL, BAND, ... }] }; with nothing newer, the message "No new QSOs
 *   available." and no qsos. lastfetchedid may come as a numeric string. With `fields`, rows equal
 *   in every field are sent once per reply, so a reply may hold fewer rows than the limit with more
 *   to come. 401 for an unknown key ("missing api key") or a station location the key's account
 *   does not hold; 429 with retry_after when the server's admin has set a rate limit. JSON output
 *   and fields need Wavelog 2.4.1, CORS 2.5.1, and a list in station_id 3.0.0.
 * - GET /api/station_info/<key>: the station locations to read.
 * - POST /api/version: the version, which decides one series of requests for every station
 *   location or one per station location.
 *
 * The API reports no edits, deletions or QSOs moved between station locations, so a full read
 * every FULL_EVERY_MS replaces what was read. Between full reads each check reads only the QSOs
 * added since the last id seen.
 *
 * Requests go as wavelog.ts sends them: JSON as text/plain with credentials omitted, a CORS simple
 * request. Time, the network and storage are injected, so the tests run it on a fake clock.
 */

import { backoffMs } from './ledger';
import type { Clock } from './outbox';
import { inSlices, yieldToMain, type Yield } from './slices';
import { hostOf, parseJson, parseStations, request, say, type FetchLike, type Http } from './wavelog';
import { callKey, workedCallKey, workedGridKey, type WorkedKeys } from './worked';
import { device } from '../app/platform';
import { advice } from '../app/advice';

/** The fields the colours need: the call, band, mode and grid. Places come from the country file by call. */
export const FIELDS = ['CALL', 'BAND', 'MODE', 'SUBMODE', 'GRIDSQUARE'] as const;
/**
 * QSOs per request: about 77 kB of JSON. Parsing a reply is one task on the main thread, so a
 * reply stays small; 100 000 QSOs take 100 requests.
 */
export const PAGE_LIMIT = 1000;
export const READ_TIMEOUT_MS = 30_000;
/** A check for new QSOs while RR73 is open and on screen. */
export const CHECK_EVERY_MS = 5 * 60_000;
/** The shortest gap between checks that an upload, coming online or coming back on screen asks for. */
export const KICK_GAP_MS = 2 * 60_000;
/** A full read, which catches QSOs edited, deleted or moved in Wavelog. */
export const FULL_EVERY_MS = 7 * 86_400_000;
/** Requests per series in one read at most: 5 000 000 QSOs. Stops a server whose last id never stops moving. */
export const MAX_PAGES = 1000;

/** Plain words for reading Wavelog's log. Failures RR73 retries by itself say so. */
export const sayRead = {
  unreachable: (host: string) => `Could not reach Wavelog at ${host}. Check that this ${device} is online. Reading the log needs Wavelog 2.5.1 or later. RR73 tries again later.`,
  offline: `This ${device} is offline. RR73 reads Wavelog’s log when it is back online.`,
  rateLimited: (s: number) => `Wavelog asked RR73 to wait ${s} s before reading more. RR73 tries again then.`,
  tooOld: (host: string) => `Wavelog at ${host} refused the request for its log. Reading the log needs Wavelog 2.5.1 or later. Update Wavelog, then tap Refresh from Wavelog.`,
  station: 'Wavelog would not send the QSOs of a station location to this key. Tap Refresh from Wavelog to try again.',
  storage: `${advice.storageRefuser} refused to store what RR73 read from Wavelog. Decode colours use it until RR73 closes.`,
  noJson: (version: string) => `Wavelog ${version} has no JSON output, so RR73 cannot read its log. Reading needs Wavelog 2.5.1 or later.`,
  noCors: (version: string) => `This Wavelog is ${version}. Reading its log needs Wavelog 2.5.1 or later, or a proxy that adds CORS headers.`,
};

/** A version as numbers, "2.4.1" giving [2, 4, 1]; null for anything else. */
function versionOf(v: string | null | undefined): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v?.trim() ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function below(v: [number, number, number], than: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (v[i] !== than[i]) return v[i] < than[i];
  return false;
}

/**
 * What the settings say about reading a Wavelog of `version`, from Test connection or the last
 * read: before 2.4.1 there is no JSON output; before 2.5.1 Safari blocks the read unless a proxy
 * adds CORS headers. Null for 2.5.1 and later, and for a version RR73 cannot read.
 */
export function versionNote(version: string | null | undefined): string | null {
  const v = versionOf(version);
  if (!v) return null;
  if (below(v, [2, 4, 1])) return sayRead.noJson(version!.trim());
  if (below(v, [2, 5, 1])) return sayRead.noCors(version!.trim());
  return null;
}

/** One series of requests: one station location, or every one in a single request (Wavelog 3.0.0 and later). */
export interface Cursor {
  stations: string[];
  /** Wavelog's primary key of the last QSO read; 0 before the first. */
  lastId: number;
}

export interface WorkedMeta {
  /** The Wavelog the keys came from: its address and a fingerprint of the API key (sourceOf). */
  source: string;
  cursors: Cursor[];
  /** When the last full read finished, UTC ms. */
  fullAt: number;
  /** When the last read, full or new QSOs only, finished, UTC ms. */
  checkedAt: number;
  /** Wavelog's version at the last full read, when it said. */
  version: string | null;
  /** The store's generation of key records, and how many it holds (wavelog-worked-store.ts). */
  gen: number;
  chunks: number;
}

/** What is stored: the read and the worked keys as lists. */
export interface StoredWorked {
  meta: WorkedMeta;
  calls: string[];
  grids: string[];
}

export interface WorkedStore {
  /** The last whole read, or null. Gives the main thread back between records. */
  load(give?: Yield): Promise<StoredWorked | null>;
  /**
   * Stores a full read in place of the last one, then the read. Resolves to the read as stored,
   * or null when `alive` turned false before the read was written.
   */
  replace(meta: WorkedMeta, calls: Iterable<string>, grids: Iterable<string>, give?: Yield, alive?: () => boolean): Promise<WorkedMeta | null>;
  /** Adds new keys and stores the read, in one transaction. Resolves to the read as stored. */
  append(meta: WorkedMeta, calls: readonly string[], grids: readonly string[]): Promise<WorkedMeta>;
  /** Deletes everything read. */
  clear(): Promise<void>;
}

/** The Wavelog to read: its base address and API key. */
export interface WorkedSource {
  url: string;
  apiKey: string;
}

/** A fingerprint of the address and key, stored with the keys, so a new address or key starts afresh without storing the key twice. */
export function sourceOf(s: WorkedSource): string {
  let h = 0x811c9dc5;
  for (const ch of `${s.url}\n${s.apiKey.trim()}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${s.url} ${h.toString(16).padStart(8, '0')}`;
}

/** The keys of what was read: calls, grids, and the base callsigns, which count the stations. */
export interface KeySets {
  calls: Set<string>;
  grids: Set<string>;
  bases: Set<string>;
}

export function keySets(): KeySets {
  return { calls: new Set(), grids: new Set(), bases: new Set() };
}

/** The base callsign of a call key: "VK3/9V1NE 20m FT8" gives 9V1NE. */
export function baseOfKey(key: string): string {
  return callKey(key.split(' ')[0] ?? '');
}

/** Adds one row's call and grid keys. Rows are Wavelog's JSON QSOs; anything else is skipped. */
export function addRow(row: unknown, to: KeySets): void {
  if (!row || typeof row !== 'object') return;
  const o = row as Record<string, unknown>;
  const f = (k: string) => {
    const v = o[k] ?? o[k.toLowerCase()];
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  };
  const c = workedCallKey(f('CALL'), f('BAND'), f('MODE'), f('SUBMODE'));
  if (c) {
    to.calls.add(c);
    to.bases.add(baseOfKey(c));
  }
  const g = workedGridKey(f('GRIDSQUARE'), f('BAND'));
  if (g) to.grids.add(g);
}

/** Adds each row's keys at once: for tests and small lists. */
export function addRows(rows: readonly unknown[], to: KeySets): void {
  for (const r of rows) addRow(r, to);
}

export type Failure =
  | { kind: 'retry'; message: string; retryAfterMs: number }
  | { kind: 'refused'; message: string }
  /** A station location read before is gone: read the list again. */
  | { kind: 'stations' };

export type Page = { kind: 'rows'; rows: unknown[]; lastId: number } | { kind: 'done' } | Failure;

const retry = (message: string, retryAfterMs = 0): Failure => ({ kind: 'retry', message, retryAfterMs });
const refused = (message: string): Failure => ({ kind: 'refused', message });

function retryAfterS(body: Record<string, unknown> | null): number {
  const s = typeof body?.retry_after === 'number' ? body.retry_after : Number(body?.retry_after);
  return Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60;
}

/** Reads Wavelog's answer to POST /api/get_contacts_adif. */
export function mapContacts(http: Http, host: string): Page {
  if (http.kind === 'network') return retry(sayRead.unreachable(host));
  if (http.kind === 'timeout') return retry(say.timeout(host, READ_TIMEOUT_MS / 1000));
  const { status } = http;
  const body = parseJson(http.text);
  const reason = typeof body?.reason === 'string' ? body.reason : '';
  if (status === 429) {
    const s = retryAfterS(body);
    return retry(sayRead.rateLimited(s), s * 1000);
  }
  if (status === 401 && /station/i.test(reason)) return { kind: 'stations' };
  if (status === 401 || status === 403) return refused(say.keyInvalid);
  if (status === 400) return refused(sayRead.tooOld(host));
  if (status === 404 || status === 405) return refused(say.notWavelog(host));
  if (status >= 500) return retry(say.serverError(host, status));
  if (status === 200 && body?.status === 'successful') {
    if (Array.isArray(body.qsos)) return { kind: 'rows', rows: body.qsos, lastId: Number(body.lastfetchedid) };
    if (/no new qsos/i.test(String(body.message ?? '')) || Number(body.exported_qsos ?? body.exported_records) === 0) return { kind: 'done' };
    // ADIF where JSON was asked for: a Wavelog older than 2.4.1 that ignores output_format.
    if (typeof body.adif === 'string') return refused(sayRead.tooOld(host));
  }
  return retry(say.unreadable(host));
}

/** True for a Wavelog version that takes a list of station locations in one request: 3.0.0 and later. */
export function takesStationList(version: string | null): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version?.trim() ?? '');
  return !!m && Number(m[1]) >= 3;
}

/** The series for a read: one for every station location on Wavelog 3.0.0 and later, else one each. */
export function cursorsFor(stationIds: readonly string[], version: string | null): Cursor[] {
  if (!stationIds.length) return [];
  if (takesStationList(version)) return [{ stations: [...stationIds], lastId: 0 }];
  return stationIds.map((id) => ({ stations: [id], lastId: 0 }));
}

/** The requests a read makes, as Wavelog's API takes them. */
export interface WorkedClient {
  host: string;
  stations(): Promise<{ ok: true; ids: string[] } | Failure>;
  version(): Promise<string | null>;
  contacts(stations: readonly string[], fromId: number): Promise<Page>;
}

export function workedClient(src: WorkedSource, fetchFn: FetchLike): WorkedClient {
  const host = hostOf(src.url);
  const key = src.apiKey.trim();
  const post = (path: string, body: unknown) =>
    request(fetchFn, `${src.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) }, READ_TIMEOUT_MS);
  return {
    host,
    async stations() {
      const http = await request(fetchFn, `${src.url}/api/station_info/${encodeURIComponent(key)}`, { method: 'GET' }, READ_TIMEOUT_MS);
      if (http.kind === 'network') return retry(sayRead.unreachable(host));
      if (http.kind === 'timeout') return retry(say.timeout(host, READ_TIMEOUT_MS / 1000));
      if (http.status === 401 || http.status === 403) return refused(say.keyInvalid);
      if (http.status === 429) {
        const s = retryAfterS(parseJson(http.text));
        return retry(sayRead.rateLimited(s), s * 1000);
      }
      if (http.status >= 500) return retry(say.serverError(host, http.status));
      const list = parseStations(http.text);
      return list ? { ok: true, ids: list.map((s) => s.id) } : refused(say.notWavelog(host));
    },
    async version() {
      const http = await post('/api/version', { key });
      if (http.kind !== 'response' || http.status !== 200) return null;
      const v = parseJson(http.text)?.version;
      return typeof v === 'string' ? v : null;
    },
    async contacts(stations, fromId) {
      const station_id = stations.length === 1 ? stations[0] : [...stations];
      return mapContacts(await post('/api/get_contacts_adif', { key, station_id, fetchfromid: fromId, limit: PAGE_LIMIT, output_format: 'json', fields: FIELDS }), host);
    },
  };
}

/**
 * Reads one series from its cursor until Wavelog has nothing newer: "No new QSOs available.", or a
 * last id that stops moving. Moves the cursor and hands each page's rows to `take` as it goes, so
 * a failure keeps what came before it.
 */
export async function readSeries(
  client: WorkedClient,
  cursor: Cursor,
  take: (rows: unknown[]) => Promise<boolean>,
  alive: () => boolean = () => true,
): Promise<{ kind: 'ok' } | Failure | { kind: 'dropped' }> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.contacts(cursor.stations, cursor.lastId);
    if (!alive()) return { kind: 'dropped' };
    if (r.kind === 'done') return { kind: 'ok' };
    if (r.kind !== 'rows') return r;
    if (!(await take(r.rows)) || !alive()) return { kind: 'dropped' };
    if (!(r.lastId > cursor.lastId)) return { kind: 'ok' };
    cursor.lastId = r.lastId;
  }
  return { kind: 'ok' };
}

/** What the settings show about the read. */
export interface WorkedStatus {
  /** Reading is on for a Wavelog. */
  on: boolean;
  /** A read under way. */
  reading: boolean;
  /** A full read under way: the first, the weekly one or Refresh from Wavelog. */
  readingAll: boolean;
  /** Distinct base callsigns in what was read, or read so far in a full read. */
  stations: number;
  /** When the last read finished, UTC ms; null before the first. */
  checkedAt: number | null;
  fullAt: number | null;
  /** Wavelog's version at the last full read, when it said. */
  version: string | null;
  /** Why the last read failed, or storing it, and what happens next or what to do, in plain words; null when all is well. */
  error: string | null;
}

export const WORKED_OFF: WorkedStatus = { on: false, reading: false, readingAll: false, stations: 0, checkedAt: null, fullAt: null, version: null, error: null };

/**
 * The keys as they change. `all`: a new set to index, after a full read or loading what was
 * stored. `added`: new keys, already in the sets `all` gave, to add to that index in place.
 */
export type KeysChange = { kind: 'none' } | { kind: 'all'; keys: WorkedKeys } | { kind: 'added'; keys: WorkedKeys; calls: readonly string[]; grids: readonly string[] };

export interface WorkedDeps {
  clock: Clock;
  fetch: FetchLike;
  online(): boolean;
  /** RR73 is on screen: hidden, the 5-minute check waits until it shows again. */
  visible(): boolean;
  store: WorkedStore;
  onKeys(change: KeysChange): void;
  onStatus(status: WorkedStatus): void;
  /** Gives the main thread back between slices of work; tests pass one that resolves at once. */
  yield?: Yield;
}

interface Held extends KeySets {
  meta: WorkedMeta;
  /** The calls and grids as handed to onKeys, one object for the life of the sets. */
  view: WorkedKeys;
}

/** A full read under way: kept across a wait, such as Wavelog's retry_after, while RR73 stays open. */
interface FullRead extends KeySets {
  epoch: number;
  cursors: (Cursor & { done: boolean })[];
  version: string | null;
}

type Outcome = { kind: 'ok' } | Failure | { kind: 'dropped' };

/**
 * Keeps the worked keys from one Wavelog up to date while RR73 is open: reads at start, after an
 * upload, when the phone comes online or RR73 comes back on screen (at most every KICK_GAP_MS),
 * every CHECK_EVERY_MS on screen, and in full every FULL_EVERY_MS or on Refresh from Wavelog.
 * Failures wait 30 s doubling to 30 min; a 429 waits as long as Wavelog asks; a refusal waits for
 * the operator. One read at a time per source. Large sets are handled in slices (slices.ts).
 */
export class WorkedSync {
  private source: WorkedSource | null = null;
  private sourceKey = '';
  /** Changes with every use(): work begun for an earlier source or switch-on drops its results. */
  private epoch = 0;
  private held: Held | null = null;
  /** Keys read but not yet stored, and whether the last full read is still to store. */
  private unsaved: { calls: string[]; grids: string[] } = { calls: [], grids: [] };
  private needReplace = false;
  private full: FullRead | null = null;
  private fullDue = false;
  private failures = 0;
  private pausedUntil = 0;
  private refusal: string | null = null;
  private error: string | null = null;
  private storageError: string | null = null;
  private kickAt = 0;
  private active: Promise<void> | null = null;
  private readingAll = false;
  private loading: Promise<void> | null = null;
  /** What is stored for the source has been read: no read starts before. */
  private loaded = false;
  private timer: unknown = null;
  /** Store work, one after another, so a load or a delete follows any write already started. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: WorkedDeps) {}

  private get give(): Yield {
    return this.deps.yield ?? yieldToMain;
  }

  /**
   * Reads `source` from now on, or stops with null. Keys stored for another address or key are
   * deleted. Stopping keeps what is stored: forget() deletes it.
   */
  use(source: WorkedSource | null): Promise<void> {
    const key = source ? sourceOf(source) : '';
    if (key === this.sourceKey) return this.loading ?? Promise.resolve();
    this.epoch++;
    this.source = source;
    this.sourceKey = key;
    this.held = null;
    this.unsaved = { calls: [], grids: [] };
    this.needReplace = false;
    this.full = null;
    this.fullDue = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.refusal = null;
    this.error = null;
    this.storageError = null;
    this.kickAt = 0;
    this.readingAll = false;
    this.loaded = false;
    // A read for the earlier source may still wait on Wavelog: it drops what it gets, and the new
    // source does not wait for it.
    this.active = null;
    this.clearTimer();
    this.deps.onKeys({ kind: 'none' });
    if (!source) {
      this.loading = null;
      this.publish();
      return Promise.resolve();
    }
    this.publish();
    const epoch = this.epoch;
    const loading = this.load(key, epoch).then(() => {
      if (this.epoch === epoch) this.kick();
    });
    this.loading = loading;
    return loading;
  }

  /** Stops reading and deletes what was read. The delete is queued at once, before any load a use() right after may start. */
  forget(): Promise<void> {
    void this.use(null);
    return this.store(() => this.deps.store.clear());
  }

  /** Something may have added QSOs to Wavelog, such as an upload: reads unless the last read is under KICK_GAP_MS old. */
  kick(): void {
    if (!this.source) return;
    const since = this.held ? this.deps.clock.now() - this.held.meta.checkedAt : Infinity;
    if (since >= KICK_GAP_MS) void this.run(false);
    else {
      this.kickAt = this.held!.meta.checkedAt + KICK_GAP_MS;
      this.schedule();
    }
  }

  /** Reads what is new now, unless a wait or a refusal holds it back. */
  check(): Promise<void> {
    return this.run(false);
  }

  /** The phone came online: the wait after a failure ends, and RR73 reads. */
  online(): void {
    this.failures = 0;
    this.pausedUntil = 0;
    this.kick();
  }

  /** Refresh from Wavelog: a full read from id 0 now, with the station locations read again, whatever the wait or a refusal. Resolves when it ends. */
  async refresh(): Promise<void> {
    if (!this.source) return;
    await this.loading;
    if (this.active) await this.active;
    this.failures = 0;
    this.pausedUntil = 0;
    this.refusal = null;
    this.full = null;
    this.fullDue = true;
    await this.run(true);
  }

  /** Resolves once no read is under way. */
  async idle(): Promise<void> {
    await this.loading;
    while (this.active) await this.active;
    await this.queue.catch(() => undefined);
  }

  /** Ends the timers, for tests. */
  stop(): void {
    this.clearTimer();
  }

  private alive(epoch: number): () => boolean {
    return () => this.epoch === epoch;
  }

  private async load(key: string, epoch: number): Promise<void> {
    let stored: StoredWorked | null = null;
    try {
      stored = await this.store(() => this.deps.store.load(this.give));
    } catch {
      stored = null;
    }
    if (this.epoch !== epoch) return;
    if (stored && stored.meta.source !== key) {
      await this.store(() => this.deps.store.clear()).catch(() => undefined);
      stored = null;
    }
    if (this.epoch !== epoch) return;
    if (stored) {
      const sets = keySets();
      const s = stored;
      const alive = this.alive(epoch);
      const done =
        (await inSlices(
          s.calls,
          (k) => {
            sets.calls.add(k);
            sets.bases.add(baseOfKey(k));
          },
          { yield: this.give, alive },
        )) && (await inSlices(s.grids, (k) => sets.grids.add(k), { yield: this.give, alive }));
      if (!done) return;
      sets.bases.delete('');
      this.held = { ...sets, meta: s.meta, view: { calls: sets.calls, grids: sets.grids } };
      this.deps.onKeys({ kind: 'all', keys: this.held.view });
    }
    this.loaded = true;
    this.publish();
  }

  private run(operator: boolean): Promise<void> {
    if (this.active) return this.active;
    const p = this.read(operator).finally(() => {
      if (this.active === p) this.active = null;
      this.publish();
      this.schedule();
    });
    this.active = p;
    this.publish();
    return p;
  }

  private async read(operator: boolean): Promise<void> {
    const src = this.source;
    if (!src || !this.loaded) return;
    const key = this.sourceKey;
    const epoch = this.epoch;
    const now = this.deps.clock.now();
    // A refusal stands until the operator acts: going offline and back does not hide it.
    if (!operator && this.refusal) return;
    if (!this.deps.online()) {
      this.error = sayRead.offline;
      return;
    }
    if (!operator && this.pausedUntil > now) return;
    const alive = this.alive(epoch);
    const client = workedClient(src, this.deps.fetch);
    const fullNow = this.fullDue || !this.held || !!this.full || now - this.held.meta.fullAt >= FULL_EVERY_MS;
    this.readingAll = fullNow;
    this.publish();
    let outcome = fullNow ? await this.readFull(client, key, epoch) : await this.readNew(client, key, epoch);
    if (outcome.kind === 'stations' && alive()) {
      // A station location read before is gone: read the list again, in full.
      this.full = null;
      this.readingAll = true;
      this.publish();
      outcome = await this.readFull(client, key, epoch);
      if (outcome.kind === 'stations') outcome = refused(sayRead.station);
    }
    if (!alive()) return;
    this.readingAll = false;
    if (outcome.kind === 'dropped') return;
    const at = this.deps.clock.now();
    if (outcome.kind === 'ok') {
      this.failures = 0;
      this.pausedUntil = 0;
      this.error = null;
      this.kickAt = 0;
    } else if (outcome.kind === 'retry') {
      // A 429 says how long to wait; it is no failure of the server, so the backoff stays.
      if (outcome.retryAfterMs > 0) this.pausedUntil = at + outcome.retryAfterMs;
      else this.pausedUntil = at + backoffMs(++this.failures);
      this.error = outcome.message;
    } else if (outcome.kind === 'refused') {
      this.refusal = outcome.message;
      this.error = outcome.message;
    }
  }

  /** Adds a page's rows to `to` in slices. False when the source changed meanwhile. */
  private take(rows: unknown[], to: KeySets, epoch: number): Promise<boolean> {
    return inSlices(rows, (r) => addRow(r, to), { yield: this.give, alive: this.alive(epoch) });
  }

  private async readFull(client: WorkedClient, key: string, epoch: number): Promise<Outcome> {
    const alive = this.alive(epoch);
    if (!this.full || this.full.epoch !== epoch) {
      const list = await client.stations();
      if (!alive()) return { kind: 'dropped' };
      if (!('ok' in list)) return list.kind === 'stations' ? refused(sayRead.station) : list;
      const version = await client.version();
      if (!alive()) return { kind: 'dropped' };
      this.full = { ...keySets(), epoch, cursors: cursorsFor(list.ids, version).map((c) => ({ ...c, done: false })), version };
      this.publish();
    }
    const f = this.full;
    for (const c of f.cursors) {
      if (c.done) continue;
      const r = await readSeries(
        client,
        c,
        async (rows) => {
          const ok = await this.take(rows, f, epoch);
          this.publish();
          return ok;
        },
        alive,
      );
      if (r.kind !== 'ok') return r;
      c.done = true;
    }
    if (!alive() || this.full !== f) return { kind: 'dropped' };
    const at = this.deps.clock.now();
    const meta: WorkedMeta = { source: key, cursors: f.cursors.map(({ stations, lastId }) => ({ stations, lastId })), fullAt: at, checkedAt: at, version: f.version, gen: 0, chunks: 0 };
    this.full = null;
    this.fullDue = false;
    f.bases.delete('');
    this.held = { calls: f.calls, grids: f.grids, bases: f.bases, meta, view: { calls: f.calls, grids: f.grids } };
    this.unsaved = { calls: [], grids: [] };
    this.needReplace = true;
    this.deps.onKeys({ kind: 'all', keys: this.held.view });
    await this.persist(epoch);
    return { kind: 'ok' };
  }

  private async readNew(client: WorkedClient, key: string, epoch: number): Promise<Outcome> {
    const alive = this.alive(epoch);
    const h = this.held!;
    const cursors = h.meta.cursors.map((c) => ({ stations: [...c.stations], lastId: c.lastId }));
    const got = keySets();
    let outcome: Outcome = { kind: 'ok' };
    for (const c of cursors) {
      outcome = await readSeries(client, c, (rows) => this.take(rows, got, epoch), alive);
      if (outcome.kind !== 'ok') break;
    }
    if (outcome.kind === 'stations') return outcome;
    if (outcome.kind === 'dropped' || !alive() || this.held !== h) return { kind: 'dropped' };
    // What came before a failure is kept, and the next read goes on from there.
    const calls = [...got.calls].filter((k) => !h.calls.has(k));
    const grids = [...got.grids].filter((k) => !h.grids.has(k));
    for (const k of calls) {
      h.calls.add(k);
      const b = baseOfKey(k);
      if (b) h.bases.add(b);
    }
    for (const k of grids) h.grids.add(k);
    h.meta = { ...h.meta, cursors, checkedAt: outcome.kind === 'ok' ? this.deps.clock.now() : h.meta.checkedAt };
    if (calls.length || grids.length) {
      this.unsaved.calls.push(...calls);
      this.unsaved.grids.push(...grids);
      this.deps.onKeys({ kind: 'added', keys: h.view, calls, grids });
    }
    await this.persist(epoch);
    return outcome;
  }

  /**
   * Stores what is held: a full read in place of the last, or the keys not yet stored with the
   * read. A failure keeps them to store with the next read, and shows until a store succeeds.
   */
  private async persist(epoch: number): Promise<void> {
    const h = this.held;
    if (!h || this.epoch !== epoch) return;
    const alive = this.alive(epoch);
    try {
      await this.store(async () => {
        if (!alive()) return;
        if (this.needReplace) {
          const meta = await this.deps.store.replace(h.meta, h.calls, h.grids, this.give, alive);
          if (!meta || !alive()) return;
          h.meta = meta;
          this.needReplace = false;
          this.unsaved = { calls: [], grids: [] };
        } else {
          const u = this.unsaved;
          this.unsaved = { calls: [], grids: [] };
          try {
            h.meta = await this.deps.store.append(h.meta, u.calls, u.grids);
          } catch (e) {
            this.unsaved.calls.unshift(...u.calls);
            this.unsaved.grids.unshift(...u.grids);
            throw e;
          }
        }
      });
      if (alive()) this.storageError = null;
    } catch {
      if (alive()) this.storageError = sayRead.storage;
    }
  }

  /** Runs store work after any already started. */
  private store<T>(op: () => Promise<T>): Promise<T> {
    const p = this.queue.then(op);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Wakes for the next read: after a wait, a kick, the next check or the next full read. */
  private schedule() {
    this.clearTimer();
    if (!this.source || !this.loaded || this.active || this.refusal) return;
    const now = this.deps.clock.now();
    let at: number;
    if (this.pausedUntil > now) at = this.pausedUntil;
    else if (!this.held || this.full || this.fullDue) at = now;
    else {
      at = Math.min(this.held.meta.checkedAt + CHECK_EVERY_MS, this.held.meta.fullAt + FULL_EVERY_MS);
      if (this.kickAt > now) at = Math.min(at, this.kickAt);
    }
    // Offline, the online event reads; a failed read waits for its backoff first.
    if (!this.deps.online()) return;
    this.timer = this.deps.clock.setTimeout(
      () => {
        this.timer = null;
        // Off screen, the next kick (RR73 back on screen) reads.
        if (this.deps.visible()) void this.run(false);
      },
      Math.max(0, at - now),
    );
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private publish() {
    const h = this.held;
    const all = this.active !== null && this.readingAll;
    this.deps.onStatus(
      this.source
        ? {
            on: true,
            reading: this.active !== null,
            readingAll: all,
            // A full read counts what it has read so far, from 0.
            stations: all ? (this.full?.bases.size ?? 0) : (h?.bases.size ?? 0),
            checkedAt: h?.meta.checkedAt ?? null,
            fullAt: h?.meta.fullAt ?? null,
            version: h?.meta.version ?? null,
            error: this.error ?? this.storageError,
          }
        : WORKED_OFF,
    );
  }
}
