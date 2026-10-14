// A stand-in QSP relay (docs/design/qsp.md) for the e2e tests and the review screenshots: its HTTP
// API on page.route at RELAY_BASE, on the reserved .test domain, so no request reaches a server.
// It offers web SDR receive and PSK Reporter reports. web-sdr.spec.ts adds its stream.
import type { Page } from '@playwright/test';

export const RELAY_BASE = 'https://relay.test/qsp';
export const RELAY_KEY = 'stand-in-key-0123456789';
export const RECEIVERS = [
  { id: 'stand-in', kind: 'kiwisdr', name: 'Stand-in Web-888', location: 'Singapore', grid: 'OJ11' },
  { id: 'second', kind: 'kiwisdr', name: 'Second KiwiSDR', location: 'Johor Bahru', grid: 'OJ01' },
];

/** The relay as stored after Settings › Relay adds it and Settings › Web SDR chooses a receiver. */
export const RELAY_SET_UP = { base: RELAY_BASE, relays: [{ base: RELAY_BASE, key: RELAY_KEY }], sdrOn: true, receiver: RECEIVERS[0].id, receiverName: RECEIVERS[0].name };

/** As RELAY_SET_UP on a relay that takes receivers by address, with a KiwiSDR the operator added in use. */
export const RELAY_OWN = {
  ...RELAY_SET_UP,
  relays: [{ base: RELAY_BASE, key: RELAY_KEY, receivers: [{ host: 'kiwi.example.org', port: 8074 }] }],
  receiver: 'kiwisdr://kiwi.example.org:8074',
  receiverName: 'kiwi.example.org:8074',
};

export interface RelayCall {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

/**
 * Answers the relay's API; returns the calls it saw, oldest first. With userReceivers, it takes
 * receivers by address and refuses private ones with QSP's answer.
 */
export async function routeRelay(page: Page, opts: { userReceivers?: boolean } = {}): Promise<RelayCall[]> {
  const calls: RelayCall[] = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' };
  await page.route(`${RELAY_BASE}/**`, async (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(r.url()).pathname.replace('/qsp', '');
    const body = r.postData() ? (r.postDataJSON() as Record<string, unknown>) : null;
    calls.push({ method: r.method(), path, auth: (await r.headerValue('authorization')) ?? null, body });
    const json = (status: number, b: unknown) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/about') return json(200, { name: 'QSP', version: '0.16.0', api: ['v1'], auth: true, services: ['sdr', 'pskreporter'], userReceivers: opts.userReceivers ?? false });
    if (path === '/v1/sdr/receivers') return json(200, { receivers: RECEIVERS });
    if (path === '/v1/sdr/sessions' && r.method() === 'POST') {
      const id = `s${calls.filter((c) => c.method === 'POST').length}`;
      const custom = body?.custom as { host: string; port: number } | undefined;
      if (custom && !opts.userReceivers) return json(403, { error: { code: 'forbidden', message: 'This relay accepts only the receivers it lists.' } });
      if (custom && /^(10|127|192\.168)\./.test(custom.host)) {
        return json(403, { error: { code: 'not-allowed', message: `${custom.host} is not on the public internet. This relay connects only to public receivers.` } });
      }
      const receiver = custom ? `${custom.host}:${custom.port}` : body?.receiver;
      return json(201, { id, receiver, dialHz: body?.dialHz, encoding: 'ima-adpcm', state: 'waiting', stream: `/v1/sdr/sessions/${id}/stream?ticket=t-${id}` });
    }
    if (path === '/v1/pskreporter/receptions' && r.method() === 'POST') {
      const n = Array.isArray(body?.spots) ? body.spots.length : 0;
      return json(200, { taken: n, repeats: 0, rejected: 0, nextReport: Math.floor(Date.now() / 1000) + 240 });
    }
    if (r.method() === 'PATCH') return json(200, { id: path.split('/').pop(), receiver: RECEIVERS[0].id, dialHz: body?.dialHz, encoding: 'ima-adpcm', state: 'streaming' });
    if (r.method() === 'DELETE') return route.fulfill({ status: 204, headers: cors });
    return json(404, { error: { code: 'not-found', message: 'No such path.' } });
  });
  return calls;
}
