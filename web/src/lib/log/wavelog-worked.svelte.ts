/**
 * Read Wavelog's log as reactive state: the index of what Wavelog's log holds, laid over the
 * phone's log for decode colours, the New chip and Hide worked, and the switch, Refresh from
 * Wavelog and the status under it (docs/design/wavelog-worked.md).
 *
 * Cosmetic only, by the owner's rule: the sequencer's worked-before list, Hunt's and Repeat CQ's
 * orders and dupes come from the phone's log alone (state/qso.svelte.ts, sequencerWorked), and
 * nothing here reaches them. Reading pauses while the practice band is on, and what was read never
 * colours practice decodes.
 *
 * The index is built in slices (slices.ts), at start and after each full read, and new keys from
 * a check go into it in place, so no task on the main thread runs much over 5 ms.
 */

import { untrack } from 'svelte';
import { reference } from '../reference';
import type { DxccIndex } from '../reference/dxcc';
import { practice } from '../state/practice.svelte';
import { log, onDelivered, setWavelog } from './log.svelte';
import { systemClock } from './outbox';
import { inSlices } from './slices';
import { workedStore } from './wavelog-worked-store';
import { WORKED_OFF, WorkedSync, type KeysChange, type WorkedStatus } from './wavelog-worked';
import { bandModesOf, IndexBuilder, type LogIndex, type WorkedKeys } from './worked';

class WavelogWorked {
  status = $state.raw<WorkedStatus>(WORKED_OFF);
  /** The index of what was read, once built; null before and with reading off. */
  index = $state.raw<LogIndex | null>(null);
  /** Changes when new keys go into the index in place. */
  version = $state(0);
}

export const wavelogWorked = new WavelogWorked();

/** The keys the index is for, and the build under way. */
let keys: WorkedKeys | null = null;
let built: { keys: WorkedKeys; builder: IndexBuilder } | null = null;
let building: { keys: WorkedKeys; builder: IndexBuilder } | null = null;
let buildEpoch = 0;
let countries: DxccIndex | null = null;
let warming = false;

/** Builds the index of `keys` in slices; a later build or a stop drops it. */
async function rebuild(): Promise<void> {
  const k = keys;
  if (!k) return;
  const epoch = ++buildEpoch;
  const alive = () => epoch === buildEpoch;
  const b = { keys: k, builder: new IndexBuilder(countries) };
  building = b;
  // Keys added to the sets while this runs are visited too.
  const done = (await inSlices(k.calls, (x) => b.builder.addCallKey(x), { alive })) && (await inSlices(k.grids, (x) => b.builder.addGridKey(x), { alive }));
  if (!done) return;
  building = null;
  built = b;
  wavelogWorked.index = b.builder.index;
  wavelogWorked.version++;
}

/** The country file places Wavelog's calls too: once it loads, the index is built again with it. */
function warmCountries() {
  countries ??= reference.loadedCountries();
  if (warming || countries) return;
  warming = true;
  void reference.warm().then(() => {
    const c = reference.loadedCountries();
    if (c && c !== countries) {
      countries = c;
      if (keys) void rebuild();
    }
  });
}

function onKeys(change: KeysChange) {
  if (change.kind === 'none') {
    keys = null;
    built = null;
    building = null;
    buildEpoch++;
    wavelogWorked.index = null;
    return;
  }
  if (change.kind === 'all') {
    keys = change.keys;
    warmCountries();
    void rebuild();
    return;
  }
  // New keys from a check: into the index in place, and into a build under way, which may have
  // passed them by.
  const into = [built, building].filter((b): b is NonNullable<typeof b> => !!b && b.keys === change.keys);
  if (!into.length) {
    keys = change.keys;
    void rebuild();
    return;
  }
  for (const b of into) {
    for (const k of change.calls) b.builder.addCallKey(k);
    for (const k of change.grids) b.builder.addGridKey(k);
  }
  if (built?.keys === change.keys) wavelogWorked.version++;
}

const sync = new WorkedSync({
  clock: systemClock,
  fetch: (input, init) => fetch(input, init),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  store: workedStore,
  onKeys,
  onStatus: (s) => (wavelogWorked.status = s),
});

/** True while the log in use is the operator's own, loaded, with the practice band off. */
function ownLog(): boolean {
  return log.ready && !log.practice && !practice.on;
}

/**
 * The index of what Wavelog's log holds, to lay over the log's with mergeLogIndex; null with
 * reading off, before the first index is built and while the practice band is on. Reading it in
 * a $derived follows new keys going in.
 */
export function wavelogIndex(): LogIndex | null {
  void wavelogWorked.version;
  return practice.on || log.practice ? null : wavelogWorked.index;
}

/** The bands and modes Wavelog's log holds `call` on, as "20m FT8"; none with reading off. */
export function wavelogBandModes(call: string): string[] {
  const index = wavelogIndex();
  return index ? bandModesOf(index, call) : [];
}

/**
 * Turns Read Wavelog's log on, which reads what is new at once, or off, which stops using it and
 * keeps what was read, so switching on again needs only the QSOs added since.
 */
export async function setReadWorked(on: boolean): Promise<void> {
  await setWavelog({ readWorked: on });
}

/** Deletes what was read, as Remove Wavelog does. */
export function forgetWavelogRead(): Promise<void> {
  return sync.forget();
}

/** Refresh from Wavelog: reads Wavelog's log in full now. */
export function refreshFromWavelog(): Promise<void> {
  return sync.refresh();
}

/** Reads what is new in Wavelog's log now, for the end-to-end tests. */
export async function checkWavelogNow(): Promise<void> {
  await sync.check();
  await sync.idle();
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
      const source = own && w.readWorked && !!w.url && !!w.apiKey ? { url: w.url, apiKey: w.apiKey } : null;
      untrack(() => {
        void sync.use(source);
      });
    });
  });
  window.addEventListener('online', () => sync.online());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.kick();
  });
  onDelivered(() => sync.kick());
}
