/**
 * Read Wavelog's log as reactive state: the keys read from Wavelog's log, laid over the
 * phone's log for decode colours, the New chip and Hide worked, and the switch, Refresh from
 * Wavelog and the status under it (docs/design/wavelog-worked.md).
 *
 * Cosmetic only, by the owner's rule: the sequencer's worked-before list, Hunt's and Repeat CQ's
 * orders and dupes come from the phone's log alone (state/qso.svelte.ts, workedFrom), and nothing
 * here reaches them. Reading pauses while the practice band is on, and its keys never colour
 * practice decodes.
 */

import { untrack } from 'svelte';
import type { DxccIndex } from '../reference/dxcc';
import { practice } from '../state/practice.svelte';
import { log, onDelivered, setWavelog } from './log.svelte';
import { systemClock } from './outbox';
import { workedStore } from './wavelog-worked-store';
import { WORKED_OFF, WorkedSync, type WorkedStatus } from './wavelog-worked';
import { bandModesOf, buildKeysIndex, type LogIndex, type WorkedKeys } from './worked';

class WavelogWorked {
  /** The keys read, while reading is on for the log in use; null otherwise. */
  keys = $state.raw<WorkedKeys | null>(null);
  status = $state.raw<WorkedStatus>(WORKED_OFF);
}

export const wavelogWorked = new WavelogWorked();

const sync = new WorkedSync({
  clock: systemClock,
  fetch: (input, init) => fetch(input, init),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  store: workedStore,
  onKeys: (keys) => (wavelogWorked.keys = keys),
  onStatus: (s) => (wavelogWorked.status = s),
});

/** True while the log in use is the operator's own, loaded, with the practice band off. */
function ownLog(): boolean {
  return log.ready && !log.practice && !practice.on;
}

let memo: { keys: WorkedKeys; countries: DxccIndex | null; index: LogIndex } | null = null;

/**
 * The index of what Wavelog's log holds, to lay over the log's with mergeLogIndex; null with
 * reading off, before the first read and while the practice band is on. Built once per change of
 * the keys or the country file, however many screens ask.
 */
export function wavelogIndex(countries: DxccIndex | null): LogIndex | null {
  const keys = wavelogWorked.keys;
  if (!keys || practice.on || log.practice) return null;
  if (memo && memo.keys === keys && memo.countries === countries) return memo.index;
  memo = { keys, countries, index: buildKeysIndex(keys, countries) };
  return memo.index;
}

/** The bands and modes Wavelog's log holds `call` on, as "20m FT8"; none with reading off. */
export function wavelogBandModes(call: string): string[] {
  const keys = wavelogWorked.keys;
  return keys && !practice.on && !log.practice ? bandModesOf(keys, call) : [];
}

/** Turns Read Wavelog's log on, which reads it at once, or off, which deletes what was read. */
export async function setReadWorked(on: boolean): Promise<void> {
  await setWavelog({ readWorked: on });
  if (!on) await sync.forget();
}

/** Refresh from Wavelog: reads Wavelog's log in full now. */
export function refreshFromWavelog(): Promise<void> {
  return sync.refresh();
}

let started = false;

/** Starts reading when the switch is on. Called once by the app, after the log has started loading. */
export function initWavelogWorked(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      const own = ownLog();
      const w = log.wavelog;
      const on = own && w.readWorked && !!w.url && !!w.apiKey;
      const source = on ? { url: w.url, apiKey: w.apiKey } : null;
      untrack(() => {
        // The switch off, or Wavelog removed, in the operator's log: what was read goes. With the
        // practice log in use, reading only pauses.
        if (own && !w.readWorked) void sync.forget();
        else void sync.use(source);
      });
    });
  });
  window.addEventListener('online', () => sync.online());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.kick();
  });
  onDelivered(() => sync.kick());
}
