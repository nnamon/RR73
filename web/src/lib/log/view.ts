// What the Log and Spots screens show, as pure functions of the log: rows, day groups, status
// tags, the To do list and activation summaries.

import { MINUS, utcHm } from '../clock/format';
import { utcDayKey, utcDayStart } from './activation';
import { dayText, destinationOfPart, partLabel } from './files';
import { parsePartKey } from './ledger';
import { displayMode } from './qso';
import type { DestinationFacts } from './ledger';
import type { Activation, DestinationId, LedgerEntry, LedgerState, Qso } from './types';

/** "−12" for "-12"; "+05" stays. */
export function reportText(r: string): string {
  return r ? r.replace(/^-/, MINUS) : '?';
}

/**
 * "−12 / −10": sent, then received. "sent −12" or "received −10" when only one is known, and ''
 * when neither is, as for a QSO added by hand without reports.
 */
export function reportsText(q: Pick<Qso, 'rstSent' | 'rstRcvd'>): string {
  const sent = q.rstSent.trim();
  const rcvd = q.rstRcvd.trim();
  if (sent && rcvd) return `${reportText(sent)} / ${reportText(rcvd)}`;
  if (sent) return `sent ${reportText(sent)}`;
  if (rcvd) return `received ${reportText(rcvd)}`;
  return '';
}

/** "14.076" for 14075500 Hz: MHz to the nearest kHz, as on the radio's display. */
export function freqText(hz: number | null): string {
  return hz ? (Math.round(hz / 1000) / 1000).toFixed(3) : '';
}

/** "20m FT8 · 14.076 · QF56 · −12 / −10". */
export function qsoLine(q: Qso): string {
  return [`${q.band} ${displayMode(q)}`.trim(), freqText(q.freqHz), q.gridsquare, reportsText(q)].filter(Boolean).join(' · ');
}

const DAY_MS = 86_400_000;

/** "13 Oct 2026" for a UTC time. */
export function dateText(ms: number): string {
  return dayText(utcDayKey(ms));
}

/** "11 Oct" for a UTC time. */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "Today · 13 Oct 2026", "Yesterday · 12 Oct 2026", "11 Oct 2026", by UTC day. */
export function dayLabel(ms: number, now: number): string {
  const d = utcDayStart(ms);
  const today = utcDayStart(now);
  if (d === today) return `Today · ${dateText(ms)}`;
  if (d === today - DAY_MS) return `Yesterday · ${dateText(ms)}`;
  return dateText(ms);
}

export interface DayGroup {
  key: string;
  label: string;
  qsos: Qso[];
}

/** QSOs (newest first) in UTC day groups, newest day first. */
export function groupByDay(qsos: readonly Qso[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const q of qsos) {
    const key = utcDayKey(q.start);
    let g = groups.at(-1);
    if (!g || g.key !== key) groups.push((g = { key, label: dayLabel(q.start, now), qsos: [] }));
    g.qsos.push(q);
  }
  return groups;
}

/** Search by callsign, grid, reference or comment. */
export function matches(q: Qso, query: string): boolean {
  const t = query.trim().toUpperCase();
  if (!t) return true;
  return [q.call, q.gridsquare.toUpperCase(), q.myPotaRef, q.mySotaRef, q.myWwffRef, q.myIota, q.potaRef, q.sotaRef, q.wwffRef, q.iota, q.comment.toUpperCase()].some((f) => f.includes(t));
}

/** ok: delivered or submitted. wait: queued or needing a file. idle: not sent yet. bad: refused. */
export type Tone = 'ok' | 'wait' | 'idle' | 'bad';

export interface Tag {
  destination: DestinationId;
  state: LedgerState;
  /** Visible text: "Wavelog · waiting", or "Wavelog" with a tick when delivered. */
  text: string;
  /** For a screen reader: "Wavelog: delivered". */
  label: string;
  tone: Tone;
}

const STATE_WORDS: Record<LedgerState, string> = {
  'not-sent': 'not sent',
  waiting: 'waiting',
  delivered: 'delivered',
  refused: 'refused',
  changed: 'changed',
  'file-ready': 'file ready',
  submitted: 'submitted',
  'not-needed': 'not needed',
};

export function stateWords(s: LedgerState): string {
  return STATE_WORDS[s];
}

export function tagFor(e: LedgerEntry, name: string): Tag | null {
  if (e.state === 'not-needed') return null;
  const done = e.state === 'delivered' || e.state === 'submitted';
  const tone: Tone = done ? 'ok' : e.state === 'refused' ? 'bad' : e.state === 'not-sent' ? 'idle' : 'wait';
  return { destination: e.destinationId, state: e.state, text: done ? name : `${name} · ${STATE_WORDS[e.state]}`, label: `${name}: ${STATE_WORDS[e.state]}`, tone };
}

/** Entries that need the operator, or the outbox. */
export function needsAction(e: LedgerEntry): boolean {
  return e.state === 'not-sent' || e.state === 'waiting' || e.state === 'refused' || e.state === 'changed' || e.state === 'file-ready';
}

/** Ledger entries by QSO id. */
export function byQso(entries: readonly LedgerEntry[]): Map<string, LedgerEntry[]> {
  const m = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const l = m.get(e.qsoId);
    if (l) l.push(e);
    else m.set(e.qsoId, [e]);
  }
  return m;
}

/** Status tags for a row: the active direct destinations. File destinations show on activation cards. */
export function rowTags(entries: readonly LedgerEntry[] | undefined, facts: readonly DestinationFacts[]): Tag[] {
  const out: Tag[] = [];
  for (const f of facts) {
    if (f.transport === 'file' || !f.active) continue;
    const e = entries?.find((x) => x.destinationId === f.id);
    const t = e && tagFor(e, f.name);
    if (t) out.push(t);
  }
  return out;
}

/** The entry a row's Fix or Mark handled acts on: refused first, then changed. */
export function rowProblem(entries: readonly LedgerEntry[] | undefined, facts: readonly DestinationFacts[]): LedgerEntry | null {
  const live = (entries ?? []).filter((e) => facts.some((f) => f.id === e.destinationId && f.active && f.transport !== 'file'));
  return live.find((e) => e.state === 'refused') ?? live.find((e) => e.state === 'changed') ?? null;
}

/** QSOs on the To do list: not sent, waiting, refused or changed at an active direct destination. Deleted QSOs appear while a destination still holds them. */
export function todoQsos(qsos: readonly Qso[], index: Map<string, LedgerEntry[]>, facts: readonly DestinationFacts[]): Qso[] {
  const direct = new Set(facts.filter((f) => f.active && f.transport !== 'file').map((f) => f.id));
  return qsos.filter((q) => (index.get(q.id) ?? []).some((e) => direct.has(e.destinationId) && (e.state === 'not-sent' || e.state === 'waiting' || e.state === 'refused' || e.state === 'changed')));
}

export interface FileRow {
  key: string;
  destination: DestinationId;
  /** "POTA VK-0921, 13 Oct 2026". */
  label: string;
  /** file-ready until every QSO in it is submitted; changed when one changed after submission. */
  state: 'file-ready' | 'submitted' | 'changed';
  count: number;
  submittedAt: number | null;
}

/** The files of an activation at the active file destinations. */
export function activationFiles(activation: Activation, qsos: readonly Qso[], index: Map<string, LedgerEntry[]>, facts: readonly DestinationFacts[]): FileRow[] {
  const active = new Set(facts.filter((f) => f.active && f.transport === 'file').map((f) => f.id));
  const rows = new Map<string, FileRow>();
  for (const q of qsos) {
    if (q.activationId !== activation.id) continue;
    for (const e of index.get(q.id) ?? []) {
      if (!active.has(e.destinationId)) continue;
      for (const p of e.parts) {
        const key = parsePartKey(p.key);
        if (!key) continue;
        let row = rows.get(p.key);
        if (!row) rows.set(p.key, (row = { key: p.key, destination: destinationOfPart(key), label: partLabel(key), state: 'submitted', count: 0, submittedAt: null }));
        if (q.deletedAt === null) row.count++;
        if (p.submittedAt === null) row.state = row.state === 'changed' ? 'changed' : 'file-ready';
        else row.submittedAt = Math.max(row.submittedAt ?? 0, p.submittedAt);
        if (e.state === 'changed') row.state = 'changed';
      }
    }
  }
  const order: DestinationId[] = ['pota-file', 'sota-file', 'wwff-file', 'adif-file'];
  return [...rows.values()].filter((r) => r.count > 0 || r.state === 'changed').sort((a, b) => order.indexOf(a.destination) - order.indexOf(b.destination) || a.key.localeCompare(b.key));
}

export interface DirectSummary {
  destination: DestinationId;
  name: string;
  total: number;
  delivered: number;
  notSent: number;
  waiting: number;
  refused: number;
  changed: number;
}

/** Per active direct destination: how many of the activation's QSOs are where. */
export function activationDirect(activation: Activation, qsos: readonly Qso[], index: Map<string, LedgerEntry[]>, facts: readonly DestinationFacts[]): DirectSummary[] {
  const live = qsos.filter((q) => q.activationId === activation.id && q.deletedAt === null);
  return facts
    .filter((f) => f.active && f.transport !== 'file')
    .map((f) => {
      const s: DirectSummary = { destination: f.id, name: f.name, total: live.length, delivered: 0, notSent: 0, waiting: 0, refused: 0, changed: 0 };
      for (const q of live) {
        const e = index.get(q.id)?.find((x) => x.destinationId === f.id);
        if (!e || e.state === 'not-sent') s.notSent++;
        else if (e.state === 'waiting') s.waiting++;
        else if (e.state === 'delivered') s.delivered++;
        else if (e.state === 'refused') s.refused++;
        else if (e.state === 'changed') s.changed++;
      }
      return s;
    });
}

/** "Wavelog: all 7 delivered", "Wavelog: 5 of 7 delivered, 2 waiting". */
export function directText(s: DirectSummary): string {
  if (s.total === 0) return `${s.name}: no QSOs yet`;
  if (s.delivered === s.total) return `${s.name}: all ${s.total} delivered`;
  const rest = [s.notSent && `${s.notSent} not sent`, s.waiting && `${s.waiting} waiting`, s.refused && `${s.refused} refused`, s.changed && `${s.changed} changed`].filter(Boolean).join(', ');
  return `${s.name}: ${s.delivered} of ${s.total} delivered${rest ? `, ${rest}` : ''}`;
}

/** "POTA VK-0921, 13 Oct 2026: file ready", "SOTA VK3/VC-012, 12 Oct 2026: submitted 12 Oct". */
export function fileText(f: FileRow): string {
  if (f.state === 'submitted') return `${f.label}: submitted ${f.submittedAt ? shortDate(f.submittedAt) : ''}`.trim();
  if (f.state === 'changed') return `${f.label}: changed after submission`;
  return `${f.label}: file ready`;
}

/** One line for the summit: "Wavelog 7 waiting · POTA and SOTA files ready". */
export function afterLine(direct: readonly DirectSummary[], files: readonly FileRow[]): string {
  const parts: string[] = [];
  for (const d of direct) {
    if (d.refused) parts.push(`${d.name} ${d.refused} refused`);
    else if (d.notSent) parts.push(`${d.name} ${d.notSent} not sent`);
    else if (d.waiting) parts.push(`${d.name} ${d.waiting} waiting`);
    else if (d.total) parts.push(`${d.name} all delivered`);
  }
  const ready = [...new Set(files.filter((f) => f.state !== 'submitted').map((f) => (f.destination === 'adif-file' ? 'ADIF' : f.label.split(' ')[0])))];
  if (ready.length) parts.push(`${ready.length > 1 ? `${ready.slice(0, -1).join(', ')} and ${ready.at(-1)}` : ready[0]} ${ready.length > 1 ? 'files' : 'file'} ready`);
  return parts.length ? parts.join(' · ') : 'Nothing to send';
}

/** "13:32" on a row. */
export function rowTime(q: Qso): string {
  return utcHm(q.start);
}
