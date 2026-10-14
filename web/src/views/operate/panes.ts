/**
 * Operate's frame keeps the top bar, the waterfall and the bottom edge; each mode family brings
 * the middle of the screen and its bottom bar as one pane. A new family (CW) adds its pane here
 * and leaves the others as they are. The keyboard family (RTTY, and PSK31 and the other keyboard
 * modes after it) shares KeyboardPane, which takes the mode's tuning row.
 *
 * A pane renders its two parts as top-level elements marked data-part="middle" (the list, the
 * received text) and data-part="controls" (the bar with Halt). On the phone they flow in the
 * frame's one column (display: contents); in compact height and regular width the frame places
 * them (views/Operate.svelte): the middle beside or under the waterfall, the controls in the
 * column on the right, the transmit panel or the bottom bar. A pane reads the size class from
 * lib/app/layout.svelte.ts to draw its parts for the room they get.
 */

import type { Component } from 'svelte';
import { isKeyboard, type Mode } from '../../lib/clock/slots';
import FtPane from './FtPane.svelte';
import WsprPane from './WsprPane.svelte';
import KeyboardPane from './KeyboardPane.svelte';

/** The waterfall as a pane uses it. */
export interface WaterfallHandle {
  /** The quietest Tx frequency in the last slots, Hz, or null. */
  quietest(): Promise<number | null>;
}

export interface PaneProps {
  /** False while another screen is pushed over Operate: the pane keeps its place for the return. */
  active?: boolean;
  waterfall?: WaterfallHandle;
}

export type Family = 'ft' | 'wspr' | 'keyboard';

export function familyOf(mode: Mode): Family {
  return mode === 'WSPR' ? 'wspr' : isKeyboard(mode) ? 'keyboard' : 'ft';
}

export const PANES: Record<Family, Component<PaneProps>> = { ft: FtPane, wspr: WsprPane, keyboard: KeyboardPane };
