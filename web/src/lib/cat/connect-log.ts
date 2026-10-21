/**
 * The steps of the last connection to the radio, kept in localStorage so they survive the browser
 * closing in the middle (docs/design/cat.md, Connection log). Each step is written before it runs:
 * after a crash, the last step written is the one the browser closed in. Only the last attempt is
 * kept, so the entry stays under 1 kB.
 *
 * Every storage access sits in try/catch: a private window or a full disk refuses it, and rig
 * control then connects without a log.
 */

import type { CatRadioId } from './radios';
import type { SerialOptionsLike } from './serial';

export const CONNECT_LOG_KEY = 'rr73.connectLog';

/**
 * How an attempt started: Connect radio (the port chooser), Reconnect radio, or RR73 by itself
 * (on starting, when the port comes back, or on a new baud rate).
 */
export type ConnectVia = 'connect' | 'reconnect' | 'auto';

/** One step, in the order connecting takes them. */
export type ConnectStep =
  | { step: 'chooser' }
  | { step: 'port'; usbVendorId: number | null; usbProductId: number | null }
  | { step: 'forget'; ports: number }
  | { step: 'open'; options: SerialOptionsLike }
  | { step: 'signals' }
  | { step: 'usb-send' }
  | { step: 'reply' }
  | { step: 'connected' };

export type ConnectEntry = ConnectStep & { atMs: number };

export interface ConnectAttempt {
  radio: CatRadioId;
  via: ConnectVia;
  steps: ConnectEntry[];
  /** Why the attempt ended without connecting, when RR73 saw it end; absent after a crash. */
  failed?: string;
  /** The first bytes written to the port and read from it, in hex, WIRE_BYTES at most each. */
  sent?: string;
  received?: string;
}

/** Bytes kept of each direction: enough for the first few frames, small enough for storage. */
export const WIRE_BYTES = 96;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The attempt in progress on this page; null before the first. */
let attempt: ConnectAttempt | null = null;

function save(a: ConnectAttempt | null) {
  try {
    const s = storage();
    if (!s) return;
    if (a) s.setItem(CONNECT_LOG_KEY, JSON.stringify(a));
    else s.removeItem(CONNECT_LOG_KEY);
  } catch {
    // Storage refused: the attempt goes unlogged.
  }
}

const isStep = (e: unknown): e is ConnectEntry => !!e && typeof e === 'object' && typeof (e as { step?: unknown }).step === 'string' && typeof (e as { atMs?: unknown }).atMs === 'number';

/** The last attempt as stored, from this page or an earlier one; null without one or when storage refuses. */
export function lastAttempt(): ConnectAttempt | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(CONNECT_LOG_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<ConnectAttempt>;
    if ((a.radio !== 'ic705' && a.radio !== 'kx2') || !Array.isArray(a.steps) || !a.steps.every(isStep)) return null;
    const via = a.via === 'connect' || a.via === 'reconnect' ? a.via : 'auto';
    return {
      radio: a.radio,
      via,
      steps: a.steps,
      ...(typeof a.failed === 'string' ? { failed: a.failed } : {}),
      ...(typeof a.sent === 'string' ? { sent: a.sent } : {}),
      ...(typeof a.received === 'string' ? { received: a.received } : {}),
    };
  } catch {
    return null;
  }
}

/** True once the attempt reached `connected`. */
export function reachedConnected(a: ConnectAttempt): boolean {
  return a.steps.some((s) => s.step === 'connected');
}

/**
 * True when the last attempt on `radio` never reached `connected`: the browser may have closed in
 * it, so RR73 does not open the port by itself.
 */
export function lastAttemptStopped(radio: CatRadioId): boolean {
  const a = lastAttempt();
  return a !== null && a.radio === radio && !reachedConnected(a);
}

/** Starts a new attempt, replacing the one stored, with its first step. Returns what it replaced. */
export function beginAttempt(radio: CatRadioId, via: ConnectVia, first: ConnectStep, nowMs = Date.now()): ConnectAttempt | null {
  const before = lastAttempt();
  attempt = { radio, via, steps: [{ ...first, atMs: nowMs }] };
  save(attempt);
  return before;
}

/** Writes the next step of the attempt in progress, before it runs. */
export function logStep(step: ConnectStep, nowMs = Date.now()) {
  if (!attempt) return;
  if (step.step === 'connected' && reachedConnected(attempt)) return;
  attempt.steps.push({ ...step, atMs: nowMs });
  save(attempt);
}

/**
 * Records the bytes of the attempt in progress as they go to or come from the port, up to
 * WIRE_BYTES each way: whether the radio sent anything at all, and what.
 */
export function logWire(dir: 'sent' | 'received', bytes: Uint8Array) {
  if (!attempt) return;
  const had = attempt[dir] ?? '';
  const count = had ? had.split(' ').length : 0;
  if (count >= WIRE_BYTES) return;
  const hex = Array.from(bytes.subarray(0, WIRE_BYTES - count), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  attempt[dir] = had ? `${had} ${hex}` : hex;
  save(attempt);
}

/** Ends the attempt in progress without a connection, for the reason given. */
export function logFailure(why: string) {
  if (!attempt || reachedConnected(attempt)) return;
  attempt.failed = why;
  save(attempt);
  attempt = null;
}

/** Puts back the attempt `beginAttempt` replaced: the operator closed the chooser, and nothing opened. */
export function restoreAttempt(before: ConnectAttempt | null) {
  attempt = null;
  save(before);
}

const NAMES: Record<CatRadioId, string> = { ic705: 'IC-705', kx2: 'KX2' };

/** Where the attempt stopped, as the rest of a sentence: "at opening the port at 115200 baud". */
function stoppedAt(a: ConnectAttempt): string {
  const last = a.steps.at(-1);
  switch (last?.step) {
    case 'chooser':
      return 'in the browser’s port chooser';
    case 'port':
      return a.via === 'connect' ? 'after the port was chosen' : 'after the allowed port was found';
    case 'forget':
      return 'at forgetting the other allowed ports';
    case 'open':
      return `at opening the port at ${last.options.baudRate} baud`;
    case 'signals':
      return 'at setting the port’s DTR and RTS lines low';
    case 'usb-send':
      return 'at reading USB SEND';
    default:
      return `while waiting for the ${NAMES[a.radio]}’s first reply`;
  }
}

/**
 * One line for Rig control when the last attempt on `radio` never connected; null otherwise. An
 * attempt RR73 saw fail names the failure; one that ends without it is where the browser may
 * have closed.
 */
export function stoppedText(a: ConnectAttempt | null, radio: CatRadioId): string | null {
  if (!a || a.radio !== radio || reachedConnected(a)) return null;
  return a.failed ? `The last connection failed ${stoppedAt(a)}: ${inline(failureText(a.failed, a.radio))}.` : `The last connection stopped ${stoppedAt(a)}. The browser may have closed there.`;
}

/** A sentence continued after a colon: its first letter in lower case, unless it starts a name such as DTR. */
const inline = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

function failureText(why: string, radio: CatRadioId): string {
  switch (why) {
    case 'busy':
      return 'Another program had the port open';
    case 'signals':
      return radio === 'ic705' ? 'The lines could not be set low, and USB SEND did not read OFF' : 'The lines could not be set low';
    case 'failed':
      return 'The port did not open';
    case 'no-wasm':
      return 'Rig control did not load';
    case 'lost':
      return 'The port closed';
    default:
      return why;
  }
}

const hex4 = (v: number | null) => (v === null ? '?' : v.toString(16).toUpperCase().padStart(4, '0'));

function stepText(e: ConnectEntry, a: ConnectAttempt): string {
  switch (e.step) {
    case 'chooser':
      return 'Port chooser shown';
    case 'port': {
      const ids = e.usbVendorId === null && e.usbProductId === null ? 'no USB IDs' : `USB ${hex4(e.usbVendorId)}:${hex4(e.usbProductId)}`;
      return `${a.via === 'connect' ? 'Port chosen' : 'Allowed port found'}, ${ids}`;
    }
    case 'forget':
      return `Forgetting ${e.ports} other allowed port${e.ports === 1 ? '' : 's'}`;
    case 'open': {
      const o = e.options;
      return `Opening at ${o.baudRate} baud, ${o.dataBits ?? 8} data bits, parity ${o.parity ?? 'none'}, ${o.stopBits ?? 1} stop bit, flow control ${o.flowControl ?? 'none'}`;
    }
    case 'signals':
      return 'Setting DTR and RTS low';
    case 'usb-send':
      return 'DTR and RTS refused, reading USB SEND';
    case 'reply':
      return 'Waiting for the first reply';
    case 'connected':
      return 'Connected';
  }
}

const VIA: Record<ConnectVia, string> = { connect: 'Connect radio', reconnect: 'Reconnect radio', auto: 'opened by RR73' };

/** The attempt as text to paste into a report, one step a line, times in UTC. */
export function connectLogText(a: ConnectAttempt | null, version: string, browser: string): string {
  const head = [`RR73 ${version} connection log`, `Browser: ${browser}`];
  if (!a) return [...head, 'No connection attempt stored.'].join('\n');
  const started = new Date(a.steps[0]?.atMs ?? 0).toISOString();
  const lines = [...head, `Radio: ${NAMES[a.radio]}, ${VIA[a.via]}, ${started.slice(0, 10)}`];
  for (const e of a.steps) lines.push(`${new Date(e.atMs).toISOString().slice(11, 23)} UTC  ${stepText(e, a)}`);
  if (a.failed) lines.push(`Failed: ${failureText(a.failed, a.radio)}`);
  else if (!reachedConnected(a)) lines.push('No further step recorded');
  lines.push(`Sent: ${a.sent ?? 'nothing'}`, `Received: ${a.received ?? 'nothing'}`);
  return lines.join('\n');
}

/** Forgets the attempt in progress on this page, leaving storage alone; tests only. */
export function resetConnectLog() {
  attempt = null;
}
