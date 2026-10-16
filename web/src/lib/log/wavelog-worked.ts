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
import { hostOf, parseJson, parseStations, request, say, type FetchLike, type Http } from './wavelog';
import { callKey, workedCallKey, workedGridKey, type WorkedKeys } from './worked';

/** The fields the colours need: the call, band, mode and grid. Places come from the country file by call. */
export const FIELDS = ['CALL', 'BAND', 'MODE', 'SUBMODE', 'GRIDSQUARE'] as const;
/** QSOs per request: about 0.4 MB of JSON. */
export const PAGE_LIMIT = 5000;
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
  unreachable: (host: string) => `Could not reach Wavelog at ${host}. Check that this phone is online. Reading the log needs Wavelog 2.5.1 or later. RR73 tries again later.`,
  offline: 'This phone is offline. RR73 reads Wavelog’s log when it is back online.',
  rateLimited: (s: number) => `Wavelog asked RR73 to wait ${s} s before reading more. RR73 tries again then.`,
  tooOld: (host: string) => `Wavelog at ${host} refused the request for its log. Reading the log needs Wavelog 2.5.1 or later. Update Wavelog, then tap Refresh from Wavelog.`,
  station: 'Wavelog would not send the QSOs of a station location to this key. Tap Refresh from Wavelog to try again.',
  storage: 'This phone refused to store what RR73 read from Wavelog. Decode colours use it until RR73 closes.',
};

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
}

/** What is stored: the read and the worked keys as lists. */
export interface StoredWorked {
  meta: WorkedMeta;
  calls: string[];
  grids: string[];
}

export interface WorkedStore {
  load(): Promise<StoredWorked | null>;
  /** Stores the read; the keys only when `keys` is true. */
  save(d: StoredWorked, keys: boolean): Promise<void>;
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

/** Adds each row's call and grid keys. Rows are Wavelog's JSON QSOs; anything else is skipped. */
export function addRows(rows: readonly unknown[], calls: Set<string>, grids: Set<string>): void {
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const f = (k: string) => {
      const v = o[k] ?? o[k.toLowerCase()];
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    };
    const c = workedCallKey(f('CALL'), f('BAND'), f('MODE'), f('SUBMODE'));
    if (c) calls.add(c);
    const g = workedGridKey(f('GRIDSQUARE'), f('BAND'));
    if (g) grids.add(g);
  }
}

/** Distinct base callsigns among call keys: the stations worked. */
export function countStations(calls: Iterable<string>): number {
  const seen = new Set<string>();
  for (const k of calls) seen.add(callKey(k.split(' ')[0] ?? ''));
  seen.delete('');
  return seen.size;
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
 * last id that stops moving. Moves the cursor and adds the rows as it goes, so a failure keeps
 * what came before it.
 */
export async function readSeries(
  client: WorkedClient,
  cursor: Cursor,
  calls: Set<string>,
  grids: Set<string>,
  alive: () => boolean = () => true,
  onPage: () => void = () => undefined,
): Promise<{ kind: 'ok' } | Failure | { kind: 'dropped' }> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.contacts(cursor.stations, cursor.lastId);
    if (!alive()) return { kind: 'dropped' };
    if (r.kind === 'done') return { kind: 'ok' };
    if (r.kind !== 'rows') return r;
    addRows(r.rows, calls, grids);
    onPage();
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
  /** Why the last read failed and what happens next or what to do, in plain words; null after a read that worked. */
  error: string | null;
}

export const WORKED_OFF: WorkedStatus = { on: false, reading: false, readingAll: false, stations: 0, checkedAt: null, fullAt: null, error: null };

export interface WorkedDeps {
  clock: Clock;
  fetch: FetchLike;
  online(): boolean;
  /** RR73 is on screen: hidden, the 5-minute check waits until it shows again. */
  visible(): boolean;
  store: WorkedStore;
  /** The keys to lay over the log, or null for none. */
  onKeys(keys: WorkedKeys | null): void;
  onStatus(status: WorkedStatus): void;
}

interface Held {
  meta: WorkedMeta;
  calls: ReadonlySet<string>;
  grids: ReadonlySet<string>;
  stations: number;
}

/** A full read under way: kept across a wait, such as Wavelog's retry_after, while RR73 stays open. */
interface FullRead {
  source: string;
  cursors: (Cursor & { done: boolean })[];
  calls: Set<string>;
  grids: Set<string>;
}

type Outcome = { kind: 'ok' } | Failure | { kind: 'dropped' };

/**
 * Keeps the worked keys from one Wavelog up to date while RR73 is open: reads at start, after an
 * upload, when the phone comes online or RR73 comes back on screen (at most every KICK_GAP_MS),
 * every CHECK_EVERY_MS on screen, and in full every FULL_EVERY_MS or on Refresh from Wavelog.
 * Failures wait 30 s doubling to 30 min, or as long as Wavelog asks; a refusal waits for the
 * operator. One read at a time.
 */
export class WorkedSync {
  private source: WorkedSource | null = null;
  private sourceKey = '';
  private held: Held | null = null;
  private full: FullRead | null = null;
  private fullDue = false;
  private failures = 0;
  private pausedUntil = 0;
  private refusal: string | null = null;
  private error: string | null = null;
  private kickAt = 0;
  private active: Promise<void> | null = null;
  private readingAll = false;
  private loading: Promise<void> | null = null;
  /** What is stored for the source has been read: no read starts before. */
  private loaded = false;
  private timer: unknown = null;
  /** Store writes, one after another, so a delete follows any write already started. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WorkedDeps) {}

  /**
   * Reads `source` from now on, or stops with null. Keys stored for another address or key are
   * deleted. Stopping keeps what is stored: forget() deletes it.
   */
  use(source: WorkedSource | null): Promise<void> {
    const key = source ? sourceOf(source) : '';
    if (key === this.sourceKey) return this.loading ?? Promise.resolve();
    this.source = source;
    this.sourceKey = key;
    this.held = null;
    this.full = null;
    this.fullDue = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.refusal = null;
    this.error = null;
    this.loaded = false;
    this.clearTimer();
    this.deps.onKeys(null);
    if (!source) {
      this.loading = null;
      this.publish();
      return Promise.resolve();
    }
    this.publish();
    const loading = this.load(key).then(() => {
      if (this.sourceKey === key) this.kick();
    });
    this.loading = loading;
    return loading;
  }

  /** Stops reading and deletes what was read. */
  async forget(): Promise<void> {
    await this.use(null);
    await this.write(() => this.deps.store.clear());
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

  /** The phone came online: the wait after a failure ends, and RR73 reads. */
  online(): void {
    this.failures = 0;
    this.pausedUntil = 0;
    this.kick();
  }

  /** Refresh from Wavelog: a full read now, whatever the wait or a refusal. Resolves when it ends. */
  async refresh(): Promise<void> {
    if (!this.source) return;
    await this.loading;
    this.failures = 0;
    this.pausedUntil = 0;
    this.refusal = null;
    this.fullDue = true;
    if (this.active) await this.active;
    await this.run(true);
  }

  /** Resolves once no read is under way. */
  async idle(): Promise<void> {
    await this.loading;
    while (this.active) await this.active;
  }

  /** Ends the timers, for tests. */
  stop(): void {
    this.clearTimer();
  }

  private async load(key: string): Promise<void> {
    let stored: StoredWorked | null = null;
    try {
      stored = await this.deps.store.load();
    } catch {
      stored = null;
    }
    if (this.sourceKey !== key) return;
    if (stored && stored.meta.source !== key) {
      await this.write(() => this.deps.store.clear());
      stored = null;
    }
    if (this.sourceKey !== key) return;
    if (stored) this.hold({ meta: stored.meta, calls: new Set(stored.calls), grids: new Set(stored.grids) });
    this.loaded = true;
    this.publish();
  }

  private hold(d: { meta: WorkedMeta; calls: ReadonlySet<string>; grids: ReadonlySet<string> }, keysChanged = true) {
    const stations = keysChanged || !this.held ? countStations(d.calls) : this.held.stations;
    this.held = { ...d, stations };
    if (keysChanged) this.deps.onKeys({ calls: d.calls, grids: d.grids });
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
    const now = this.deps.clock.now();
    if (!this.deps.online()) {
      this.error = sayRead.offline;
      return;
    }
    if (!operator && (this.refusal || this.pausedUntil > now)) return;
    const alive = () => this.sourceKey === key;
    const client = workedClient(src, this.deps.fetch);
    const fullNow = this.fullDue || !this.held || !!this.full || now - this.held.meta.fullAt >= FULL_EVERY_MS;
    this.readingAll = fullNow;
    this.publish();
    let outcome = fullNow ? await this.readFull(client, key, alive) : await this.readNew(client, key, alive);
    if (outcome.kind === 'stations' && alive()) {
      // A station location read before is gone: read the list again, in full.
      this.full = null;
      this.readingAll = true;
      this.publish();
      outcome = await this.readFull(client, key, alive);
      if (outcome.kind === 'stations') outcome = refused(sayRead.station);
    }
    this.readingAll = false;
    if (!alive() || outcome.kind === 'dropped') return;
    const at = this.deps.clock.now();
    if (outcome.kind === 'ok') {
      this.failures = 0;
      this.pausedUntil = 0;
      this.error = null;
      this.kickAt = 0;
    } else if (outcome.kind === 'retry') {
      this.failures++;
      this.pausedUntil = at + Math.max(backoffMs(this.failures), outcome.retryAfterMs);
      this.error = outcome.message;
    } else if (outcome.kind === 'refused') {
      this.refusal = outcome.message;
      this.error = outcome.message;
    }
  }

  private async readFull(client: WorkedClient, key: string, alive: () => boolean): Promise<Outcome> {
    if (!this.full || this.full.source !== key) {
      const list = await client.stations();
      if (!alive()) return { kind: 'dropped' };
      if (!('ok' in list)) return list.kind === 'stations' ? refused(sayRead.station) : list;
      const version = await client.version();
      if (!alive()) return { kind: 'dropped' };
      this.full = { source: key, cursors: cursorsFor(list.ids, version).map((c) => ({ ...c, done: false })), calls: new Set(), grids: new Set() };
    }
    const f = this.full;
    for (const c of f.cursors) {
      if (c.done) continue;
      const r = await readSeries(client, c, f.calls, f.grids, alive, () => this.publish());
      if (r.kind !== 'ok') return r;
      c.done = true;
    }
    if (!alive() || this.full !== f) return { kind: 'dropped' };
    const at = this.deps.clock.now();
    const meta: WorkedMeta = { source: key, cursors: f.cursors.map(({ stations, lastId }) => ({ stations, lastId })), fullAt: at, checkedAt: at };
    this.full = null;
    this.fullDue = false;
    this.hold({ meta, calls: f.calls, grids: f.grids });
    await this.save(key, true);
    return { kind: 'ok' };
  }

  private async readNew(client: WorkedClient, key: string, alive: () => boolean): Promise<Outcome> {
    const h = this.held!;
    const cursors = h.meta.cursors.map((c) => ({ stations: [...c.stations], lastId: c.lastId }));
    const calls = new Set<string>();
    const grids = new Set<string>();
    let outcome: Outcome = { kind: 'ok' };
    for (const c of cursors) {
      outcome = await readSeries(client, c, calls, grids, alive);
      if (outcome.kind !== 'ok') break;
    }
    if (outcome.kind === 'stations') return outcome;
    if (outcome.kind === 'dropped' || !alive() || this.held !== h) return { kind: 'dropped' };
    // What came before a failure is kept, and the next read goes on from there.
    const newCalls = [...calls].filter((k) => !h.calls.has(k));
    const newGrids = [...grids].filter((k) => !h.grids.has(k));
    const changed = newCalls.length > 0 || newGrids.length > 0;
    const meta: WorkedMeta = { ...h.meta, cursors, checkedAt: outcome.kind === 'ok' ? this.deps.clock.now() : h.meta.checkedAt };
    this.hold({ meta, calls: changed ? new Set([...h.calls, ...newCalls]) : h.calls, grids: changed ? new Set([...h.grids, ...newGrids]) : h.grids }, changed);
    await this.save(key, changed);
    return outcome;
  }

  private async save(key: string, keys: boolean): Promise<void> {
    const h = this.held;
    if (!h || this.sourceKey !== key) return;
    const d: StoredWorked = { meta: h.meta, calls: keys ? [...h.calls] : [], grids: keys ? [...h.grids] : [] };
    try {
      await this.write(() => (this.sourceKey === key ? this.deps.store.save(d, keys) : Promise.resolve()));
    } catch {
      this.error = sayRead.storage;
    }
  }

  private write(op: () => Promise<void>): Promise<void> {
    const p = this.writes.then(op);
    this.writes = p.catch(() => undefined);
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
    this.deps.onStatus(
      this.source
        ? {
            on: true,
            reading: this.active !== null,
            readingAll: this.active !== null && this.readingAll,
            stations: this.readingAll && this.full ? countStations(this.full.calls) : (h?.stations ?? 0),
            checkedAt: h?.meta.checkedAt ?? null,
            fullAt: h?.meta.fullAt ?? null,
            error: this.error,
          }
        : WORKED_OFF,
    );
  }
}
