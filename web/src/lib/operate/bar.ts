/**
 * What Operate's bottom bar shows, from the sequencer state: the step row and the look of the Tx
 * button. The bar keeps one height in every state, so the list above it never moves.
 */

import type { SeqState } from '../qso/sequencer';
import { steps, type Step } from '../qso/view';

/** Calling CQ, answering or in a QSO. */
export function active(st: SeqState): boolean {
  return st.phase !== 'idle' || !!st.partner;
}

/**
 * The step row while active: calling CQ has its own steps (CQ, Report, R-report, RR73, Logged),
 * filled in with the reports once a station answers; answering a station has the QSO's steps.
 * Empty while idle.
 */
export function barSteps(st: SeqState): Step[] {
  if (st.phase !== 'cq') return active(st) ? steps(st) : [];
  if (!st.partner) {
    return [
      { label: 'CQ', state: 'now' },
      { label: 'Report', state: 'todo' },
      { label: 'R-report', state: 'todo' },
      { label: st.config.ack, state: 'todo' },
      { label: 'Logged', state: 'todo' },
    ];
  }
  return steps(st).map((s, i) => (i === 0 ? { ...s, label: 'CQ' } : s));
}

export type TxLook = 'off' | 'on' | 'air';

/** The Tx button: Tx off (grey), Tx on (a light accent tint), On air (solid red with a blinking dot) while anything transmits. */
export function txButton(enabled: boolean, transmitting: boolean): { look: TxLook; label: string } {
  if (transmitting) return { look: 'air', label: 'On air' };
  return enabled ? { look: 'on', label: 'Tx on' } : { look: 'off', label: 'Tx off' };
}
