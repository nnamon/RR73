/**
 * What the night display shows: the UTC clock, the next transmission or the one on air, and
 * the stations of the newest slot, strongest first. For long sessions at night: few lit
 * pixels, dim red, and a tap wakes Operate (ui/NightDisplay.svelte).
 */

import { snr, utcTime } from '../clock/format';
import { baseCall } from '../decode/marking';
import type { Decode } from '../decode/types';
import { parseExchange } from '../qso/messages';

/** Stations the night display lists at most. */
export const NIGHT_HEARD = 6;

export interface NightView {
  /** HH:MM:SS UTC. */
  clock: string;
  /** "On air: CQ 9V1NE OJ11", "Next at 13:14:30: CQ 9V1NE OJ11"; null with nothing planned. */
  tx: string | null;
  onAir: boolean;
  /** The newest slot's stations, strongest first: "JA1KXM −12". */
  heard: string[];
  /** Start of that slot, HH:MM:SS UTC; null before the first. */
  heardAt: string | null;
}

/** The stations sending in `decodes`, strongest first: one entry each, by base callsign, the operator and hashed calls left out. */
export function heardIn(decodes: readonly Decode[], myCall: string): string[] {
  const me = baseCall(myCall.trim().toUpperCase());
  const best = new Map<string, { call: string; snrDb: number }>();
  for (const d of decodes) {
    const from = parseExchange(d.text).from;
    if (!from || from.startsWith('<')) continue;
    const key = baseCall(from);
    if (key === me) continue;
    const cur = best.get(key);
    if (!cur || d.snr_db > cur.snrDb) best.set(key, { call: from, snrDb: d.snr_db });
  }
  return [...best.values()]
    .sort((a, b) => b.snrDb - a.snrDb)
    .slice(0, NIGHT_HEARD)
    .map((s) => `${s.call} ${snr(s.snrDb)}`);
}

/** FT8 and FT4: the sequencer's next or current transmission and the newest decoded slot. */
export function ftNight(
  nowMs: number,
  tx: { next: { text: string; slotStartMs: number } | null; onAir: { text: string } | null },
  slot: { startUtcMs: number; decodes: readonly Decode[] } | null,
  myCall: string,
): NightView {
  const line = tx.onAir ? `On air: ${tx.onAir.text}` : tx.next ? `Next at ${utcTime(tx.next.slotStartMs)}: ${tx.next.text}` : null;
  return { clock: utcTime(nowMs), tx: line, onAir: !!tx.onAir, heard: slot ? heardIn(slot.decodes, myCall) : [], heardAt: slot ? utcTime(slot.startUtcMs) : null };
}

/** WSPR: the beacon's next slot or its transmission on air, and the newest slot's spots. */
export function wsprNight(
  nowMs: number,
  beacon: { nextSlotMs: number | null; onAir: boolean },
  slot: { startUtcMs: number; spots: readonly { call: string | null; snrDb: number }[] } | null,
): NightView {
  const line = beacon.onAir ? 'On air: beacon' : beacon.nextSlotMs !== null ? `Beacon at ${utcTime(beacon.nextSlotMs)}` : null;
  const heard = slot
    ? [...slot.spots]
        .filter((s): s is { call: string; snrDb: number } => !!s.call)
        .sort((a, b) => b.snrDb - a.snrDb)
        .slice(0, NIGHT_HEARD)
        .map((s) => `${s.call} ${snr(s.snrDb)}`)
    : [];
  return { clock: utcTime(nowMs), tx: line, onAir: beacon.onAir, heard, heardAt: slot ? utcTime(slot.startUtcMs) : null };
}
