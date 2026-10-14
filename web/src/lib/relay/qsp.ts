// QSP's API as RR73 uses it (docs/design/qsp.md, The API). Every path joins onto the relay's API
// base, such as https://relay.example.org/qsp; requests carry the access key when one is set.

import type { PskSpot } from '../pskreporter/spots';

export interface QspAbout {
  name: string;
  version: string;
  api: string[];
  auth: boolean;
  services: string[];
  userReceivers: boolean;
}

export interface QspReceiver {
  id: string;
  kind: string;
  name: string;
  location: string;
  grid: string;
}

/** A KiwiSDR the operator adds by address, on a relay that allows receivers of the user's own. */
export interface UserReceiver {
  /** Host name or address; an IPv6 address without brackets. */
  host: string;
  port: number;
}

/** KiwiSDR's port, for an address that gives none. */
export const KIWI_PORT = 8073;

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Reads a receiver's address as typed or pasted: host, host:port, [IPv6]:port, or a URL holding them. Null when it is none. */
export function parseReceiverAddress(text: string): UserReceiver | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '');
  let host: string;
  let port: string | undefined;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d+))?$/.exec(t);
  const named = /^([^:]+)(?::(\d+))?$/.exec(t);
  if (v6) [, host, port] = v6;
  else if (named && HOST_NAME.test(named[1])) [, host, port] = named;
  // IPv6 without brackets takes no port.
  else if (/^[0-9a-f.]*:[0-9a-f.:]*:[0-9a-f.]*$/.test(t)) host = t;
  else return null;
  const n = port === undefined ? KIWI_PORT : Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return { host, port: n };
}

/** The id Settings keeps for a receiver the operator added: kiwisdr://host:port. */
export function userReceiverId(r: UserReceiver): string {
  return `kiwisdr://${r.host.includes(':') ? `[${r.host}]` : r.host}:${r.port}`;
}

/** The receiver an id from userReceiverId stands for; null for a relay's own receiver. */
export function userReceiverOf(id: string): UserReceiver | null {
  return id.startsWith('kiwisdr://') ? parseReceiverAddress(id) : null;
}

/** A receiver's address as Settings shows it: the host, with the port when it is not 8073. */
export function receiverAddress(r: UserReceiver): string {
  const host = r.host.includes(':') ? `[${r.host}]` : r.host;
  return r.port === KIWI_PORT ? host : `${host}:${r.port}`;
}

export interface QspSession {
  id: string;
  receiver: string;
  dialHz: number;
  encoding: string;
  state: 'waiting' | 'streaming' | 'ended';
  /** The stream's path with its one-time ticket; only in the answer that creates the session. */
  stream?: string;
  endReason?: string;
  endMessage?: string;
}

/** Why a request to the relay failed: unreachable, a refused key, a refusal with QSP's own code, or an answer RR73 cannot read. */
export type QspErrorKind = 'network' | 'timeout' | 'unauthorised' | 'refused' | 'format';

export class QspError extends Error {
  constructor(
    readonly kind: QspErrorKind,
    /** QSP's error code for kind refused: not-found, not-offered, forbidden, not-allowed, receiver-busy, rate-limited, invalid. */
    readonly code: string | null = null,
    message = `Relay request failed: ${kind}`,
  ) {
    super(message);
    this.name = 'QspError';
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/** The relay's base without a trailing slash; null when it is not an http or https address. */
export function normaliseBase(text: string): string | null {
  const t = text.trim().replace(/\/+$/, '');
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.search || u.hash) return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * True when a page at `pageProtocol` may not reach the relay: browsers block http from an https
 * page, except on this device (localhost, 127.0.0.1).
 */
export function blockedFromPage(base: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') return false;
  const u = new URL(base);
  return u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1';
}

/** A path under the API base. */
export function apiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** The stream's WebSocket address: https becomes wss, http becomes ws. */
export function streamUrl(base: string, path: string): string {
  return apiUrl(base, path).replace(/^http/, 'ws');
}

async function call<T>(base: string, key: string, method: string, path: string, body: unknown, fetchFn: FetchFn): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS);
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    res = await fetchFn(apiUrl(base, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new QspError(timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    if (res.ok) throw new QspError('format');
  }
  if (res.status === 401) throw new QspError('unauthorised', 'unauthorised');
  if (!res.ok) {
    const e = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    throw new QspError('refused', typeof e?.code === 'string' ? e.code : String(res.status), typeof e?.message === 'string' ? e.message : undefined);
  }
  return data as T;
}

const pageFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

export function qspAbout(base: string, fetchFn: FetchFn = pageFetch): Promise<QspAbout> {
  return call(base, '', 'GET', '/about', undefined, fetchFn);
}

export async function qspReceivers(base: string, key: string, fetchFn: FetchFn = pageFetch): Promise<QspReceiver[]> {
  const r = await call<{ receivers?: QspReceiver[] }>(base, key, 'GET', '/v1/sdr/receivers', undefined, fetchFn);
  if (!Array.isArray(r?.receivers)) throw new QspError('format');
  return r.receivers;
}

/** Starts listening on a relay's receiver, by its id, or on one the operator added, by userReceiverId. */
export function qspStartSession(base: string, key: string, receiver: string, dialHz: number, listener: string, fetchFn: FetchFn = pageFetch): Promise<QspSession> {
  const own = userReceiverOf(receiver);
  const which = own ? { custom: { kind: 'kiwisdr', host: own.host, port: own.port } } : { receiver };
  return call(base, key, 'POST', '/v1/sdr/sessions', { ...which, dialHz, listener, encoding: 'ima-adpcm' }, fetchFn);
}

export function qspTune(base: string, key: string, id: string, dialHz: number, fetchFn: FetchFn = pageFetch): Promise<QspSession> {
  return call(base, key, 'PATCH', `/v1/sdr/sessions/${encodeURIComponent(id)}`, { dialHz }, fetchFn);
}

export function qspStop(base: string, key: string, id: string, fetchFn: FetchFn = pageFetch): Promise<void> {
  return call(base, key, 'DELETE', `/v1/sdr/sessions/${encodeURIComponent(id)}`, undefined, fetchFn);
}

/** The station that heard the spots, as PSK Reporter shows it. */
export interface QspStation {
  callsign: string;
  locator: string;
  /** Decoding software and version: "RR73 0.16.2". */
  software: string;
  antenna: string;
}

/** What a batch of spots came to at the relay. */
export interface QspReportResult {
  taken: number;
  repeats: number;
  rejected: number;
  /** Earliest time the relay's next datagram to PSK Reporter goes, s since 1970. */
  nextReport: number;
}

/** Sends a batch of stations heard; the relay reports them to PSK Reporter by its rules. */
export async function qspReport(base: string, key: string, station: QspStation, spots: readonly PskSpot[], fetchFn: FetchFn = pageFetch): Promise<QspReportResult> {
  const r = await call<QspReportResult>(base, key, 'POST', '/v1/pskreporter/receptions', { station, spots }, fetchFn);
  if (typeof r?.taken !== 'number') throw new QspError('format');
  return r;
}

/** The error in words for Settings: what happened and what to do. */
export function qspErrorText(e: unknown): string {
  if (!(e instanceof QspError)) return 'RR73 could not read the relay’s response.';
  switch (e.kind) {
    case 'network':
      return 'The relay is unreachable. Check the address and that this phone is online.';
    case 'timeout':
      return 'The relay did not answer within 10 s.';
    case 'unauthorised':
      return 'The relay refused the access key. Ask the relay’s operator for a valid key.';
    case 'format':
      return 'This address is not a QSP relay. Check the address.';
    case 'refused':
      return e.message.startsWith('Relay request failed') ? `The relay refused the request (${e.code}).` : e.message;
  }
}
