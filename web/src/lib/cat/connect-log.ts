/**
 * The steps of the last connection to the radio, kept in localStorage so they survive the browser
 * closing in the middle (docs/design/cat.md, Permission). Each step is written before it runs:
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
}

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
    return { radio: a.radio, via, steps: a.steps, ...(typeof a.failed === 'string' ? { failed: a.failed } : {}) };
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

/** Forgets the attempt in progress on this page, leaving storage alone; tests only. */
export function resetConnectLog() {
  attempt = null;
}
