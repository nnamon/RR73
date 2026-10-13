import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQso } from './qso';
import type { WavelogConfig, WavelogStation } from './types';
import {
  checkAddress,
  defaultStation,
  dryRunAdif,
  mapAuth,
  mapQsoResponse,
  parseStations,
  plainReason,
  request,
  say,
  testConnection,
  wavelogDestination,
  type FetchLike,
  type Http,
  type SendContext,
} from './wavelog';

const T = Date.UTC(2026, 9, 13, 13, 32, 0);
const HOME: WavelogStation = { id: '1', name: 'Home', callsign: '9V1NE', grid: 'OJ11', active: true };
const VK: WavelogStation = { id: '7', name: 'VK3 portable', callsign: 'VK3/9V1NE', grid: 'QF22', active: false };
const QSO = { id: 'q1', call: 'YB0AZK', stationCallsign: 'VK3/9V1NE', myGridsquare: 'QF22lb', band: '30m' };
const CTX: SendContext = { host: 'log.example.test', qso: QSO, station: HOME, timeoutS: 20 };

const res = (status: number, body: unknown): Http => ({ kind: 'response', status, text: typeof body === 'string' ? body : JSON.stringify(body) });

describe('Wavelog replies to POST /api/qso', () => {
  it('counts 201 created as delivered', () => {
    expect(mapQsoResponse(res(201, { status: 'created', type: 'adif', string: '', adif_count: 1, adif_errors: 0, messages: [''] }), CTX)).toEqual({
      qsoId: 'q1',
      outcome: 'delivered',
      remoteRef: null,
      duplicate: false,
    });
  });

  it('counts a duplicate as delivered, in English or another language', () => {
    const en = 'Date/Time: 2026-10-13 13:31:00 Callsign: YB0AZK Band: 30m Duplicate for 9V1NE<br>';
    const de = 'Date/Time: 2026-10-13 13:31:00 Callsign: YB0AZK Band: 30m Duplikat für 9V1NE<br>';
    for (const m of [en, de]) {
      expect(mapQsoResponse(res(400, { status: 'abort', adif_count: 1, adif_errors: 1, messages: ['', m] }), CTX)).toMatchObject({ outcome: 'delivered', duplicate: true });
    }
  });

  it('refuses a read-only key for the whole destination, whether Wavelog answers 403 or 401', () => {
    for (const status of [403, 401]) {
      expect(mapQsoResponse(res(status, { status: 'failed', reason: 'API key does not have write permissions' }), CTX)).toEqual({
        qsoId: 'q1',
        outcome: 'refused',
        message: 'Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog.',
        refusal: { fix: 'wavelog-key', scope: 'destination' },
      });
    }
  });

  it('refuses a wrong or switched-off key', () => {
    expect(mapQsoResponse(res(401, { status: 'failed', reason: 'missing or wrong api key' }), CTX)).toMatchObject({
      outcome: 'refused',
      message: say.keyInvalid,
      refusal: { fix: 'wavelog-key', scope: 'destination' },
    });
  });

  it('refuses a station location that is gone', () => {
    expect(mapQsoResponse(res(401, { status: 'failed', reason: 'station id does not belong to the API key owner.' }), CTX)).toMatchObject({
      outcome: 'refused',
      message: 'The station location no longer exists in Wavelog. Choose another in Settings.',
      refusal: { fix: 'wavelog-station', scope: 'destination' },
    });
  });

  it('explains a call on air that differs from the station location', () => {
    const m = 'Differing station callsign <b>VK3/9V1NE</b> while importing QSO with YB0AZK for <b>9V1NE</b>: SKIPPED<br>';
    expect(mapQsoResponse(res(400, { status: 'abort', adif_count: 1, adif_errors: 1, messages: ['', m] }), CTX)).toMatchObject({
      outcome: 'refused',
      message: 'Wavelog refused the QSO: it was made as VK3/9V1NE and the station location Home is for 9V1NE. Choose a station location for VK3/9V1NE.',
      refusal: { fix: 'wavelog-station', scope: 'qso' },
    });
  });

  it('explains a grid outside the station location', () => {
    const m = 'Differing locator <b>QF22LB</b> while importing QSO with YB0AZK for station locator <b>OJ11</b>: SKIPPED<br>';
    expect(mapQsoResponse(res(400, { status: 'abort', messages: ['', m] }), CTX)).toMatchObject({
      message: 'Wavelog refused the QSO: its grid QF22lb is outside OJ11, the grid of the station location Home. Choose a station location for QF22lb.',
      refusal: { fix: 'wavelog-station', scope: 'qso' },
    });
  });

  it('explains a band missing from Wavelog', () => {
    const m = "QSO on 2026-10-13 13:31:00: Band '30m' is not in the band configuration. This QSO wasn't imported.<br>";
    expect(mapQsoResponse(res(400, { status: 'abort', messages: ['', m] }), CTX)).toMatchObject({
      message: 'Wavelog refused the QSO: 30m is not in its band list. Add the band in Wavelog, then send the QSO again.',
      refusal: { fix: 'resend', scope: 'qso' },
    });
  });

  it('quotes any other reason in plain text and asks for an edit', () => {
    const m = "QSO on 2026-10-13: You tried to import a QSO with an invalid CALL. This QSO wasn't imported. The invalid input is '&lt;x&gt;'.<br>";
    expect(mapQsoResponse(res(400, { status: 'abort', messages: ['', m] }), CTX)).toMatchObject({
      message: "Wavelog refused the QSO: “QSO on 2026-10-13: You tried to import a QSO with an invalid CALL. This QSO wasn't imported. The invalid input is '<x>'.” Edit the QSO to send it again.",
      refusal: { fix: 'edit-qso', scope: 'qso' },
    });
  });

  it('retries after a network failure, a timeout, a server error and a rate limit', () => {
    expect(mapQsoResponse({ kind: 'network' }, CTX)).toMatchObject({
      outcome: 'retry',
      timeout: false,
      message: 'Could not reach Wavelog at log.example.test. Check the address and that this phone is online. RR73 tries again later.',
    });
    expect(mapQsoResponse({ kind: 'timeout' }, CTX)).toMatchObject({ outcome: 'retry', timeout: true, message: 'Wavelog at log.example.test did not answer within 20 s. RR73 tries again later.' });
    expect(mapQsoResponse(res(502, '<html>Bad gateway</html>'), CTX)).toMatchObject({ outcome: 'retry', message: 'Wavelog at log.example.test had a server error (HTTP 502). RR73 tries again later.' });
    expect(mapQsoResponse(res(429, { status: 'failed', reason: 'Rate limit exceeded. Try again in 42 seconds.', retry_after: 42 }), CTX)).toMatchObject({
      outcome: 'retry',
      retryAfterMs: 42_000,
      message: 'Wavelog asked RR73 to wait 42 s before sending more. RR73 tries again then.',
    });
  });

  it('treats an unreadable success as a possible duplicate', () => {
    expect(mapQsoResponse(res(200, '<html>Welcome to the captive portal</html>'), CTX)).toMatchObject({ outcome: 'retry', timeout: true });
  });

  it('reads JSON after PHP notices', () => {
    expect(mapQsoResponse(res(201, '<br><b>Notice</b>: Undefined index in Api.php<br>{"status":"created","adif_count":1}'), CTX).outcome).toBe('delivered');
  });

  it('refuses a body Wavelog cannot read, and an address with no API', () => {
    expect(mapQsoResponse(res(200, { status: 'failed', reason: 'wrong JSON' }), CTX)).toMatchObject({ outcome: 'refused', refusal: { fix: 'resend', scope: 'qso' } });
    expect(mapQsoResponse(res(404, '<html>Not found</html>'), CTX)).toMatchObject({
      message: 'log.example.test does not answer as Wavelog. Check the address in Settings › Logging.',
      refusal: { fix: 'wavelog-address', scope: 'destination' },
    });
  });

  it('turns Wavelog’s HTML reasons into one line', () => {
    expect(plainReason(['', 'A<br>B &amp; <b>C</b>', 3])).toBe('A B & C');
  });
});

describe('Wavelog auth and station locations', () => {
  it('reads the XML from /api/auth', () => {
    expect(mapAuth(res(200, '<auth><status>Valid</status><rights>rw</rights></auth>'), 'h', 15)).toEqual({ kind: 'valid', rights: 'rw' });
    expect(mapAuth(res(200, '<auth><status>Valid</status><rights>r</rights></auth>'), 'h', 15)).toEqual({ kind: 'valid', rights: 'r' });
    expect(mapAuth(res(200, '<auth><message>Key Invalid - either not found or disabled</message></auth>'), 'h', 15)).toEqual({ kind: 'invalid' });
    expect(mapAuth(res(404, '<html></html>'), 'h', 15)).toEqual({ kind: 'failed', message: 'h does not answer as Wavelog. Check the address in Settings › Logging.' });
    expect(mapAuth({ kind: 'network' }, 'h', 15)).toEqual({ kind: 'failed', message: 'Could not reach Wavelog at h. Check the address and that this phone is online.' });
    expect(mapAuth({ kind: 'timeout' }, 'h', 15)).toEqual({ kind: 'failed', message: 'Wavelog at h did not answer within 15 s.' });
    expect(mapAuth(res(500, ''), 'h', 15)).toEqual({ kind: 'failed', message: 'Wavelog at h had a server error (HTTP 500). Try again later.' });
  });

  it('reads /api/station_info', () => {
    const json = JSON.stringify([
      { station_id: '1', station_profile_name: 'Home', station_gridsquare: 'oj11', station_callsign: '9v1ne', station_active: '1' },
      { station_id: 7, station_profile_name: 'VK3 portable', station_gridsquare: 'QF22', station_callsign: 'VK3/9V1NE', station_active: null },
      { station_profile_name: 'broken' },
    ]);
    const list = parseStations(json)!;
    expect(list).toEqual([HOME, VK]);
    expect(defaultStation(list)).toEqual(HOME);
    expect(defaultStation([VK])).toEqual(VK);
    expect(defaultStation([])).toBeNull();
    expect(parseStations('{"status":"failed"}')).toBeNull();
    expect(parseStations('<html>')).toBeNull();
  });
});

describe('the Wavelog address', () => {
  it('adds https and drops a trailing /api path and slashes', () => {
    expect(checkAddress('log.example.com')).toEqual({ ok: true, url: 'https://log.example.com', host: 'log.example.com' });
    expect(checkAddress(' https://log.example.com/ ')).toMatchObject({ url: 'https://log.example.com' });
    expect(checkAddress('https://example.com/wavelog/index.php/api/qso')).toMatchObject({ url: 'https://example.com/wavelog/index.php' });
    expect(checkAddress('https://log.example.com:8443')).toMatchObject({ url: 'https://log.example.com:8443', host: 'log.example.com:8443' });
  });

  it('refuses plain http and things that are not addresses', () => {
    expect(checkAddress('http://log.example.com')).toEqual({ ok: false, message: 'Use the https address of your Wavelog. Safari does not let RR73 use plain http.' });
    expect(checkAddress('')).toEqual({ ok: false, message: 'Type the address of your Wavelog, such as https://log.example.com.' });
    expect(checkAddress('not an address')).toMatchObject({ ok: false });
    expect(checkAddress('ftp://log.example.com')).toMatchObject({ ok: false });
    expect(checkAddress('localhost')).toMatchObject({ ok: false });
  });
});

/** A fake Wavelog: routes by method and path, records requests. */
function fakeWavelog(routes: Record<string, (body: Record<string, unknown> | null) => Response | Promise<Response>>) {
  const requests: { method: string; url: string; body: Record<string, unknown> | null; contentType: string | null; credentials?: RequestCredentials }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ method, url, body, contentType: new Headers(init.headers).get('content-type'), credentials: init.credentials });
    const path = new URL(url).pathname;
    const route = routes[`${method} ${path}`];
    if (!route) return new Response('<html>Not found</html>', { status: 404 });
    return route(body);
  };
  return { fetchFn, requests };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const STATIONS = [
  { station_id: '1', station_profile_name: 'Home', station_gridsquare: 'OJ11', station_callsign: '9V1NE', station_active: '1' },
  { station_id: '7', station_profile_name: 'VK3 portable', station_gridsquare: 'QF22', station_callsign: 'VK3/9V1NE', station_active: null },
];
const healthy = {
  'GET /api/auth/k%2F1': () => new Response('<auth><status>Valid</status><rights>rw</rights></auth>', { status: 200 }),
  'GET /api/station_info/k%2F1': () => json(200, STATIONS),
  'POST /api/qso/true': () => json(201, { status: 'created', adif_count: 0, adif_errors: 0, messages: ['Dryrun works'] }),
  'POST /api/version': () => json(200, { status: 'ok', version: '2.1' }),
};

describe('Test connection', () => {
  it('checks the key, lists station locations and dry-runs a QSO to the chosen one', async () => {
    const w = fakeWavelog(healthy);
    const r = await testConnection({ url: 'log.example.test', apiKey: ' k/1 ', stationId: '7' }, w.fetchFn, T);
    expect(r).toMatchObject({ ok: true, message: 'Can read and write', rights: 'rw', version: '2.1', stationId: '7', at: T });
    expect(r.stations.map((s) => s.id)).toEqual(['1', '7']);
    expect(w.requests.map((q) => `${q.method} ${q.url}`)).toEqual([
      'GET https://log.example.test/api/auth/k%2F1',
      'GET https://log.example.test/api/station_info/k%2F1',
      'POST https://log.example.test/api/qso/true',
      'POST https://log.example.test/api/version',
    ]);
    const dry = w.requests[2];
    expect(dry.body).toMatchObject({ key: 'k/1', station_profile_id: '7', type: 'adif' });
    expect(dry.body?.string).toContain('<CALL:8>RR73TEST');
    expect(dry.contentType).toBe('text/plain;charset=UTF-8');
    expect(dry.credentials).toBe('omit');
  });

  it('uses Wavelog’s active station location when none is chosen', async () => {
    const w = fakeWavelog(healthy);
    expect((await testConnection({ url: 'log.example.test', apiKey: 'k/1', stationId: null }, w.fetchFn, T)).stationId).toBe('1');
  });

  it('says what is wrong at each step', async () => {
    const cases: [Record<string, () => Response>, string][] = [
      [{ ...healthy, 'GET /api/auth/k%2F1': () => new Response('<auth><message>Key Invalid - either not found or disabled</message></auth>') }, say.keyInvalid],
      [{ ...healthy, 'GET /api/auth/k%2F1': () => new Response('<auth><status>Valid</status><rights>r</rights></auth>') }, say.readOnly],
      [{ ...healthy, 'GET /api/station_info/k%2F1': () => json(200, []) }, say.noStations],
      [{ ...healthy, 'GET /api/station_info/k%2F1': () => json(401, { status: 'failed' }) }, say.keyInvalid],
      [{ ...healthy, 'POST /api/qso/true': () => json(401, { status: 'failed', reason: 'station id does not belong to the API key owner.' }) }, say.stationGone],
      [{ ...healthy, 'POST /api/qso/true': () => json(500, {}) }, 'Wavelog at log.example.test had a server error (HTTP 500). Try again later.'],
      [{}, 'log.example.test does not answer as Wavelog. Check the address in Settings › Logging.'],
    ];
    for (const [routes, message] of cases) {
      const r = await testConnection({ url: 'https://log.example.test', apiKey: 'k/1', stationId: null }, fakeWavelog(routes).fetchFn, T);
      expect(r.ok).toBe(false);
      expect(r.message).toBe(message);
    }
    expect((await testConnection({ url: 'http://log.example.test', apiKey: 'k', stationId: null }, fakeWavelog(healthy).fetchFn, T)).message).toBe(
      'Use the https address of your Wavelog. Safari does not let RR73 use plain http.',
    );
    expect((await testConnection({ url: 'log.example.test', apiKey: ' ', stationId: null }, fakeWavelog(healthy).fetchFn, T)).message).toBe(say.keyMissing);
    const down: FetchLike = () => Promise.reject(new TypeError('Load failed'));
    expect((await testConnection({ url: 'log.example.test', apiKey: 'k', stationId: null }, down, T)).message).toBe(
      'Could not reach Wavelog at log.example.test. Check the address and that this phone is online.',
    );
  });

  it('makes a dry-run record Wavelog can read', () => {
    expect(dryRunAdif(T)).toBe('<CALL:8>RR73TEST <QSO_DATE:8>20261013 <TIME_ON:6>133200 <BAND:3>20m <MODE:3>FT8 <EOR>');
  });
});

describe('sending to Wavelog', () => {
  afterEach(() => vi.useRealTimers());

  const cfg: WavelogConfig = { id: 'wavelog', kind: 'wavelog', enabled: true, url: 'https://log.example.test', apiKey: 'key1', stationId: '1', stations: [HOME, VK], lastTest: null };
  const q = createQso(
    { call: 'YB0AZK', grid: 'OI33', mode: 'FT8', band: '30m', dialHz: 10_136_000, audioHz: 1200, startUtcMs: T - 60_000, endUtcMs: T, reportSent: -11, reportRcvd: -13, comment: 'Grüße' },
    { id: 'q1', now: T, activation: null, callsign: '9V1NE' },
  );

  it('posts one QSO per request to the station location chosen for it', async () => {
    const w = fakeWavelog({ 'POST /api/qso': () => json(201, { status: 'created', adif_count: 1, adif_errors: 0 }) });
    const dest = wavelogDestination(cfg, () => '7', w.fetchFn);
    const receipts = await dest.send([q, { ...q, id: 'q2', call: 'JA1KXM' }]);
    expect(receipts.map((r) => [r.qsoId, r.outcome])).toEqual([
      ['q1', 'delivered'],
      ['q2', 'delivered'],
    ]);
    expect(w.requests).toHaveLength(2);
    const body = w.requests[0].body!;
    expect(w.requests[0].url).toBe('https://log.example.test/api/qso');
    expect(body).toMatchObject({ key: 'key1', station_profile_id: '7', type: 'adif' });
    expect(body.string).toBe(
      '<CALL:6>YB0AZK <QSO_DATE:8>20261013 <TIME_ON:6>133100 <QSO_DATE_OFF:8>20261013 <TIME_OFF:6>133200 <BAND:3>30m <FREQ:9>10.137200 <MODE:3>FT8 <RST_SENT:3>-11 <RST_RCVD:3>-13 <GRIDSQUARE:4>OI33 <STATION_CALLSIGN:5>9V1NE <OPERATOR:5>9V1NE <COMMENT:7>Grüße <EOR>',
    );
  });

  it('refuses a QSO with no station location without sending it', async () => {
    const w = fakeWavelog({});
    const [r] = await wavelogDestination(cfg, () => null, w.fetchFn).send([q]);
    expect(r).toMatchObject({ outcome: 'refused', message: say.noStation, refusal: { fix: 'wavelog-station' } });
    expect(w.requests).toEqual([]);
  });

  it('names the station location in a callsign refusal', async () => {
    const m = 'Differing station callsign <b>9V1NE</b> while importing QSO with YB0AZK for <b>VK3/9V1NE</b>: SKIPPED<br>';
    const w = fakeWavelog({ 'POST /api/qso': () => json(400, { status: 'abort', messages: ['', m] }) });
    const [r] = await wavelogDestination(cfg, () => '7', w.fetchFn).send([q]);
    expect(r).toMatchObject({ outcome: 'refused', message: 'Wavelog refused the QSO: it was made as 9V1NE and the station location VK3 portable is for VK3/9V1NE. Choose a station location for 9V1NE.' });
  });

  it('gives up waiting after 20 s', async () => {
    vi.useFakeTimers();
    const hang: FetchLike = (_url, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const p = wavelogDestination(cfg, () => '1', hang).send([q]);
    await vi.advanceTimersByTimeAsync(19_999);
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p)[0]).toMatchObject({ outcome: 'retry', timeout: true, message: 'Wavelog at log.example.test did not answer within 20 s. RR73 tries again later.' });
  });

  it('reports a network failure as such', async () => {
    expect(await request(() => Promise.reject(new TypeError('Load failed')), 'https://x.test', {}, 1000)).toEqual({ kind: 'network' });
  });
});
