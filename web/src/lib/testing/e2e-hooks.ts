// Hooks for the Playwright tests, in builds made with VITE_E2E=1 only (the Playwright web server
// sets it; the GitHub Pages build does not). They put the app into states that need a band full
// of stations: decodes arrive as if from the decoder, and a QSO goes to the log. They also read
// the audio clock mapping, for the timing tests.

import { logQso } from '../log/log.svelte';
import type { LogQsoRecord } from '../log/types';
import type { Decode } from '../decode/types';
import { settings } from '../state/settings.svelte';
import { audioOut, deliverDecodes, noteHeardBack, onAudioChunk } from '../state/station.svelte';

export interface E2eHooks {
  /** Decodes for the slot starting at `slotStartMs`, UTC ms. */
  decoded(slotStartMs: number, decodes: Decode[]): void;
  /** Logs a QSO as the sequencer does, with the Logged notice. */
  logged(record: LogQsoRecord): Promise<void>;
  /** UTC the clock mapping gives the audio clock now, minus Date.now(), ms; null without a mapping. */
  clockErrorMs(): number | null;
  /** UTC stamped on the end of the last captured chunk, minus Date.now() when it arrived, ms. */
  rxLagMs(): number | null;
  /** Decodes of a slot RR73 transmitted `text` in at `f0Hz`, as if from the decoder. */
  heardBack(slotStartMs: number, text: string, f0Hz: number, decodes: Decode[]): void;
}

declare global {
  interface Window {
    __rr73?: E2eHooks;
  }
}

export function installE2eHooks() {
  let rxLag: number | null = null;
  onAudioChunk((c) => {
    rxLag = c.utcMs + (c.samples.length / 12000) * 1000 - Date.now();
  });
  window.__rr73 = {
    decoded: (slotStartMs, decodes) => deliverDecodes({ startUtcMs: slotStartMs, mode: settings.mode, decodes, ms: 40 }),
    logged: async (record) => {
      await logQso(record);
    },
    clockErrorMs: () => {
      const out = audioOut();
      return out ? out.mapper.toUtcMs(out.ctx.currentTime) - Date.now() : null;
    },
    rxLagMs: () => rxLag,
    heardBack: (slotStartMs, text, f0Hz, decodes) => noteHeardBack(slotStartMs, { text, f0Hz }, decodes),
  };
}
