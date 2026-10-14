/**
 * Operate's frame keeps the top bar, the waterfall and the bottom edge; each mode family brings
 * the middle of the screen and its bottom bar as one pane. A new family (RTTY, CW) adds its pane
 * here and leaves the others as they are.
 */

import type { Component } from 'svelte';
import type { Mode } from '../../lib/clock/slots';
import FtPane from './FtPane.svelte';
import WsprPane from './WsprPane.svelte';

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

export type Family = 'ft' | 'wspr';

export function familyOf(mode: Mode): Family {
  return mode === 'WSPR' ? 'wspr' : 'ft';
}

export const PANES: Record<Family, Component<PaneProps>> = { ft: FtPane, wspr: WsprPane };
