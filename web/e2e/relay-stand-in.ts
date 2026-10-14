// A stand-in QSP relay (docs/design/qsp.md) for the e2e tests and the review screenshots: its HTTP
// API on page.route at RELAY_BASE, on the reserved .test domain, so no request reaches a server.
// web-sdr.spec.ts adds its stream.
import type { Page } from '@playwright/test';

export const RELAY_BASE = 'https://relay.test/qsp';
export const RELAY_KEY = 'stand-in-key-0123456789';
export const RECEIVERS = [
  { id: 'stand-in', kind: 'kiwisdr', name: 'Stand-in Web-888', location: 'Singapore', grid: 'OJ11' },
  { id: 'second', kind: 'kiwisdr', name: 'Second KiwiSDR', location: 'Johor Bahru', grid: 'OJ01' },
];

/** The relay as stored after Settings › Relay adds it and Settings › Web SDR chooses a receiver. */
export const RELAY_SET_UP = { base: RELAY_BASE, relays: [{ base: RELAY_BASE, key: RELAY_KEY }], sdrOn: true, receiver: RECEIVERS[0].id, receiverName: RECEIVERS[0].name };

export interface RelayCall {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

/** Answers the relay's API; returns the calls it saw, oldest first. */
export async function routeRelay(page: Page): Promise<RelayCall[]> {
  const calls: RelayCall[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' };
  await page.route(`${RELAY_BASE}/**`, async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(r.url()).pathname.replace('/qsp', '');
    const body = r.postData() ? (r.postDataJSON() as Record<string, unknown>) : null;
    calls.push({ method: r.method(), path, auth: (await r.headerValue('authorization')) ?? null, body });
    const json = (status: number, b: unknown) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/about') return json(200, { name: 'QSP', version: '0.16.0', api: ['v1'], auth: true, services: ['sdr'], userReceivers: false });
    if (path === '/v1/sdr/receivers') return json(200, { receivers: RECEIVERS });
    if (path === '/v1/sdr/sessions' && r.method() === 'POST') {
      const id = `s${calls.filter((c) => c.method === 'POST').length}`;
      return json(201, { id, receiver: body?.receiver, dialHz: body?.dialHz, encoding: 'ima-adpcm', state: 'waiting', stream: `/v1/sdr/sessions/${id}/stream?ticket=t-${id}` });
    }
    if (r.method() === 'PATCH') return json(200, { id: path.split('/').pop(), receiver: RECEIVERS[0].id, dialHz: body?.dialHz, encoding: 'ima-adpcm', state: 'streaming' });
    if (r.method() === 'DELETE') return route.fulfill({ status: 204, headers: cors });
    return json(404, { error: { code: 'not-found', message: 'No such path.' } });
  });
  return calls;
}
