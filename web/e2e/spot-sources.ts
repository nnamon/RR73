// Stand-ins for the spot sources, so no test reaches api.pota.app or www.hamqth.com. They answer
// with the responses recorded at 05:56 UTC on 13 October 2026, moved in time so the newest spot
// is about a minute old at `nowMs`. Requests to the hosts are counted.
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FIXED_TIME } from './time';

const FIXTURES = new URL('../../fixtures/spots/', import.meta.url);
const POTA = JSON.parse(readFileSync(new URL('pair-pota-2026-10-13T0556Z.json', FIXTURES), 'utf8')) as Record<string, unknown>[];
const CLUSTER = readFileSync(new URL('pair-hamqth-dxc-2026-10-13T0556Z.csv', FIXTURES), 'utf8');
/** When the recordings were made, plus the minute the newest spot ages by. */
const RECORDED = Date.UTC(2026, 9, 13, 5, 57);

const CORS = { 'access-control-allow-origin': '*' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** POTA's spotTime, UTC without a zone: 2026-10-13T05:52:36. */
function potaTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** HamQTH's time field: "0555 2026-10-13". */
function clusterTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())} ${d.toISOString().slice(0, 10)}`;
}

function parseClusterTime(t: string): number {
  const [hm, date] = t.split(' ');
  return Date.parse(`${date}T${hm.slice(0, 2)}:${hm.slice(2)}:00Z`);
}

export interface SpotStandIn {
  /** Requests each source answered. */
  requests: { pota: number; hamqth: number };
}

/** Routes the spot sources' hosts to the recordings; anything else on those hosts is refused. */
export async function stubSpotSources(page: Page, nowMs = FIXED_TIME): Promise<SpotStandIn> {
  const shift = nowMs - RECORDED;
  const stand: SpotStandIn = { requests: { pota: 0, hamqth: 0 } };
  const pota = JSON.stringify(POTA.map((r) => ({ ...r, spotTime: potaTime(Date.parse(`${String(r.spotTime)}Z`) + shift) })));
  const cluster = CLUSTER.split('\n')
    .map((line) => {
      const f = line.split('^');
      if (f.length < 5) return line;
      f[4] = clusterTime(parseClusterTime(f[4]) + shift);
      return f.join('^');
    })
    .join('\n');
  await page.route('https://api.pota.app/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/spot/activator') return route.abort();
    stand.requests.pota++;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: pota });
  });
  await page.route('https://www.hamqth.com/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/dxc_csv.php') return route.abort();
    stand.requests.hamqth++;
    await route.fulfill({ status: 200, contentType: 'text/csv', headers: CORS, body: cluster });
  });
  return stand;
}
