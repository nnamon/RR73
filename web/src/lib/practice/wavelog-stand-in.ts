/**
 * A stand-in for Wavelog on the phone, for the practice log. It answers the requests RR73 makes
 * (lib/log/wavelog.ts) as Wavelog's API does: the key check, the station locations, the dry run
 * and QSO uploads. Most QSOs are delivered. One in 4, picked by callsign so a test can know which,
 * is refused on the first attempt as Wavelog refuses a QSO its band configuration does not
 * cover; sending it again delivers it.
 */

import type { FetchLike } from '../log/wavelog';
import type { WavelogConfig } from '../log/types';

export const STAND_IN_URL = 'https://wavelog.invalid';
const KEY = 'practice';
const STATION_ID = '1';

/** The practice log's Wavelog: set up and ready, pointing at the stand-in. */
export function standInConfig(callsign: string, grid: string): WavelogConfig {
  return {
    id: 'wavelog',
    kind: 'wavelog',
    enabled: true,
    url: STAND_IN_URL,
    apiKey: KEY,
    stationId: STATION_ID,
    stations: [{ id: STATION_ID, name: 'Practice', callsign, grid, active: true }],
    lastTest: null,
    readWorked: false,
  };
}

/** True when the stand-in refuses this callsign's QSO at the first attempt. */
export function refusesFirst(call: string): boolean {
  let h = 0;
  for (const ch of call.toUpperCase()) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h % 4 === 0;
}

export interface StandIn {
  fetch: FetchLike;
  /** Requests answered, for tests. */
  requests: { method: string; path: string }[];
}

export function wavelogStandIn(station: () => { callsign: string; grid: string }): StandIn {
  const attempts = new Map<string, number>();
  const requests: StandIn['requests'] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, path: url.pathname });
    if (url.origin !== STAND_IN_URL) return new Response('Not found', { status: 404 });
    const path = url.pathname;
    if (path.startsWith('/api/auth/')) {
      const ok = path.endsWith(`/${KEY}`);
      const xml = ok ? '<auth><status>Valid</status><rights>rw</rights></auth>' : '<auth><message>Key Invalid - either not found or disabled</message></auth>';
      return new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    if (path.startsWith('/api/station_info/')) {
      const s = station();
      return json(200, [{ station_id: STATION_ID, station_profile_name: 'Practice', station_callsign: s.callsign, station_gridsquare: s.grid, station_active: '1' }]);
    }
    if (path === '/api/version') return json(200, { status: 'ok', version: '2.1' });
    if (path === '/api/qso/true') return json(201, { status: 'created', adif_count: 0, adif_errors: 0, messages: ['Dryrun works'] });
    if (path === '/api/qso' && method === 'POST') {
      let body: { key?: string; string?: string } = {};
      try {
        body = JSON.parse(String(init.body ?? '{}')) as typeof body;
      } catch {
        return json(200, { status: 'failed', reason: 'wrong JSON' });
      }
      if (body.key !== KEY) return json(401, { status: 'failed', reason: 'missing api key' });
      const adif = body.string ?? '';
      const call = /<CALL:\d+>([^<\s]+)/i.exec(adif)?.[1] ?? '';
      const when = `${/<QSO_DATE:\d+>(\d+)/i.exec(adif)?.[1] ?? ''}${/<TIME_ON:\d+>(\d+)/i.exec(adif)?.[1] ?? ''}`;
      const band = /<BAND:\d+>([^<\s]+)/i.exec(adif)?.[1] ?? '';
      const key = `${call}|${when}`;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1 && refusesFirst(call)) {
        // Not in Wavelog's duplicate format ("Date/Time: … Callsign: … Band: …"), which RR73 counts as delivered.
        return json(400, { status: 'abort', messages: [`${band} is not in the band configuration of station location Practice`], adif_count: 0, adif_errors: 1 });
      }
      return json(201, { status: 'created', adif_count: 1, adif_errors: 0, messages: [''] });
    }
    return new Response('Not found', { status: 404 });
  };
  return { fetch: fetchFn, requests };
}
