/**
 * Operate's WSPR list, newest slot first (docs/design/wspr.md, Operate): one header per slot,
 * then its spots in the chosen order. The slot in progress says when its spots arrive; a slot
 * the beacon transmitted in shows its Sent row; the next slot shows a Next row when it is a Tx
 * slot; a run of slots with no spots shares one header. Spots of slots older than the newest slot
 * with spots fade.
 */

import { utcHm } from '../clock/format';
import { sortSpots, type Spot, type SpotSort } from './spots';
import { WSPR_SLOT_MS, wsprSlot } from './schedule';

export interface SlotIn {
  startUtcMs: number;
  spots: Spot[];
  skipped: boolean;
}

export interface TxIn {
  slotStartMs: number;
  text: string;
  freqHz: number;
  complete: boolean;
}

export type TxStage = 'next' | 'sending' | 'sent';

export type WsprItem =
  | {
      kind: 'header';
      id: string;
      /** "14:04", or "14:00 to 14:30" for a run of empty slots. */
      time: string;
      detail: string;
      /** live: the slot in progress; tx: a Tx slot; done: decoded; quiet: no spots. */
      tone: 'live' | 'tx' | 'done' | 'quiet';
    }
  | { kind: 'spot'; id: string; spot: Spot; old: boolean }
  | { kind: 'tx'; id: string; stage: TxStage; slotStartMs: number; text: string; freqHz: number; complete: boolean };

export interface ListInput {
  nowMs: number;
  slots: readonly SlotIn[];
  sent: readonly TxIn[];
  sort: SpotSort;
  /** Audio runs, so the slot in progress is being received. */
  live: boolean;
  /** The WSPR slot the decoder works on, UTC ms. */
  decoding: number | null;
  /** On air now. */
  onAir: { slotStartMs: number; text: string; freqHz: number } | null;
  /** The next transmission, when one is planned. */
  next: { slotStartMs: number; text: string; freqHz: number } | null;
}

const spotsText = (n: number) => (n === 1 ? '1 spot' : `${n} spots`);

export function buildWsprList(input: ListInput): WsprItem[] {
  const { nowMs, sort, live, decoding, onAir, next } = input;
  const out: WsprItem[] = [];
  const current = wsprSlot(nowMs);
  const sentBy = new Map(input.sent.map((s) => [s.slotStartMs, s]));

  // A Next row when the slot after this one is a Tx slot.
  if (next && !onAir && next.slotStartMs === current + WSPR_SLOT_MS) {
    out.push({ kind: 'header', id: `h${next.slotStartMs}`, time: utcHm(next.slotStartMs), detail: 'next', tone: 'tx' });
    out.push({ kind: 'tx', id: `t${next.slotStartMs}`, stage: 'next', slotStartMs: next.slotStartMs, text: next.text, freqHz: next.freqHz, complete: true });
  }

  // The slot in progress: on air, or being received.
  const sentNow = sentBy.get(current);
  if (onAir && onAir.slotStartMs === current) {
    out.push({ kind: 'header', id: `h${current}`, time: utcHm(current), detail: 'sending', tone: 'tx' });
    out.push({ kind: 'tx', id: `t${current}`, stage: 'sending', slotStartMs: current, text: onAir.text, freqHz: onAir.freqHz, complete: true });
  } else if (sentNow) {
    out.push({ kind: 'header', id: `h${current}`, time: utcHm(current), detail: 'sent', tone: 'tx' });
    out.push({ kind: 'tx', id: `t${current}`, stage: 'sent', slotStartMs: current, text: sentNow.text, freqHz: sentNow.freqHz, complete: sentNow.complete });
  } else if (live) {
    out.push({ kind: 'header', id: `h${current}`, time: utcHm(current), detail: `receiving, spots at ${utcHm(current + WSPR_SLOT_MS)}`, tone: 'live' });
  }

  // Decoded slots and the Tx slots before this one, newest first.
  const starts = new Set<number>();
  for (const s of input.slots) if (s.startUtcMs < current) starts.add(s.startUtcMs);
  for (const s of input.sent) if (s.slotStartMs < current) starts.add(s.slotStartMs);
  if (decoding !== null && decoding < current) starts.add(decoding);
  const byStart = new Map(input.slots.map((s) => [s.startUtcMs, s]));
  const newestWithSpots = input.slots.reduce((m, s) => (s.spots.length && s.startUtcMs > m ? s.startUtcMs : m), -Infinity);

  let quiet: number[] = [];
  const flushQuiet = () => {
    if (!quiet.length) return;
    const newest = quiet[0];
    const oldest = quiet[quiet.length - 1];
    const time = quiet.length > 1 ? `${utcHm(oldest)} to ${utcHm(newest)}` : utcHm(newest);
    out.push({ kind: 'header', id: `q${newest}`, time, detail: 'no spots', tone: 'quiet' });
    quiet = [];
  };

  for (const start of [...starts].sort((a, b) => b - a)) {
    const tx = sentBy.get(start);
    if (tx) {
      flushQuiet();
      out.push({ kind: 'header', id: `h${start}`, time: utcHm(start), detail: 'sent', tone: 'tx' });
      out.push({ kind: 'tx', id: `t${start}`, stage: 'sent', slotStartMs: start, text: tx.text, freqHz: tx.freqHz, complete: tx.complete });
      continue;
    }
    const slot = byStart.get(start);
    if (!slot) {
      flushQuiet();
      out.push({ kind: 'header', id: `h${start}`, time: utcHm(start), detail: 'decoding', tone: 'live' });
      continue;
    }
    if (!slot.spots.length) {
      if (slot.skipped) {
        flushQuiet();
        out.push({ kind: 'header', id: `h${start}`, time: utcHm(start), detail: 'not decoded', tone: 'quiet' });
      } else quiet.push(start);
      continue;
    }
    flushQuiet();
    out.push({ kind: 'header', id: `h${start}`, time: utcHm(start), detail: spotsText(slot.spots.length), tone: 'done' });
    const old = start < newestWithSpots;
    for (const spot of sortSpots(slot.spots, sort)) out.push({ kind: 'spot', id: spot.id, spot, old });
  }
  flushQuiet();
  return out;
}
