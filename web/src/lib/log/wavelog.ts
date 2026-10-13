/**
 * Wavelog, a direct destination. The API contract comes from Wavelog's application/controllers/
 * Api.php and models/Logbook_model.php (MIT licence), read at commit 3af1ba5 (September 2026):
 *
 * - GET /api/auth/<key>: XML, <status>Valid</status> and <rights>r|rw</rights>, or a
 *   <message> that the key is invalid.
 * - GET /api/station_info/<key>: a JSON array of station locations; 401 for an unknown key.
 * - POST /api/qso, and /api/qso/true for a dry run, with { key, station_profile_id, type: "adif",
 *   string }. 201 { status: "created", adif_count, adif_errors }; 400 { status: "abort",
 *   messages } with Wavelog's reasons; 401 for an unknown key or a station location that is not
 *   the key owner's; 403 for a read-only key; 429 with retry_after when rate limited; 200
 *   { status: "failed", reason: "wrong JSON" } for a body it cannot read.
 * - Wavelog skips a QSO with the same call, band, mode and minute at the station location and
 *   reports it as a duplicate; RR73 counts that as delivered. Its import also refuses a QSO whose
 *   STATION_CALLSIGN differs from the station location's callsign, or whose MY_GRIDSQUARE does
 *   not overlap the station location's grid.
 *
 * Requests carry text/plain JSON, a CORS simple request, so each QSO costs one round trip with no
 * preflight on a weak link. Wavelog reads the body whatever its type.
 *
 * Each QSO goes in its own request: Wavelog's reply counts errors for the whole batch, so one
 * QSO per request is the only way to know which QSO a refusal belongs to.
 */

import type { Receipt } from './ledger';
import type { SendingDestination } from './outbox';
import { qsoToRecord } from './qso-adif';
import { writeRecord } from './adif';
import type { Qso, WavelogConfig, WavelogStation, WavelogTest } from './types';

export const SEND_TIMEOUT_MS = 20_000;
export const TEST_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type Http = { kind: 'response'; status: number; text: string } | { kind: 'network' } | { kind: 'timeout' };

/** One request with a timeout. Never throws: network failures (CORS included) and timeouts are results. */
export async function request(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Http> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    return { kind: 'response', status: res.status, text: await res.text() };
  } catch {
    return ctrl.signal.aborted ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export type AddressCheck = { ok: true; url: string; host: string } | { ok: false; message: string };

/**
 * The base address of a Wavelog: https added when missing, a trailing /api/... and slashes
 * removed. Plain http is refused: Safari blocks it from a page served over https.
 */
export function checkAddress(input: string): AddressCheck {
  const typed = input.trim();
  if (!typed) return { ok: false, message: 'Type the address of your Wavelog, such as https://log.example.com.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, message: `${typed} is not a web address. Type it as https://log.example.com.` };
  }
  if (u.protocol === 'http:') return { ok: false, message: 'Use the https address of your Wavelog. Safari does not let RR73 use plain http.' };
  if (u.protocol !== 'https:' || !u.hostname.includes('.')) return { ok: false, message: `${typed} is not a web address. Type it as https://log.example.com.` };
  const path = u.pathname.replace(/\/api(\/.*)?$/i, '').replace(/\/+$/, '');
  return { ok: true, url: `${u.origin}${path}`, host: u.host };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Appended to failures the outbox retries by itself. */
const LATER = ' RR73 tries again later.';

// Plain-words messages, shared by Test connection and the outbox. `retrying` adds what the
// outbox does next.
export const say = {
  unreachable: (host: string, retrying = true) => `Could not reach Wavelog at ${host}. Check the address and that this phone is online.${retrying ? LATER : ''}`,
  timeout: (host: string, s: number, retrying = true) => `Wavelog at ${host} did not answer within ${s} s.${retrying ? LATER : ''}`,
  serverError: (host: string, status: number, retrying = true) => `Wavelog at ${host} had a server error (HTTP ${status}).${retrying ? LATER : ' Try again later.'}`,
  unreadable: (host: string, retrying = true) => `Wavelog at ${host} sent a reply RR73 cannot read.${retrying ? LATER : ' Try again later.'}`,
  rateLimited: (s: number, retrying = true) => `Wavelog asked RR73 to wait ${s} s before sending more.${retrying ? ' RR73 tries again then.' : ''}`,
  keyMissing: 'Paste the API key from the API page in Wavelog.',
  keyInvalid: 'Wavelog refused the API key: it is wrong or switched off. Copy a read-write key from the API page in Wavelog.',
  readOnly: 'Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.',
  stationGone: 'The station location no longer exists in Wavelog. Choose another in Settings.',
  noStation: 'Choose a Wavelog station location in Settings › Logging.',
  noStations: 'Wavelog has no station locations for this key. Create one in Wavelog, then test again.',
  notWavelog: (host: string) => `${host} does not answer as Wavelog. Check the address in Settings › Logging.`,
  badRequest: 'Wavelog could not read the request from RR73. Send it again; if it is refused again, export the QSO as ADIF and import it in Wavelog.',
  stationCall: (call: string, station: string, stationCall: string) =>
    `Wavelog refused the QSO: it was made as ${call} and the station location ${station} is for ${stationCall}. Choose a station location for ${call}.`,
  stationGrid: (grid: string, station: string, stationGrid: string) =>
    `Wavelog refused the QSO: its grid ${grid} is outside ${stationGrid}, the grid of the station location ${station}. Choose a station location for ${grid}.`,
  band: (band: string) => `Wavelog refused the QSO: ${band} is not in its band list. Add the band in Wavelog, then send the QSO again.`,
  other: (reason: string) => `Wavelog refused the QSO: “${reason}” Edit the QSO to send it again.`,
};

/** Wavelog's HTML-formatted reasons as one line of text. */
export function plainReason(messages: unknown): string {
  const list = Array.isArray(messages) ? messages : [messages];
  return list
    .filter((m): m is string => typeof m === 'string')
    .join(' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  // Some PHP setups print notices before the JSON; read from the first brace.
  const at = text.indexOf('{');
  if (at < 0) return null;
  try {
    const v: unknown = JSON.parse(text.slice(at));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** What is known about the QSO and its station location, for refusal messages. */
export interface SendContext {
  host: string;
  qso: Pick<Qso, 'id' | 'call' | 'stationCallsign' | 'myGridsquare' | 'band'>;
  station: WavelogStation | null;
  timeoutS: number;
  /** false for Test connection: the messages leave out what the outbox does next. */
  retrying?: boolean;
}

/** Duplicates are reported as "Date/Time: … Callsign: … Band: … Duplicate for …"; the first three labels are never translated. */
const DUPLICATE = /Date\/Time:.*Callsign:.*Band:/;

/** Maps Wavelog's answer to a POST /api/qso to a ledger receipt. */
export function mapQsoResponse(http: Http, ctx: SendContext): Receipt {
  const qsoId = ctx.qso.id;
  const retry = (message: string, timeout = false, retryAfterMs: number | null = null): Receipt => ({ qsoId, outcome: 'retry', message, timeout, retryAfterMs });
  const refuse = (message: string, fix: Extract<Receipt, { outcome: 'refused' }>['refusal']['fix'], scope: 'qso' | 'destination'): Receipt => ({
    qsoId,
    outcome: 'refused',
    message,
    refusal: { fix, scope },
  });
  const later = ctx.retrying ?? true;
  if (http.kind === 'network') return retry(say.unreachable(ctx.host, later));
  if (http.kind === 'timeout') return retry(say.timeout(ctx.host, ctx.timeoutS, later), true);

  const { status } = http;
  const body = parseJson(http.text);
  const reason = typeof body?.reason === 'string' ? body.reason.toLowerCase() : '';

  if (status === 201 && body?.status === 'created') return { qsoId, outcome: 'delivered', remoteRef: null, duplicate: false };
  if (reason.includes('write permission')) return refuse(say.readOnly, 'wavelog-key', 'destination');
  if (status === 401 && reason.includes('station')) return refuse(say.stationGone, 'wavelog-station', 'destination');
  if (status === 401 || status === 403) return refuse(say.keyInvalid, 'wavelog-key', 'destination');
  if (status === 429) {
    const s = typeof body?.retry_after === 'number' ? body.retry_after : Number(body?.retry_after) || 60;
    return retry(say.rateLimited(s, later), false, s * 1000);
  }
  if (status === 400 && body?.status === 'abort') {
    const text = plainReason(body.messages);
    if (DUPLICATE.test(text) || /duplicate/i.test(text)) return { qsoId, outcome: 'delivered', remoteRef: null, duplicate: true };
    const st = ctx.station;
    if (/differing station callsign/i.test(text)) return refuse(say.stationCall(ctx.qso.stationCallsign, st?.name ?? 'chosen', st?.callsign ?? 'another callsign'), 'wavelog-station', 'qso');
    if (/differing locator/i.test(text)) return refuse(say.stationGrid(ctx.qso.myGridsquare, st?.name ?? 'chosen', st?.grid ?? 'another grid'), 'wavelog-station', 'qso');
    if (/band configuration/i.test(text)) return refuse(say.band(ctx.qso.band), 'resend', 'qso');
    return refuse(say.other(text || 'no reason given.'), 'edit-qso', 'qso');
  }
  if (body?.status === 'failed' && reason.includes('json')) return refuse(say.badRequest, 'resend', 'qso');
  if (status === 404 || status === 405) return refuse(say.notWavelog(ctx.host), 'wavelog-address', 'destination');
  if (status >= 500) return retry(say.serverError(ctx.host, status, later));
  // A 2xx RR73 cannot read may still mean Wavelog stored the QSO: the next attempt may meet a duplicate.
  return retry(say.unreadable(ctx.host, later), true);
}

export type AuthResult = { kind: 'valid'; rights: 'r' | 'rw' } | { kind: 'invalid' } | { kind: 'failed'; message: string };

/** Reads GET /api/auth/<key>: Wavelog answers XML. */
export function mapAuth(http: Http, host: string, timeoutS: number): AuthResult {
  if (http.kind === 'network') return { kind: 'failed', message: say.unreachable(host, false) };
  if (http.kind === 'timeout') return { kind: 'failed', message: say.timeout(host, timeoutS, false) };
  const status = /<status>\s*([^<]*?)\s*<\/status>/i.exec(http.text)?.[1];
  const rights = /<rights>\s*([^<]*?)\s*<\/rights>/i.exec(http.text)?.[1];
  if (status?.toLowerCase() === 'valid' && (rights === 'r' || rights === 'rw')) return { kind: 'valid', rights };
  if (/key invalid|<auth>/i.test(http.text)) return { kind: 'invalid' };
  if (http.status >= 500) return { kind: 'failed', message: say.serverError(host, http.status, false) };
  return { kind: 'failed', message: say.notWavelog(host) };
}

/** Reads GET /api/station_info/<key>; null when the reply is not a station list. */
export function parseStations(text: string): WavelogStation[] | null {
  let v: unknown;
  try {
    v = JSON.parse(text.slice(Math.max(0, text.indexOf('['))));
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      id: str(s.station_id),
      name: str(s.station_profile_name) || `Station ${str(s.station_id)}`,
      callsign: str(s.station_callsign).toUpperCase(),
      grid: str(s.station_gridsquare).toUpperCase(),
      active: str(s.station_active) === '1',
    }))
    .filter((s) => s.id !== '');
}

export interface WavelogClient {
  host: string;
  auth(): Promise<AuthResult>;
  stations(): Promise<{ ok: true; stations: WavelogStation[] } | { ok: false; message: string }>;
  postAdif(stationId: string, adif: string, dryRun: boolean, timeoutMs?: number): Promise<Http>;
  version(): Promise<string | null>;
}

export function wavelogClient(url: string, apiKey: string, fetchFn: FetchLike, timeoutMs = TEST_TIMEOUT_MS): WavelogClient {
  const host = hostOf(url);
  const key = encodeURIComponent(apiKey.trim());
  const post = (path: string, body: unknown, t = timeoutMs) =>
    request(fetchFn, `${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) }, t);
  return {
    host,
    async auth() {
      return mapAuth(await request(fetchFn, `${url}/api/auth/${key}`, { method: 'GET' }, timeoutMs), host, timeoutMs / 1000);
    },
    async stations() {
      const http = await request(fetchFn, `${url}/api/station_info/${key}`, { method: 'GET' }, timeoutMs);
      if (http.kind !== 'response') return { ok: false, message: http.kind === 'timeout' ? say.timeout(host, timeoutMs / 1000, false) : say.unreachable(host, false) };
      if (http.status === 401) return { ok: false, message: say.keyInvalid };
      const stations = parseStations(http.text);
      return stations ? { ok: true, stations } : { ok: false, message: say.notWavelog(host) };
    },
    postAdif(stationId, adif, dryRun, t = timeoutMs) {
      return post(dryRun ? '/api/qso/true' : '/api/qso', { key: apiKey.trim(), station_profile_id: stationId, type: 'adif', string: adif }, t);
    },
    async version() {
      const http = await post('/api/version', { key: apiKey.trim() });
      if (http.kind !== 'response' || http.status !== 200) return null;
      const v = parseJson(http.text)?.version;
      return typeof v === 'string' ? v : null;
    },
  };
}

/** A record for the dry run: Wavelog parses it and stores nothing. */
export function dryRunAdif(now: number): string {
  const d = new Date(now).toISOString();
  return writeRecord({ CALL: 'RR73TEST', QSO_DATE: d.slice(0, 10).replace(/-/g, ''), TIME_ON: d.slice(11, 19).replace(/:/g, ''), BAND: '20m', MODE: 'FT8' });
}

/** The station location used when none is chosen: Wavelog's active one, else the first. */
export function defaultStation(stations: readonly WavelogStation[]): WavelogStation | null {
  return stations.find((s) => s.active) ?? stations[0] ?? null;
}

export interface TestResult extends WavelogTest {
  stations: WavelogStation[];
  /** The station location the dry run used. */
  stationId: string | null;
}

/**
 * Test connection: the address, the key and its rights (GET /api/auth), the station locations
 * (GET /api/station_info), a dry run of a QSO to the chosen station location (POST /api/qso/true,
 * which checks the write right, the station location and CORS for POST), then the version.
 */
export async function testConnection(cfg: Pick<WavelogConfig, 'url' | 'apiKey' | 'stationId'>, fetchFn: FetchLike, now: number): Promise<TestResult> {
  const fail = (message: string, extra: Partial<TestResult> = {}): TestResult => ({ at: now, ok: false, message, rights: null, version: null, stations: [], stationId: cfg.stationId, ...extra });
  const addr = checkAddress(cfg.url);
  if (!addr.ok) return fail(addr.message);
  if (!cfg.apiKey.trim()) return fail(say.keyMissing);
  const client = wavelogClient(addr.url, cfg.apiKey, fetchFn);

  const auth = await client.auth();
  if (auth.kind === 'failed') return fail(auth.message);
  if (auth.kind === 'invalid') return fail(say.keyInvalid);
  if (auth.rights === 'r') return fail(say.readOnly, { rights: 'r' });

  const list = await client.stations();
  if (!list.ok) return fail(list.message, { rights: auth.rights });
  if (!list.stations.length) return fail(say.noStations, { rights: auth.rights });
  const station = list.stations.find((s) => s.id === cfg.stationId) ?? defaultStation(list.stations)!;

  const dry = await client.postAdif(station.id, dryRunAdif(now), true);
  const r = mapQsoResponse(dry, { host: addr.host, qso: { id: 'test', call: 'RR73TEST', stationCallsign: station.callsign, myGridsquare: '', band: '20m' }, station, timeoutS: TEST_TIMEOUT_MS / 1000, retrying: false });
  const extra = { rights: auth.rights, stations: list.stations, stationId: station.id };
  if (r.outcome === 'refused') return fail(r.message, extra);
  if (r.outcome === 'retry') return fail(r.message, extra);

  const version = await client.version();
  return { at: now, ok: true, message: 'Can read and write', version, ...extra };
}

/** The outbox's view of Wavelog: sends each QSO to the station location chosen for it. */
export function wavelogDestination(cfg: WavelogConfig, stationFor: (q: Qso) => string | null, fetchFn: FetchLike): SendingDestination {
  const host = hostOf(cfg.url);
  const client = wavelogClient(cfg.url, cfg.apiKey, fetchFn, SEND_TIMEOUT_MS);
  return {
    id: 'wavelog',
    async send(qsos) {
      const out: Receipt[] = [];
      for (const q of qsos) {
        const stationId = stationFor(q);
        if (!stationId) {
          out.push({ qsoId: q.id, outcome: 'refused', message: say.noStation, refusal: { fix: 'wavelog-station', scope: 'qso' } });
          continue;
        }
        const station = cfg.stations.find((s) => s.id === stationId) ?? null;
        const http = await client.postAdif(stationId, writeRecord(qsoToRecord(q)), false);
        out.push(mapQsoResponse(http, { host, qso: q, station, timeoutS: SEND_TIMEOUT_MS / 1000 }));
      }
      return out;
    },
  };
}
