import { describe, expect, it } from 'vitest';
import { say, type FetchLike } from './wavelog';
import type { Clock } from './outbox';
import {
  CHECK_EVERY_MS,
  FIELDS,
  FULL_EVERY_MS,
  KICK_GAP_MS,
  PAGE_LIMIT,
  WORKED_OFF,
  WorkedSync,
  mapContacts,
  sayRead,
  sourceOf,
  type StoredWorked,
  type WorkedStatus,
  type WorkedStore,
} from './wavelog-worked';
import type { WorkedKeys } from './worked';

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const URL_ = 'https://wavelog.example.test';
const SRC = { url: URL_, apiKey: 'test-key-rw' };
const MIN = 60_000;

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}

class FakeClock implements Clock {
  t = T0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  idle: () => Promise<void> = settle;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  /** Moves time forward, firing timers in order and letting each read finish. */
  async advance(ms: number) {
    const end = this.t + ms;
    await this.idle();
    for (;;) {
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = next.at;
      next.fn();
      await this.idle();
    }
    this.t = end;
    await this.idle();
  }
}

interface Row {
  id: number;
  station: string;
  CALL: string;
  BAND: string;
  MODE: string;
  SUBMODE: string;
  GRIDSQUARE: string;
}

type Answer = { status: number; body: unknown } | 'network';

/**
 * Wavelog's API as Api.php 3.2.4 answers it, in memory: station_info, version and
 * get_contacts_adif with its paging, its per-reply removal of equal rows and its "No new QSOs".
 * Before 3.0.0, a list in station_id is refused as a station the key cannot read.
 */
class FakeWavelog {
  rows: Row[] = [];
  stations = ['1'];
  version = '3.2.4';
  key = SRC.apiKey;
  /** lastfetchedid as a numeric string, as PHP may send it. */
  stringIds = false;
  /** Answers for get_contacts_adif ahead of the normal one, in order. */
  queued: Answer[] = [];
  requests: { path: string; body: Record<string, unknown> | null; init: RequestInit }[] = [];
  private nextId = 1000;

  add(call: string, band = '20m', mode = 'FT8', submode = '', grid = '', station = '1'): Row {
    const r = { id: this.nextId++, station, CALL: call, BAND: band, MODE: mode, SUBMODE: submode, GRIDSQUARE: grid };
    this.rows.push(r);
    return r;
  }

  contacts() {
    return this.requests.filter((r) => r.path === '/api/get_contacts_adif');
  }

  fetch: FetchLike = async (input, init) => {
    const u = new URL(input);
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    this.requests.push({ path: u.pathname.startsWith('/api/station_info/') ? '/api/station_info' : u.pathname, body, init });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname.startsWith('/api/station_info/')) {
      if (decodeURIComponent(u.pathname.split('/').pop() ?? '') !== this.key) return json(401, { status: 'failed', reason: 'missing api key' });
      return json(
        200,
        this.stations.map((id) => ({ station_id: id, station_profile_name: `Station ${id}`, station_callsign: '9V1NE', station_gridsquare: 'OJ11', station_active: id === '1' ? '1' : null })),
      );
    }
    if (u.pathname === '/api/version') return json(200, { status: 'ok', version: this.version });
    if (u.pathname !== '/api/get_contacts_adif') return new Response('Not found', { status: 404 });
    const q = this.queued.shift();
    if (q === 'network') throw new TypeError('Failed to fetch');
    if (q) return json(q.status, q.body);
    if (body?.key !== this.key) return json(401, { status: 'failed', reason: 'missing api key' });
    const ids = Array.isArray(body.station_id) ? (body.station_id as string[]) : [body.station_id as string];
    if ((Array.isArray(body.station_id) && Number(this.version.split('.')[0]) < 3) || ids.some((id) => !this.stations.includes(String(id)))) {
      return json(401, { status: 'failed', reason: 'Station ID not accessible for this API key' });
    }
    const from = Number(body.fetchfromid);
    const limit = Number(body.limit ?? 20000);
    const fields = body.fields as string[];
    const picked = this.rows
      .filter((r) => ids.includes(r.station) && r.id > from)
      .sort((a, b) => a.id - b.id)
      .slice(0, limit);
    if (!picked.length) return json(200, { status: 'successful', message: 'No new QSOs available.', lastfetchedid: from, exported_qsos: 0, adif: null });
    const seen = new Set<string>();
    const qsos: Record<string, string>[] = [];
    for (const r of picked) {
      const out = Object.fromEntries(fields.map((f) => [f, (r as unknown as Record<string, string>)[f] ?? ''])) as Record<string, string>;
      const k = fields.map((f) => out[f]).join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      qsos.push(out);
    }
    const last = Math.max(from, ...picked.map((r) => r.id));
    return json(200, { status: 'successful', message: 'Export successful', lastfetchedid: this.stringIds ? String(last) : last, exported_records: qsos.length, qsos });
  };
}

class MemoryStore implements WorkedStore {
  data: StoredWorked | null = null;
  keyWrites = 0;
  async load() {
    return this.data ? (JSON.parse(JSON.stringify(this.data)) as StoredWorked) : null;
  }
  async save(d: StoredWorked, keys: boolean) {
    if (keys) this.keyWrites++;
    this.data = { meta: JSON.parse(JSON.stringify(d.meta)), calls: keys ? [...d.calls] : (this.data?.calls ?? []), grids: keys ? [...d.grids] : (this.data?.grids ?? []) };
  }
  async clear() {
    this.data = null;
  }
}

function harness(opts: { store?: MemoryStore; server?: FakeWavelog; clock?: FakeClock } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const server = opts.server ?? new FakeWavelog();
  const store = opts.store ?? new MemoryStore();
  const h = {
    clock,
    server,
    store,
    keys: null as WorkedKeys | null,
    status: WORKED_OFF as WorkedStatus,
    online: true,
    visible: true,
    sync: null as unknown as WorkedSync,
    /** The keys held, sorted. */
    calls(): string[] {
      return [...(h.keys?.calls ?? [])].sort();
    },
  };
  h.sync = new WorkedSync({
    clock,
    // Late bound, so a test can wrap the server's fetch.
    fetch: (input, init) => server.fetch(input, init),
    online: () => h.online,
    visible: () => h.visible,
    store,
    onKeys: (k) => (h.keys = k),
    onStatus: (s) => (h.status = s),
  });
  clock.idle = async () => {
    await settle();
    await h.sync.idle();
    await settle();
  };
  return h;
}

/** Starts reading and waits for the first read to end. */
async function started(h: ReturnType<typeof harness>, src = SRC) {
  await h.sync.use(src);
  await h.clock.idle();
}

const fromIds = (h: ReturnType<typeof harness>) => h.server.contacts().map((r) => r.body?.fetchfromid);

describe('mapContacts', () => {
  const ok = (body: unknown, status = 200) => ({ kind: 'response' as const, status, text: JSON.stringify(body) });

  it('reads rows and a numeric string last id', () => {
    expect(mapContacts(ok({ status: 'successful', message: 'Export successful', lastfetchedid: '12345', exported_records: 1, qsos: [{ CALL: 'K1ABC' }] }), 'h')).toEqual({ kind: 'rows', rows: [{ CALL: 'K1ABC' }], lastId: 12345 });
  });

  it('stops on "No new QSOs available."', () => {
    expect(mapContacts(ok({ status: 'successful', message: 'No new QSOs available.', lastfetchedid: 7, exported_qsos: 0, adif: null }), 'h')).toEqual({ kind: 'done' });
  });

  it('waits as long as Wavelog asks on 429, or 60 s when it does not say', () => {
    expect(mapContacts(ok({ status: 'failed', reason: 'Rate limit exceeded. Try again in 90 seconds.', retry_after: 90 }, 429), 'h')).toEqual({ kind: 'retry', message: sayRead.rateLimited(90), retryAfterMs: 90_000 });
    expect(mapContacts(ok({ status: 'failed', retry_after: '45' }, 429), 'h')).toMatchObject({ retryAfterMs: 45_000 });
    expect(mapContacts(ok({}, 429), 'h')).toMatchObject({ retryAfterMs: 60_000 });
  });

  it('tells a refused key from a station location the key cannot read', () => {
    expect(mapContacts(ok({ status: 'failed', reason: 'missing api key' }, 401), 'h')).toEqual({ kind: 'refused', message: say.keyInvalid });
    expect(mapContacts(ok({ status: 'failed', reason: 'Station ID not accessible for this API key' }, 401), 'h')).toEqual({ kind: 'stations' });
    expect(mapContacts(ok({}, 403), 'h')).toEqual({ kind: 'refused', message: say.keyInvalid });
  });

  it('says reading needs Wavelog 2.5.1 or later for a request it refuses, an ADIF reply or no connection', () => {
    expect(mapContacts(ok({ status: 'failed', reason: 'Invalid output_format. Use "adif" or "json"' }, 400), 'log.example.com')).toEqual({ kind: 'refused', message: sayRead.tooOld('log.example.com') });
    expect(mapContacts(ok({ status: 'successful', message: 'Export successful', lastfetchedid: 9, exported_qsos: 1, adif: '<CALL:5>K1ABC<eor>' }), 'h')).toEqual({ kind: 'refused', message: sayRead.tooOld('h') });
    const net = mapContacts({ kind: 'network' }, 'log.example.com');
    expect(net).toEqual({ kind: 'retry', message: sayRead.unreachable('log.example.com'), retryAfterMs: 0 });
    expect(sayRead.unreachable('log.example.com')).toBe('Could not reach Wavelog at log.example.com. Check that this phone is online. Reading the log needs Wavelog 2.5.1 or later. RR73 tries again later.');
  });

  it('retries server errors, timeouts and replies it cannot read', () => {
    expect(mapContacts(ok({}, 502), 'h')).toEqual({ kind: 'retry', message: say.serverError('h', 502), retryAfterMs: 0 });
    expect(mapContacts({ kind: 'timeout' }, 'h')).toEqual({ kind: 'retry', message: say.timeout('h', 30), retryAfterMs: 0 });
    expect(mapContacts({ kind: 'response', status: 200, text: '<html>' }, 'h')).toEqual({ kind: 'retry', message: say.unreadable('h'), retryAfterMs: 0 });
    expect(mapContacts(ok({}, 404), 'h')).toEqual({ kind: 'refused', message: say.notWavelog('h') });
  });
});

describe('reading Wavelog’s log', () => {
  it('asks for the fields the colours need, as a simple request with credentials left out', async () => {
    const h = harness();
    h.server.add('JA1KXM', '20m', 'FT8', '', 'PM95');
    await started(h);
    const r = h.server.contacts()[0];
    expect(r.init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    expect(r.body).toEqual({ key: SRC.apiKey, station_id: '1', fetchfromid: 0, limit: PAGE_LIMIT, output_format: 'json', fields: [...FIELDS] });
    expect(FIELDS).toEqual(['CALL', 'BAND', 'MODE', 'SUBMODE', 'GRIDSQUARE']);
    expect(h.calls()).toEqual(['JA1KXM 20m FT8']);
    expect([...(h.keys?.grids ?? [])]).toEqual(['PM95 20m']);
  });

  it('reads page after page until Wavelog has no newer QSOs', async () => {
    const h = harness();
    for (let i = 0; i < 12_001; i++) h.server.add(`W${i}X`, '20m', 'FT8');
    await started(h);
    const last = h.server.rows.at(-1)!.id;
    expect(fromIds(h)).toEqual([0, h.server.rows[4999].id, h.server.rows[9999].id, last]);
    expect(h.keys?.calls.size).toBe(12_001);
    expect(h.store.data?.meta.cursors).toEqual([{ stations: ['1'], lastId: last }]);
    expect(h.status).toMatchObject({ on: true, reading: false, stations: 12_001, checkedAt: T0, fullAt: T0, error: null });
  });

  it('reads a numeric string last id', async () => {
    const h = harness();
    h.server.stringIds = true;
    for (let i = 0; i < 5_001; i++) h.server.add(`W${i}X`);
    await started(h);
    expect(fromIds(h)).toEqual([0, h.server.rows[4999].id, h.server.rows[5000].id]);
    expect(h.keys?.calls.size).toBe(5_001);
  });

  it('goes on after a reply with fewer rows than asked for: Wavelog sends equal rows once', async () => {
    const h = harness();
    for (let i = 0; i < PAGE_LIMIT; i++) h.server.add('JA1KXM', '20m', 'FT8', '', 'PM95');
    h.server.add('K1ABC');
    await started(h);
    expect(h.server.contacts()).toHaveLength(3);
    expect(h.calls()).toEqual(['JA1KXM 20m FT8', 'K1ABC 20m FT8']);
  });

  it('stops when the last id stops moving', async () => {
    const h = harness();
    const stuck = { status: 200, body: { status: 'successful', message: 'Export successful', lastfetchedid: '42', exported_records: 1, qsos: [{ CALL: 'K1ABC', BAND: '20m', MODE: 'FT8', SUBMODE: '', GRIDSQUARE: '' }] } };
    h.server.queued = [stuck, stuck, stuck, stuck];
    await started(h);
    expect(fromIds(h)).toEqual([0, 42]);
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
    expect(h.status.error).toBeNull();
  });

  it('reads every station location in one request on Wavelog 3.0.0 and later, and one each before', async () => {
    for (const [version, ids] of [
      ['3.0.0', [['1', '7']]],
      ['2.5.1', ['1', '7']],
    ] as const) {
      const h = harness();
      h.server.version = version;
      h.server.stations = ['1', '7'];
      h.server.add('JA1KXM', '20m', 'FT8', '', '', '1');
      h.server.add('VK2ESN', '40m', 'FT8', '', '', '7');
      await started(h);
      expect(
        h.server
          .contacts()
          .map((r) => r.body?.station_id)
          .filter((v, i, a) => a.findIndex((x) => JSON.stringify(x) === JSON.stringify(v)) === i),
        version,
      ).toEqual(ids);
      expect(h.calls(), version).toEqual(['JA1KXM 20m FT8', 'VK2ESN 40m FT8']);
    }
  });

  it('waits as long as Wavelog asks on 429, then goes on from the last id read', async () => {
    const h = harness();
    for (let i = 0; i < 6_000; i++) h.server.add(`W${i}X`);
    const fetch = h.server.fetch;
    let n = 0;
    h.server.fetch = async (input, init) => {
      if (input.endsWith('/api/get_contacts_adif') && ++n === 2) return new Response(JSON.stringify({ status: 'failed', reason: 'Rate limit exceeded. Try again in 90 seconds.', retry_after: 90 }), { status: 429 });
      return fetch(input, init);
    };
    const g = h;
    await started(g);
    expect(g.keys).toBeNull();
    expect(g.status.error).toBe(sayRead.rateLimited(90));
    // The second request met the limit; the wrapper answered it, so the server did not log it.
    const page2 = g.server.rows[4999].id;
    expect(n).toBe(2);
    expect(fromIds(g)).toEqual([0]);
    await g.clock.advance(89_000);
    expect(n).toBe(2);
    await g.clock.advance(1_000);
    expect(fromIds(g)).toEqual([0, page2, g.server.rows.at(-1)!.id]);
    expect(g.keys?.calls.size).toBe(6_000);
    expect(g.status.error).toBeNull();
  });

  it('waits 30 s after a failure, doubling, and reads at once when the phone comes online', async () => {
    const h = harness();
    h.server.add('K1ABC');
    h.server.queued = [{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }];
    await started(h);
    expect(h.status.error).toBe(say.serverError('wavelog.example.test', 500));
    expect(h.server.contacts()).toHaveLength(1);
    await h.clock.advance(29_000);
    expect(h.server.contacts()).toHaveLength(1);
    await h.clock.advance(1_000);
    expect(h.server.contacts()).toHaveLength(2);
    await h.clock.advance(59_000);
    expect(h.server.contacts()).toHaveLength(2);
    await h.clock.advance(1_000);
    expect(h.server.contacts()).toHaveLength(3);
    h.sync.online();
    await h.clock.idle();
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
    expect(h.status.error).toBeNull();
  });

  it('says reading needs Wavelog 2.5.1 or later when the request fails as CORS does, and tries again', async () => {
    const h = harness();
    h.server.add('K1ABC');
    h.server.queued = ['network'];
    await started(h);
    expect(h.status.error).toBe(sayRead.unreachable('wavelog.example.test'));
    await h.clock.advance(30_000);
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
  });

  it('stops after Wavelog refuses the key, until Refresh from Wavelog', async () => {
    const h = harness();
    h.server.add('K1ABC');
    h.server.key = 'another-key';
    await started(h);
    expect(h.status.error).toBe(say.keyInvalid);
    const before = h.server.requests.length;
    await h.clock.advance(FULL_EVERY_MS);
    expect(h.server.requests.length).toBe(before);
    h.server.key = SRC.apiKey;
    await h.sync.refresh();
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
    expect(h.status.error).toBeNull();
  });

  it('stops after a refusal of the request, saying Wavelog needs 2.5.1 or later', async () => {
    const h = harness();
    h.server.queued = [{ status: 400, body: { status: 'failed', reason: 'Invalid output_format. Use "adif" or "json"' } }];
    await started(h);
    expect(h.status.error).toBe(sayRead.tooOld('wavelog.example.test'));
    const before = h.server.requests.length;
    await h.clock.advance(60 * MIN);
    expect(h.server.requests.length).toBe(before);
  });

  it('reads nothing while the phone is offline, says so, and reads when it comes online', async () => {
    const h = harness();
    h.server.add('K1ABC');
    h.online = false;
    await started(h);
    expect(h.server.requests).toEqual([]);
    expect(h.status.error).toBe(sayRead.offline);
    await h.clock.advance(60 * MIN);
    expect(h.server.requests).toEqual([]);
    h.online = true;
    h.sync.online();
    await h.clock.idle();
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
  });

  it('checks for new QSOs from the last id every 5 minutes, and after an upload at most every 2 minutes', async () => {
    const h = harness();
    h.server.add('K1ABC');
    await started(h);
    const last = h.server.rows[0].id;
    expect(h.server.contacts()).toHaveLength(2);
    h.server.add('ZL2AB', '40m', 'MFSK', 'FT4', 'RE78');
    // An upload 30 s after the read: the check waits until 2 min after the read.
    await h.clock.advance(30_000);
    h.sync.kick();
    await h.clock.advance(KICK_GAP_MS - 30_000 - 1);
    expect(h.server.contacts()).toHaveLength(2);
    await h.clock.advance(1);
    expect(fromIds(h).slice(2)).toEqual([last, h.server.rows[1].id]);
    expect(h.calls()).toEqual(['K1ABC 20m FT8', 'ZL2AB 40m FT4']);
    // Then every 5 minutes, one request when nothing is new, writing no keys.
    const writes = h.store.keyWrites;
    await h.clock.advance(CHECK_EVERY_MS);
    expect(h.server.contacts()).toHaveLength(5);
    expect(h.store.keyWrites).toBe(writes);
    expect(h.server.requests.filter((r) => r.path === '/api/station_info')).toHaveLength(1);
  });

  it('waits for RR73 to come back on screen for the 5-minute check', async () => {
    const h = harness();
    h.server.add('K1ABC');
    await started(h);
    h.visible = false;
    await h.clock.advance(3 * CHECK_EVERY_MS);
    expect(h.server.contacts()).toHaveLength(2);
    h.visible = true;
    h.sync.kick();
    await h.clock.idle();
    expect(h.server.contacts()).toHaveLength(3);
  });

  it('reads in full after a week, which drops QSOs deleted in Wavelog', async () => {
    const h = harness();
    h.server.add('K1ABC');
    const gone = h.server.add('JA1KXM');
    await started(h);
    h.server.rows = h.server.rows.filter((r) => r !== gone);
    h.server.add('VK2ESN');
    await h.clock.advance(CHECK_EVERY_MS);
    // A check reads what is new only: the deleted QSO stays until the full read.
    expect(h.calls()).toEqual(['JA1KXM 20m FT8', 'K1ABC 20m FT8', 'VK2ESN 20m FT8']);
    await h.clock.advance(FULL_EVERY_MS - CHECK_EVERY_MS);
    expect(h.calls()).toEqual(['K1ABC 20m FT8', 'VK2ESN 20m FT8']);
    expect(h.status.fullAt).toBe(T0 + FULL_EVERY_MS);
    expect(h.store.data?.calls.sort()).toEqual(['K1ABC 20m FT8', 'VK2ESN 20m FT8']);
    expect(h.server.requests.filter((r) => r.path === '/api/station_info')).toHaveLength(2);
  });

  it('keeps what was read while a full read is under way, and swaps it in when the read ends', async () => {
    const h = harness();
    h.server.add('K1ABC');
    await started(h);
    h.server.rows = [];
    h.server.add('VK2ESN');
    h.server.queued = [{ status: 503, body: {} }];
    await h.sync.refresh();
    expect(h.status.error).toBe(say.serverError('wavelog.example.test', 503));
    expect(h.calls()).toEqual(['K1ABC 20m FT8']);
    await h.clock.advance(30_000);
    expect(h.calls()).toEqual(['VK2ESN 20m FT8']);
  });

  it('reads the station locations again when one is gone, in full', async () => {
    const h = harness();
    h.server.version = '2.5.1';
    h.server.stations = ['1', '7'];
    h.server.add('JA1KXM', '20m', 'FT8', '', '', '1');
    h.server.add('VK2ESN', '20m', 'FT8', '', '', '7');
    await started(h);
    h.server.stations = ['1'];
    h.server.rows = h.server.rows.filter((r) => r.station === '1');
    await h.clock.advance(CHECK_EVERY_MS);
    expect(h.calls()).toEqual(['JA1KXM 20m FT8']);
    expect(h.store.data?.meta.cursors.map((c) => c.stations)).toEqual([['1']]);
    expect(h.status.error).toBeNull();
  });

  it('keeps what it read when RR73 starts again, and reads only what is new', async () => {
    const store = new MemoryStore();
    const server = new FakeWavelog();
    server.add('K1ABC');
    const a = harness({ store, server });
    await started(a);
    a.sync.stop();
    // Started again 10 s later: what was read shows at once, with no request.
    const clock = new FakeClock();
    clock.t = T0 + 10_000;
    const b = harness({ store, server, clock });
    const sent = server.requests.length;
    await started(b);
    expect(b.calls()).toEqual(['K1ABC 20m FT8']);
    expect(server.requests.length).toBe(sent);
    b.sync.stop();
    // 3 minutes later: one request from the last id.
    const c = harness({ store, server, clock: Object.assign(new FakeClock(), { t: T0 + 3 * MIN }) });
    server.add('ZL2AB');
    await started(c);
    expect(server.contacts().slice(-2).map((r) => r.body?.fetchfromid)).toEqual([server.rows[0].id, server.rows[1].id]);
    expect(c.calls()).toEqual(['K1ABC 20m FT8', 'ZL2AB 20m FT8']);
  });

  it('starts afresh for a new address or key, deleting what another one gave', async () => {
    const h = harness();
    h.server.add('K1ABC');
    await started(h);
    expect(h.store.data?.meta.source).toBe(sourceOf(SRC));
    h.server.rows = [];
    h.server.add('VK2ESN');
    h.server.key = 'new-key';
    await started(h, { url: URL_, apiKey: 'new-key' });
    expect(h.calls()).toEqual(['VK2ESN 20m FT8']);
    expect(h.store.data?.meta.source).toBe(sourceOf({ url: URL_, apiKey: 'new-key' }));
    expect(fromIds(h).at(-2)).toBe(0);
  });

  it('deletes what was read when turned off, and reads nothing more', async () => {
    const h = harness();
    h.server.add('K1ABC');
    await started(h);
    expect(h.store.data).not.toBeNull();
    await h.sync.forget();
    expect(h.store.data).toBeNull();
    expect(h.keys).toBeNull();
    expect(h.status).toEqual(WORKED_OFF);
    const sent = h.server.requests.length;
    h.sync.kick();
    await h.clock.advance(FULL_EVERY_MS);
    expect(h.server.requests.length).toBe(sent);
  });

  it('drops a read under way when turned off, and stores nothing from it', async () => {
    const h = harness();
    h.server.add('K1ABC');
    let release!: () => void;
    const fetch = h.server.fetch;
    h.server.fetch = async (input, init) => {
      if (input.endsWith('/api/get_contacts_adif')) await new Promise<void>((r) => (release = r));
      return fetch(input, init);
    };
    await h.sync.use(SRC);
    await settle();
    expect(h.status.reading).toBe(true);
    await h.sync.forget();
    release();
    await h.clock.idle();
    expect(h.store.data).toBeNull();
    expect(h.keys).toBeNull();
    expect(h.status).toEqual(WORKED_OFF);
  });
});
