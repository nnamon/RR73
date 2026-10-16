// A log to seed into IndexedDB for the Log, Activate and Logging screens, built with the app's own
// QSO and ledger code, and a mock Wavelog served by route interception. Nothing here reaches a
// real Wavelog: every request to the mock address is answered by the test.
import type { Page, Route } from '@playwright/test';
import { applyReceipt, markSubmitted, reconcile, type DestinationFacts } from '../src/lib/log/ledger';
import { SEND_AUTOMATICALLY_OFF } from '../src/lib/log/migrations';
import { createQso } from '../src/lib/log/qso';
import type { Activation, DestinationConfig, LedgerEntry, LogQsoRecord, Qso, WavelogConfig } from '../src/lib/log/types';
import type { Features } from '../src/lib/state/settings.svelte';
import { FIXED_TIME } from './time';
import { stubSpotSources } from './spot-sources';

export const WAVELOG_URL = 'https://wavelog.example.test';
export const API_KEY = 'test-key-rw';

export const STATIONS = [
  { station_id: '1', station_profile_name: 'Home', station_callsign: '9V1NE', station_gridsquare: 'OJ11', station_active: '1' },
  { station_id: '7', station_profile_name: 'VK3 portable', station_callsign: 'VK3/9V1NE', station_gridsquare: 'QF22', station_active: null },
];

export interface Seed {
  qsos: Qso[];
  ledger: LedgerEntry[];
  activations: Activation[];
  destinations: DestinationConfig[];
  kv: { key: string; value: unknown }[];
}

const MIN = 60_000;
const DAY = 86_400_000;

export const WAVELOG: WavelogConfig = {
  id: 'wavelog',
  kind: 'wavelog',
  enabled: true,
  url: WAVELOG_URL,
  apiKey: API_KEY,
  stationId: '1',
  stations: STATIONS.map((s) => ({ id: s.station_id, name: s.station_profile_name, callsign: s.station_callsign, grid: s.station_gridsquare, active: s.station_active === '1' })),
  lastTest: { at: FIXED_TIME - 25 * MIN, ok: true, message: 'Can read and write', rights: 'rw', version: '2.1' },
  readWorked: false,
};

const FACTS: Record<string, DestinationFacts> = {
  wavelog: { id: 'wavelog', name: 'Wavelog', transport: 'direct', active: true, canUpdate: false },
  'pota-file': { id: 'pota-file', name: 'POTA', transport: 'file', active: true, canUpdate: false },
  'sota-file': { id: 'sota-file', name: 'SOTA', transport: 'file', active: true, canUpdate: false },
  'wwff-file': { id: 'wwff-file', name: 'WWFF', transport: 'file', active: true, canUpdate: false },
};

let n = 0;
function qso(call: string, at: number, extra: Partial<LogQsoRecord>, a: Activation | null): Qso {
  const r: LogQsoRecord = { call, mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: at - 45_000, endUtcMs: at, reportSent: -12, reportRcvd: -10, ...extra };
  return createQso(r, { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, now: at, activation: a, callsign: '9V1NE' });
}

function entries(q: Qso, a: Activation | null, wavelog: 'not-sent' | 'delivered' | 'refused' | null): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const f of Object.values(FACTS)) {
    if (f.id === 'wavelog' && !wavelog) continue;
    let e = reconcile({ entry: null, dest: f, qso: q, activation: a, sendEdits: true, sendAutomatically: false, now: q.createdAt })!;
    if (f.id === 'wavelog' && wavelog === 'delivered') e = applyReceipt(e, { qsoId: q.id, outcome: 'delivered', remoteRef: null, duplicate: false }, q.updatedAt, q.createdAt + 12_000, 0);
    if (f.id === 'wavelog' && wavelog === 'refused')
      e = applyReceipt(
        e,
        { qsoId: q.id, outcome: 'refused', message: 'Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.', refusal: { fix: 'wavelog-key', scope: 'destination' } },
        q.updatedAt,
        q.createdAt + 12_000,
        0,
      );
    out.push(e);
  }
  return out;
}

/** Wavelog set up, with no QSOs yet. Send automatically is off unless asked for. */
export function wavelogOnly(opts: { sendAutomatically?: boolean } = {}): Seed {
  return {
    qsos: [],
    ledger: [],
    activations: [],
    destinations: [WAVELOG],
    kv: [
      { key: 'logging', value: { sendAutomatically: opts.sendAutomatically ?? false, sendEdits: true } },
      { key: 'settings', value: { callsign: '9V1NE' } },
      { key: 'migrations', value: [SEND_AUTOMATICALLY_OFF] },
    ],
  };
}

/** The log in the approved mockup: four QSOs today, one ended activation on 11 October. */
export function mockupLog(opts: { running?: boolean; stationRefusal?: boolean } = {}): Seed {
  n = 0;
  const day1 = FIXED_TIME - 2 * DAY;
  const act: Activation = {
    id: 'act-vk3',
    refs: [
      { programme: 'POTA', ref: 'VK-0921' },
      { programme: 'SOTA', ref: 'VK3/VC-012' },
    ],
    callsign: 'VK3/9V1NE',
    operator: '9V1NE',
    grid: 'QF22lb',
    gridSource: 'gps',
    wavelogStationId: '7',
    startedAt: day1 - 60 * MIN,
    endedAt: day1,
    updatedAt: day1,
  };
  const actQsos = [
    ['VK2ESN', -40, '20m', 'QF56', -12, -10],
    ['ZL1TQK', -35, '20m', 'RF72', -8, -11],
    ['VK3ARR', -27, '40m', 'QF22', 2, -3],
    ['JH1RRT', -21, '20m', 'PM95', -15, -17],
    ['VK4TMZ', -15, '20m', 'QG62', -9, -14],
    ['VK5PAS', -10, '40m', 'PF95', -6, -7],
    ['ZL2AB', -4, '20m', 'RE78', -13, -12],
  ] as const;
  const qa = actQsos.map(([call, m, band, grid, s, r]) => qso(call, day1 + m * MIN, { band, dialHz: band === '40m' ? 7_074_000 : 14_074_000, grid, reportSent: s, reportRcvd: r }, act));
  const ledger: LedgerEntry[] = [];
  for (const q of qa) {
    for (let e of entries(q, act, 'delivered')) {
      if (e.destinationId === 'sota-file') e = markSubmitted(e, e.parts[0].key, q, FIXED_TIME - DAY);
      ledger.push(e);
    }
  }
  const today = [
    qso('VK2ESN', FIXED_TIME - 2 * MIN, { grid: 'QF56', dialHz: 14_074_000, audioHz: 2010 }, null),
    qso('JA1KXM', FIXED_TIME - 9 * MIN, { grid: 'PM95', reportSent: -14, reportRcvd: -9, audioHz: 1180 }, null),
    qso('9M2TRX', FIXED_TIME - 23 * MIN, { mode: 'FT4', dialHz: 14_080_000, audioHz: 1200, grid: 'OJ02', reportSent: -4, reportRcvd: -7 }, null),
    qso('YB0AZK', FIXED_TIME - 52 * MIN, { band: '30m', dialHz: 10_136_000, audioHz: 1100, grid: 'OI33', reportSent: -11, reportRcvd: -13 }, null),
  ];
  ledger.push(...entries(today[0], null, 'not-sent'), ...entries(today[1], null, 'delivered'), ...entries(today[2], null, 'delivered'), ...entries(today[3], null, 'refused'));
  if (opts.stationRefusal) {
    const e = ledger.find((x) => x.qsoId === today[3].id && x.destinationId === 'wavelog')!;
    e.lastError = 'Wavelog refused the QSO: it was made as 9V1NE and the station location VK3 portable is for VK3/9V1NE. Choose a station location for 9V1NE.';
    e.refusal = { fix: 'wavelog-station', scope: 'qso' };
  }
  const activations = [act];
  const qsos = [...qa, ...today];
  if (opts.running) {
    const live: Activation = { ...act, id: 'act-live', startedAt: FIXED_TIME - 42 * MIN, endedAt: null, updatedAt: FIXED_TIME - 42 * MIN };
    const lq = [
      qso('JH1RRT', FIXED_TIME - 41 * MIN, { grid: 'PM95', reportSent: -15, reportRcvd: -17 }, live),
      qso('VK3ARR', FIXED_TIME - 35 * MIN, { band: '40m', dialHz: 7_074_000, grid: 'QF22', reportSent: 2, reportRcvd: -3 }, live),
      qso('ZL1TQK', FIXED_TIME - 27 * MIN, { grid: 'RF72', reportSent: -8, reportRcvd: -11 }, live),
      qso('VK4TMZ', FIXED_TIME - 20 * MIN, { reportSent: -9, reportRcvd: -14 }, live),
      qso('VK5PAS', FIXED_TIME - 15 * MIN, { band: '40m', dialHz: 7_074_000, reportSent: -6, reportRcvd: -7 }, live),
      qso('ZL2AB', FIXED_TIME - 9 * MIN, { reportSent: -13, reportRcvd: -12 }, live),
      qso('VK2ESN', FIXED_TIME - 3 * MIN, { grid: 'QF56', reportSent: -12, reportRcvd: -10 }, live),
    ];
    for (const q of lq) ledger.push(...entries(q, live, 'not-sent'));
    activations.push(live);
    qsos.push(...lq);
  }
  return {
    qsos,
    ledger,
    activations,
    destinations: [WAVELOG],
    kv: [
      { key: 'logging', value: { sendAutomatically: false, sendEdits: true } },
      { key: 'settings', value: { callsign: '9V1NE' } },
      { key: 'migrations', value: [SEND_AUTOMATICALLY_OFF] },
    ],
  };
}

/** Nothing stored: a seed to add features to. */
export function emptySeed(): Seed {
  return { qsos: [], ledger: [], activations: [], destinations: [], kv: [] };
}

/** The seed with optional features turned on (Settings › Optional features), the rest off. */
export function withFeatures(data: Seed, on: Partial<Features>): Seed {
  const prev = (data.kv.find((k) => k.key === 'settings')?.value ?? {}) as Record<string, unknown>;
  const features: Features = { activations: false, potaSpots: false, clusterSpots: false, ...on };
  return { ...data, kv: [...data.kv.filter((k) => k.key !== 'settings'), { key: 'settings', value: { ...prev, features, schema: 2 } }] };
}

/**
 * Writes a seed into the app's IndexedDB, then reloads so the app reads it. The spot sources get
 * their stand-ins first, since a seed may turn them on.
 */
export async function seed(page: Page, data: Seed) {
  await stubSpotSources(page);
  await page.locator('main h1').first().waitFor({ state: 'attached' });
  await page.evaluate(async (d) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('rr73');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(['qsos', 'ledger', 'activations', 'destinations', 'kv'], 'readwrite');
    for (const q of d.qsos) tx.objectStore('qsos').put(q);
    for (const e of d.ledger) tx.objectStore('ledger').put(e);
    for (const a of d.activations) tx.objectStore('activations').put(a);
    for (const x of d.destinations) tx.objectStore('destinations').put(x);
    for (const k of d.kv) tx.objectStore('kv').put(k);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
  await page.reload();
  await page.locator('main h1').first().waitFor({ state: 'attached' });
}

/** A QSO in the mock Wavelog's log, as get_contacts_adif serves it, with its primary key and station location. */
export interface MockContact {
  id: number;
  station: string;
  CALL: string;
  BAND: string;
  MODE: string;
  SUBMODE: string;
  GRIDSQUARE: string;
}

export interface MockWavelog {
  requests: { method: string; path: string; body: Record<string, unknown> | null }[];
  /** The answer to POST /api/qso, from the request body; tests swap it. */
  qso: (body: Record<string, unknown>) => { status: number; body: unknown };
  rights: 'r' | 'rw' | 'invalid';
  /** The log POST /api/get_contacts_adif reads from. */
  contacts: MockContact[];
  /** Adds a QSO to the log at station location `station`. */
  add(call: string, band?: string, mode?: string, submode?: string, grid?: string, station?: string): MockContact;
}

/**
 * Wavelog's answer to POST /api/get_contacts_adif, as Api.php 3.2.4 gives it: the QSOs of the
 * station locations with an id above fetchfromid, lowest first, up to the limit, rows equal in
 * every field once per reply, and "No new QSOs available." when there are none.
 */
function contactsReply(mock: MockWavelog, body: Record<string, unknown>): { status: number; body: unknown } {
  if (body.key !== API_KEY || mock.rights === 'invalid') return { status: 401, body: { status: 'failed', reason: 'missing api key' } };
  const ids = (Array.isArray(body.station_id) ? body.station_id : [body.station_id]).map(String);
  if (ids.some((id) => !STATIONS.some((s) => s.station_id === id))) return { status: 401, body: { status: 'failed', reason: 'Station ID not accessible for this API key' } };
  const from = Number(body.fetchfromid);
  const fields = (body.fields as string[]) ?? ['CALL'];
  const picked = mock.contacts
    .filter((c) => ids.includes(c.station) && c.id > from)
    .sort((a, b) => a.id - b.id)
    .slice(0, Number(body.limit ?? 20000));
  if (!picked.length) return { status: 200, body: { status: 'successful', message: 'No new QSOs available.', lastfetchedid: from, exported_qsos: 0, adif: null } };
  const seen = new Set<string>();
  const qsos = [];
  for (const c of picked) {
    const row = Object.fromEntries(fields.map((f) => [f, (c as unknown as Record<string, string>)[f] ?? '']));
    const k = fields.map((f) => row[f]).join('|');
    if (!seen.has(k)) qsos.push(row);
    seen.add(k);
  }
  // PHP sends the primary key from the database as a numeric string.
  return { status: 200, body: { status: 'successful', message: 'Export successful', lastfetchedid: String(picked.at(-1)!.id), exported_records: qsos.length, qsos } };
}

/** A mock Wavelog at WAVELOG_URL, answering as Wavelog's Api.php does, with CORS headers. */
export async function mockWavelog(page: Page): Promise<MockWavelog> {
  let id = 100;
  const mock: MockWavelog = {
    requests: [],
    qso: () => ({ status: 201, body: { status: 'created', adif_count: 1, adif_errors: 0, messages: [''] } }),
    rights: 'rw',
    contacts: [],
    add(call, band = '20m', mode = 'FT8', submode = '', grid = '', station = '1') {
      const c = { id: id++, station, CALL: call, BAND: band, MODE: mode, SUBMODE: submode, GRIDSQUARE: grid };
      mock.contacts.push(c);
      return c;
    },
  };
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(`${WAVELOG_URL}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const raw = req.postData();
    mock.requests.push({ method: req.method(), path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null });
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { ...cors, 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'Content-Type' } });
    if (path.startsWith('/api/auth/')) {
      const body = mock.rights === 'invalid' ? '<auth><message>Key Invalid - either not found or disabled</message></auth>' : `<auth><status>Valid</status><rights>${mock.rights}</rights></auth>`;
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/xml' }, body });
    }
    if (path.startsWith('/api/station_info/')) return json(200, STATIONS);
    if (path === '/api/qso/true') return mock.rights === 'r' ? json(403, { status: 'failed', reason: 'API key does not have write permissions' }) : json(201, { status: 'created', adif_count: 0, adif_errors: 0, messages: ['Dryrun works'] });
    if (path === '/api/version') return json(200, { status: 'ok', version: '2.1' });
    if (path === '/api/qso') {
      const r = mock.qso(mock.requests.at(-1)?.body ?? {});
      return json(r.status, r.body);
    }
    if (path === '/api/get_contacts_adif' && req.method() === 'POST') {
      const r = contactsReply(mock, mock.requests.at(-1)?.body ?? {});
      return json(r.status, r.body);
    }
    return route.fulfill({ status: 404, headers: cors, body: 'Not found' });
  });
  return mock;
}
