/**
 * The QSO strip of a keyboard mode: the QSO being made, filled by the operator and from received
 * text, logged when the operator decides it is complete. There is no sequencer.
 *
 * Setting a callsign fills Name, QTH, RST received and, in the Contest set, Number received from
 * received text since that callsign first appeared within the last 10 min. A field the operator
 * typed is never overwritten. Time on is when the callsign first appeared in that window, or when
 * it was set.
 */

import type { LogQsoRecord, Qso } from '../log/types';
import { heard, type Heard } from './words';
import type { RxRun } from './transcript';

export const FILL_WINDOW_MS = 10 * 60_000;

export interface DraftFields {
  call: string;
  /** RST sent: 599 by default. */
  rstSent: string;
  rstRcvd: string;
  name: string;
  qth: string;
  /** Number received, in the Contest set. */
  srx: string;
  grid: string;
  notes: string;
}

export type DraftKey = keyof DraftFields;

export interface Draft {
  fields: DraftFields;
  /** Fields the operator typed: never filled from text. */
  typed: DraftKey[];
  /** Time on, UTC ms; null until a callsign is set. */
  startMs: number | null;
}

export const DEFAULT_RST = '599';

export function emptyDraft(): Draft {
  return { fields: { call: '', rstSent: DEFAULT_RST, rstRcvd: '', name: '', qth: '', srx: '', grid: '', notes: '' }, typed: [], startMs: null };
}

/** The operator's value for one field. A typed field stays as typed, even when emptied. */
export function editField(d: Draft, key: DraftKey, value: string): Draft {
  const v = key === 'notes' ? value : value.toUpperCase().trim();
  return { ...d, fields: { ...d.fields, [key]: v }, typed: d.typed.includes(key) ? d.typed : [...d.typed, key] };
}

/** Fills the fields the operator has not typed from what was heard. */
export function fill(d: Draft, h: Heard): Draft {
  const f = { ...d.fields };
  const put = (k: DraftKey, v: string | undefined) => {
    if (v && !d.typed.includes(k)) f[k] = v;
  };
  put('name', h.name);
  put('qth', h.qth);
  put('rstRcvd', h.rst);
  put('srx', h.nr);
  return { ...d, fields: f };
}

/**
 * Where `call` first appears in `runs` (received text of the last 10 min, oldest first): the
 * run's index and its time; null when it does not.
 */
export function firstMention(runs: readonly RxRun[], call: string): { index: number; atMs: number } | null {
  const re = new RegExp(`(^|[^A-Z0-9/])${call.replace(/[/]/g, '\\/')}($|[^A-Z0-9/])`);
  for (let i = 0; i < runs.length; i++) if (re.test(runs[i].text.toUpperCase())) return { index: i, atMs: runs[i].atMs };
  return null;
}

/**
 * Sets the QSO's callsign and fills the strip from that station's received text. `runs` is the
 * received text of the last 10 min, oldest first. A new callsign starts a new QSO: the other
 * fields return to their defaults, except those the operator typed for this one.
 */
export function setCall(d: Draft, call: string, runs: readonly RxRun[], nowMs: number, contest: boolean): Draft {
  const c = call.toUpperCase().trim();
  const fresh = c !== d.fields.call;
  const base: Draft = fresh ? { ...emptyDraft(), fields: { ...emptyDraft().fields, call: c }, typed: [] } : d;
  const at = firstMention(runs, c);
  const from = at ? runs.slice(at.index) : [];
  const filled = fill(base, heard(from.map((r) => r.text), contest));
  return { ...filled, startMs: fresh || d.startMs === null ? (at?.atMs ?? nowMs) : d.startMs };
}

/** Fills the strip again from text that arrived after the callsign was set. */
export function refill(d: Draft, runs: readonly RxRun[], contest: boolean): Draft {
  if (!d.fields.call) return d;
  const at = firstMention(runs, d.fields.call);
  if (!at) return d;
  return fill(d, heard(runs.slice(at.index).map((r) => r.text), contest));
}

export interface LogContext {
  mode: LogQsoRecord['mode'];
  band: string;
  dialHz: number;
  /** The pair's mark tone, Hz: FREQ is dial plus mark. */
  markHz: number;
  nowMs: number;
  /** The Contest set is in use. */
  contest: boolean;
  /** The serial number sent in this QSO, as sent ("042"). */
  stx: string;
  /** CONTEST_ID from Settings, or ''. */
  contestId: string;
}

/** The log record for the strip. */
export function record(d: Draft, ctx: LogContext): LogQsoRecord {
  const f = d.fields;
  return {
    call: f.call,
    grid: f.grid || null,
    mode: ctx.mode,
    band: ctx.band,
    dialHz: ctx.dialHz,
    audioHz: ctx.markHz,
    startUtcMs: d.startMs ?? ctx.nowMs,
    endUtcMs: ctx.nowMs,
    reportSent: f.rstSent,
    reportRcvd: f.rstRcvd,
    name: f.name,
    qth: f.qth,
    stx: ctx.contest ? ctx.stx : '',
    srx: ctx.contest ? f.srx : '',
    contestId: ctx.contest ? ctx.contestId : '',
    comment: f.notes,
    source: 'keyboard',
  };
}

/**
 * True when `call` is in the log on this band and mode; in the Contest set with a contest named,
 * only QSOs of that contest count.
 */
export function worked(qsos: readonly Qso[], call: string, band: string, mode: string, contestId: string | null): boolean {
  const c = call.toUpperCase();
  if (!c) return false;
  return qsos.some((q) => q.deletedAt === null && q.call === c && q.band === band.toLowerCase() && (q.submode || q.mode) === mode && (contestId === null || q.contestId === contestId));
}
