/**
 * What the bottom bar shows, worked out from the sequencer state: the QSO's progress steps and
 * the status line. Times are UTC.
 */

import { MINUS, signed as signedNum, utcTime } from '../clock/format';
import { parity as parityOf } from '../clock/slots';
import { formatReport, bare } from './messages';
import { messages, type SeqState } from './sequencer';
import { PAUSED, STATUS } from './status';

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
        // A Hound logs on the Fox's RR73 and sends no 73.
        st.config.hound ? ['Logged', p.logged] : ['73', p.logged && !st.onAir && st.current !== 5],
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

/**
 * The bottom bar's status line while calling or in a QSO: what is on air, what goes next with
 * its slot and second ("Tx6 · CQ 9V1NE OJ11 · 1st · :30"), or what RR73 waits for. Null when
 * idle.
 */
export function barText(st: SeqState): string | null {
  const m = messages(st);
  const p = st.partner;
  if (st.onAir) return `Tx${st.onAir.tx} · ${st.onAir.text}`;
  if (st.paused && st.current) return `Tx${st.current} · ${m[st.current]} · ${st.pausedWhy ?? PAUSED.noReply}`;
  if (p && st.lost?.state === 'watching') return `${bare(p.call)} · working ${st.lost.other}`;
  if (st.next) {
    const n = st.next;
    const start = n.slotStartMs + n.offsetS * 1000;
    return `Tx${n.tx} · ${n.text} · ${ordinal(parityOf(n.slotStartMs, st.config.mode))} · :${utcTime(start).slice(6)}`;
  }
  if (p?.logged) return `${bare(p.call)} logged`;
  if (p) return `${bare(p.call)} · waiting for a reply`;
  if (st.phase === 'cq') return 'CQ · waiting for callers';
  return null;
}

/**
 * Hunt's status line: "Hunt · calling VJ6X (−12 dB) · 2 QSOs". Null when Hunt is off.
 */
export function huntText(st: SeqState): string | null {
  if (!st.hunt) return null;
  const p = st.partner;
  const n = st.huntQsos;
  const tally = n ? ` · ${n} ${n === 1 ? 'QSO' : 'QSOs'}` : '';
  let what = 'listening for CQs';
  if (p) {
    const call = bare(p.call);
    const db = Math.round(p.snrDb);
    if (st.lost?.state === 'watching') what = `${call} is working ${st.lost.other}`;
    else if (p.logged) what = `${call} logged`;
    else if (p.rcvdRpt || p.rcvdAck) what = `working ${call}`;
    else what = `calling ${call} (${db > 0 ? '+' : ''}${signedNum(db)} dB)`;
  }
  return `Hunt · ${what}${tally}`;
}

/**
 * Hound's status line, the stage of the QSO with the Fox: "Calling the Fox · KH7Z",
 * "Report received · −13 dB from KH7Z", "Logged · KH7Z". Null outside Hound mode, with no Fox
 * called, or when answering has given up.
 */
export function houndText(st: SeqState): string | null {
  if (!st.config.hound) return null;
  const p = st.partner;
  if (!p) return st.houndLogged ? STATUS.houndLogged(st.houndLogged) : null;
  const call = bare(p.call);
  if (p.logged) return STATUS.houndLogged(call);
  if (st.paused) return null;
  if (p.rcvdRpt && p.reportRcvd !== null) return STATUS.houndReport(signed(formatReport(p.reportRcvd)), call);
  return STATUS.houndCalling(call);
}

/**
 * The Tx frequency the waterfall marks, Hz: where the transmission on air or planned goes. In
 * Hound mode the R-report and its repeats go where the Fox called us, and the mark stays there
 * between repeats; otherwise, and after the QSO, it is the operator's Tx frequency.
 */
export function markedTxHz(st: SeqState, operatorHz: number): number {
  if (st.onAir) return st.onAir.freqHz ?? operatorHz;
  if (st.next) return st.next.freqHz ?? operatorHz;
  const p = st.partner;
  if (st.config.hound && p?.rcvdRpt && !p.logged && st.lastSent?.tx === 3) return st.lastSent.freqHz ?? operatorHz;
  return operatorHz;
}

/** "Watchdog 5:40", the time left before the watchdog stops Tx; "Tx off" while Tx is off. */
export function watchdogText(st: SeqState, nowMs: number): string {
  if (!st.txEnabled) return 'Tx off';
  if (st.config.watchdogMs <= 0) return 'Watchdog off';
  const left = Math.max(0, st.config.watchdogMs - (nowMs - st.watchdogFromMs));
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `Watchdog ${m}:${String(s).padStart(2, '0')}`;
}

/** Run's tally: "3 QSOs · 18/h". Null until Run has logged a QSO. */
export function runTally(rate: { total: number; hour: number }): string | null {
  if (rate.total < 1) return null;
  return `${rate.total} ${rate.total === 1 ? 'QSO' : 'QSOs'} · ${rate.hour}/h`;
}
