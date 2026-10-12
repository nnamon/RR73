/**
 * Builds the decode list: newest slot first, a header per slot, rows marked as in WSJT-X, and
 * the chip filters.
 */

import { utcTime } from '../clock/format';
import type { Mode } from '../clock/slots';
import { markDecode, type DecodeRowData } from './marking';
import type { Decode } from './types';

export type Filter = 'all' | 'cq' | 'me' | 'rx';

/** Decodes within this distance of the receive frequency pass the Rx freq filter, Hz. */
export const RX_WINDOW_HZ = 10;

export interface SlotDecodes {
  startUtcMs: number;
  mode: Mode;
  decodes: Decode[];
  /** Time the decoder took, ms. */
  ms: number;
  skipped?: boolean;
}

export type ListItem = { kind: 'header'; id: string; text: string } | { kind: 'row'; id: string; row: DecodeRowData };

/** "13:14:15 UTC · 23 decodes · decoded in 0.38 s". */
export function slotHeader(s: SlotDecodes): string {
  const t = `${utcTime(s.startUtcMs)} UTC`;
  if (s.skipped) return `${t} · not decoded: the decoder was busy with earlier slots`;
  const n = s.decodes.length;
  return `${t} · ${n} ${n === 1 ? 'decode' : 'decodes'} · decoded in ${(s.ms / 1000).toFixed(2)} s`;
}

function passes(row: DecodeRowData, filter: Filter, rxHz: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'rx') return Math.abs(row.decode.freq_hz - rxHz) <= RX_WINDOW_HZ;
  return row.mark === filter;
}

/**
 * List items for `slots` (any order; shown newest first). With a filter, slots with no
 * matching decode are left out; with none, every slot shows its header.
 */
export function buildList(slots: SlotDecodes[], myCall: string, filter: Filter, rxHz: number): ListItem[] {
  const out: ListItem[] = [];
  for (const s of [...slots].sort((a, b) => b.startUtcMs - a.startUtcMs)) {
    const rows = s.decodes.map((d) => ({ decode: d, ...markDecode(d, myCall) })).filter((r) => passes(r, filter, rxHz));
    if (!rows.length && filter !== 'all') continue;
    out.push({ kind: 'header', id: `h${s.startUtcMs}`, text: slotHeader(s) });
    rows.forEach((row, i) => out.push({ kind: 'row', id: `${s.startUtcMs}-${i}`, row }));
  }
  return out;
}

/** Decodes per filter, for the chips. */
export function filterCounts(slots: SlotDecodes[], myCall: string, rxHz: number): Record<Filter, number> {
  const rows = slots.flatMap((s) => s.decodes.map((d) => ({ decode: d, ...markDecode(d, myCall) })));
  return {
    all: rows.length,
    cq: rows.filter((r) => r.mark === 'cq').length,
    me: rows.filter((r) => r.mark === 'me').length,
    rx: rows.filter((r) => passes(r, 'rx', rxHz)).length,
  };
}
