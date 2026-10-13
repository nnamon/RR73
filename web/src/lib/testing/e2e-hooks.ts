// Hooks for the Playwright screen review, in builds made with VITE_E2E=1 only (the Playwright
// web server sets it; the GitHub Pages build does not). They put the app into states that need a
// band full of stations: decodes arrive as if from the decoder, and a QSO goes to the log.

import { logQso } from '../log/log.svelte';
import type { LogQsoRecord } from '../log/types';
import type { Decode } from '../decode/types';
import { settings } from '../state/settings.svelte';
import { deliverDecodes } from '../state/station.svelte';

export interface E2eHooks {
  /** Decodes for the slot starting at `slotStartMs`, UTC ms. */
  decoded(slotStartMs: number, decodes: Decode[]): void;
  /** Logs a QSO as the sequencer does, with the Logged notice. */
  logged(record: LogQsoRecord): Promise<void>;
}

declare global {
  interface Window {
    __rr73?: E2eHooks;
  }
}

export function installE2eHooks() {
  window.__rr73 = {
    decoded: (slotStartMs, decodes) => deliverDecodes({ startUtcMs: slotStartMs, mode: settings.mode, decodes, ms: 40 }),
    logged: async (record) => {
      await logQso(record);
    },
  };
}
