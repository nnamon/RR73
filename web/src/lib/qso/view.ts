/**
 * What the dock shows, worked out from the sequencer state: the QSO's progress steps, the next
 * message and when it starts, and the status line. Times are UTC.
 */

import { MINUS, utcTime } from '../clock/format';
import { SLOT_MS } from '../clock/slots';
import { formatReport, bare } from './messages';
import { messages, type SeqState } from './sequencer';

export type StepState = 'done' | 'now' | 'next' | 'todo';

export interface Step {
  label: string;
  state: StepState;
}

const signed = (r: string) => r.replace('-', MINUS);
const ordinal = (p: 'even' | 'odd') => (p === 'even' ? '1st' : '2nd');

/** The 5 steps of the exchange, from our side. */
export function steps(st: SeqState): Step[] {
  const p = st.partner;
  if (!p) return [];
  const rpt = (v: number | null) => (v === null ? null : signed(formatReport(v)));
  const sent = rpt(p.reportSent);
  const rcvd = rpt(p.reportRcvd);
  // Answering: our grid, their report, our R-report, their RR73, our 73.
  // Called by them (CQ): their grid, our report, their R-report, our RR73, logged.
  const calling = st.phase === 'cq';
  const list: [string, boolean][] = calling
    ? [
        [p.grid ?? 'Call', true],
        [sent ?? 'Report', p.sentRpt],
        [rcvd ? `R${rcvd}` : 'R-report', p.rcvdRRpt],
        [st.config.ack, p.sentAck],
        ['Logged', p.logged],
      ]
    : [
        ['Grid', p.startMs !== null || p.rcvdRpt],
        [rcvd ?? 'Report', p.rcvdRpt],
        [sent ? `R${sent}` : 'R-report', p.sentRRpt],
        [st.config.ack, p.rcvdAck],
        ['73', p.logged && !st.onAir && st.current !== 5],
      ];
  let marked = false;
  return list.map(([label, done]) => {
    if (done) return { label, state: 'done' };
    if (!marked) {
      marked = true;
      return { label, state: 'now' };
    }
    return { label, state: 'todo' };
  });
}

export interface NextLine {
  /** "Tx 5 · JA1KXM 9V1NE 73". */
  title: string;
  /** "Starts 13:15:00", "Starts 13:15:00 once RR73 is decoded", "Too late for :00, starts :30". */
  detail: string;
}

/** The next message and when it starts; null when nothing is planned or awaited. */
export function nextLine(st: SeqState, nowMs: number): NextLine | null {
  const len = SLOT_MS[st.config.mode];
  const m = messages(st);
  const parity = st.parity ? ` (${ordinal(st.parity)})` : '';
  if (st.paused && st.current) {
    return { title: `Tx ${st.current} · ${m[st.current]}`, detail: `No reply after ${st.config.maxRetries} repeats. Tap Call to try again.` };
  }
  if (st.next) {
    const n = st.next;
    const start = n.slotStartMs + n.offsetS * 1000;
    const late = n.offsetS > 0.5 ? `, ${(n.offsetS - 0.5).toFixed(1)} s late` : '';
    let detail = `Starts ${utcTime(start)}${parity}${late}`;
    if (n.tooLateFor !== null) {
      const ss = (ms: number) => `:${utcTime(ms).slice(6)}`;
      detail = `Too late for ${ss(n.tooLateFor + 500)}, starts ${ss(start)}`;
    }
    if (!st.txEnabled) detail = `Enable Tx to send it at ${utcTime(start)}`;
    return { title: `Tx ${n.tx} · ${n.text}`, detail };
  }
  const p = st.partner;
  const last = st.onAir ?? st.lastSent;
  if (!last) return null;
  const startNext = last.slotStartMs + 2 * len + 500;
  const at = utcTime(Math.max(startNext, nowMs));
  if (st.phase === 'cq' && !p) return { title: 'Calling CQ', detail: 'Callers are answered in the next slot' };
  if (!p) return null;
  const who = bare(p.call);
  const expect = (tx: 1 | 2 | 3 | 4 | 5, what: string) => ({ title: `Tx ${tx} · ${m[tx]}`, detail: `Starts ${at} once ${what} is decoded` });
  if (st.phase === 'cq') {
    if (p.logged) return { title: `${who} is logged`, detail: 'The next caller or CQ follows' };
    if (p.sentRpt && !p.rcvdRRpt) return expect(4, `${who}'s R-report`);
  } else {
    if (p.sentRRpt) return expect(5, st.config.ack);
    if (p.startMs !== null && !p.rcvdRpt) return expect(3, `${who}'s report`);
  }
  return null;
}

/** "Watchdog 5:40", the time left before the watchdog stops Tx; "Tx off" while Tx is off. */
export function watchdogText(st: SeqState, nowMs: number): string {
  if (!st.txEnabled) return 'Tx off';
  const left = Math.max(0, st.config.watchdogMs - (nowMs - st.watchdogFromMs));
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `Watchdog ${m}:${String(s).padStart(2, '0')}`;
}

/** "Auto Seq on · Hold Tx 1500 Hz · Watchdog 5:40"; without Hold Tx, "Tx 1500 Hz". */
export function statusLine(st: SeqState, nowMs: number, holdTx = true): string {
  return `Auto Seq on · ${holdTx ? 'Hold Tx' : 'Tx'} ${st.config.txHz} Hz · ${watchdogText(st, nowMs)}`;
}

/** Run's tally after "Run · ": "3 QSOs · 12 per hour". Null until Run has logged a QSO. */
export function runTally(rate: { total: number; hour: number }): string | null {
  if (rate.total < 1) return null;
  return `${rate.total} ${rate.total === 1 ? 'QSO' : 'QSOs'} · ${rate.hour} per hour`;
}
