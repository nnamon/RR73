// Work on large sets in slices, so no task on the main thread runs much over SLICE_MS: reading
// Wavelog's log can mean 70 000 keys, and a long task can delay a transmission's start.

/** Gives the main thread back for one turn. */
export type Yield = () => Promise<void>;

/** Work per slice, ms. Slices are measured on the device, so a slower phone does less per slice. */
export const SLICE_MS = 5;

/**
 * A message through a channel: it runs as soon as the queue allows, where nested timers are held
 * to 4 ms or more.
 */
export const yieldToMain: Yield = () =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      ch.port2.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });

export interface SliceOptions {
  yield?: Yield;
  /** Checked after each slice: false stops the work. */
  alive?: () => boolean;
  sliceMs?: number;
}

/**
 * Calls `step` for each item, giving the main thread back after each `sliceMs` of work. Items
 * added to a Set while it runs are visited too. Resolves false when `alive` turned false.
 */
export async function inSlices<T>(items: Iterable<T>, step: (item: T) => void, opts: SliceOptions = {}): Promise<boolean> {
  const give = opts.yield ?? yieldToMain;
  const alive = opts.alive ?? (() => true);
  const budget = opts.sliceMs ?? SLICE_MS;
  let start = performance.now();
  let n = 0;
  for (const item of items) {
    step(item);
    if (++n % 64 === 0 && performance.now() - start >= budget) {
      await give();
      if (!alive()) return false;
      start = performance.now();
    }
  }
  return alive();
}
