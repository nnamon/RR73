/**
 * Callsigns on the waterfall: the sender of each decode in the slots on screen, written over its
 * signal in a row at the bottom of its slot, the row the slot's time starts. Where labels would
 * overlap, the one that ranks higher stays: messages to the operator, then decodes with a decode
 * colour in the operator's order, then CQs, then the strongest. A slot takes as many rows as its
 * height allows, at most 2; the first row leaves room for the time.
 */

import { parseExchange } from '../qso/messages';
import { baseCall } from '../decode/marking';
import type { HighlightEntry } from '../decode/highlight';
import type { Facts, SlotDecodes } from '../decode/list';

export interface WaterfallCall {
  /** Start of the decode's slot, UTC ms. */
  slotStartMs: number;
  /** Audio frequency of the signal's lowest tone, Hz. */
  hz: number;
  /** The sender's callsign, as decoded. */
  text: string;
  /** The decode's colour, #RRGGBB, or null. */
  colour: string | null;
  /** The message is addressed to the operator. */
  you: boolean;
}

export interface PlacedCall extends WaterfallCall {
  key: string;
  /** From the left of the picture, px. */
  x: number;
  /** From the top of the picture, px. */
  top: number;
}

/** Height of a row of labels, and the gap above a slot line, px: the time label's. */
export const ROW_PX = 14;
/** Rows of labels a slot takes at most. */
const MAX_ROWS = 2;
/** Space between labels in a row, px. */
const GAP_PX = 3;

/**
 * The labels for `slots`, highest rank first. `facts` gives each decode's row (lib/decode/list.ts);
 * `entries` are the operator's decode colours, whose order ranks the coloured decodes.
 */
export function waterfallCalls(slots: readonly SlotDecodes[], facts: Facts, myCall: string, entries: readonly HighlightEntry[]): WaterfallCall[] {
  const me = baseCall(myCall.trim().toUpperCase());
  const order = new Map(entries.map((e, i) => [e.id, i]));
  const ranked: { call: WaterfallCall; rank: number; snr: number }[] = [];
  for (const s of slots)
    for (const d of s.decodes) {
      const from = parseExchange(d.text).from;
      if (!from || from.startsWith('<') || (me && baseCall(from) === me)) continue;
      const { row, toYou } = facts(d);
      const colour = row.hl ? (entries.find((e) => e.id === row.hl)?.colour ?? null) : null;
      const rank = toYou ? 0 : row.hl ? 1 + (order.get(row.hl) ?? 0) : row.mark === 'cq' ? 1000 : 2000;
      ranked.push({ call: { slotStartMs: s.startUtcMs, hz: d.freq_hz, text: from, colour, you: toYou }, rank, snr: d.snr_db });
    }
  return ranked.sort((a, b) => a.rank - b.rank || b.snr - a.snr).map((r) => r.call);
}

export interface Placement {
  /** Slot starts on screen and the y of their lines, px from the top of the picture. */
  lines: readonly { utcMs: number; y: number }[];
  /** Height of one slot in the picture, px. */
  slotPx: number;
  /** Width of the picture, px. */
  width: number;
  /** Lowest y a label may reach, px: the top of the ruler. */
  bottom: number;
  /** Width of one character of the label font, px, and the label's padding on both sides together. */
  charPx: number;
  padPx: number;
  /** Right edge of the slot's time label, px from the left. */
  timeRight: number;
  /** Position of a frequency across the picture, 0 to 1. */
  xOf: (hz: number) => number;
}

/** Places `calls` (highest rank first) over the picture; a label with no room is left out. */
export function placeCalls(calls: readonly WaterfallCall[], p: Placement): PlacedCall[] {
  const rows = Math.min(MAX_ROWS, Math.floor(p.slotPx / ROW_PX));
  const out: PlacedCall[] = [];
  const keys = new Set<string>();
  for (const line of p.lines) {
    // Rows from the bottom of the slot up; a row off the top or over the ruler takes nothing.
    const tops = Array.from({ length: rows }, (_, r) => line.y - ROW_PX * (r + 1)).filter((t) => t >= 0 && t + ROW_PX - 1 <= p.bottom);
    const taken: [number, number][][] = tops.map((_, r) => (r === 0 ? [[0, p.timeRight]] : []));
    for (const c of calls) {
      const key = `${c.slotStartMs}-${c.text}-${Math.round(c.hz)}`;
      if (c.slotStartMs !== line.utcMs || keys.has(key)) continue;
      const w = c.text.length * p.charPx + p.padPx;
      const x = Math.max(0, Math.min(p.width - w, p.xOf(c.hz) * p.width));
      const r = taken.findIndex((spans) => spans.every(([a, b]) => x + w + GAP_PX <= a || x >= b + GAP_PX));
      if (r < 0) continue;
      taken[r].push([x, x + w]);
      keys.add(key);
      out.push({ ...c, key, x, top: tops[r] });
    }
  }
  return out;
}
