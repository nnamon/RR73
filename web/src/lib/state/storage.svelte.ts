// The database's state (db.ts) as reactive state for the screens.

import { dbState, onDbState, type DbState } from './db';
import { update } from '../app/update.svelte';

export const storage = $state<{ state: DbState }>({ state: dbState() });

onDbState((s) => {
  storage.state = s;
  // A newer version owns the database now: this copy can no longer store anything.
  if (s === 'replaced') update.ready = true;
});

/** True while the database waits for other copies of RR73 or does not answer. */
export function storageWaiting(s: DbState = storage.state): boolean {
  return s === 'blocked' || s === 'stalled';
}
