/**
 * Reports to PSK Reporter through the relay (docs/design/qsp.md, PSK Reporter). Off by default,
 * kept in IndexedDB under "pskreporter". Only what the operator's radio hears is reported: the
 * practice band and a web SDR are someone else's signals or antenna. FT8 and FT4 only.
 */

import { getKv, mergeKv, peekKv } from './db';
import { practice } from './practice.svelte';
import { settings } from './settings.svelte';
import { onSlotDecoded } from './station.svelte';
import { currentDialHz, relay, relayKey, webSdrInput } from './relay.svelte';
import { isFt } from '../clock/slots';
import { isGrid } from '../qso/messages';
import { PskQueue, type SendResult } from '../pskreporter/queue';
import { spotsOf } from '../pskreporter/spots';
import { QspError, qspErrorText, qspReport } from '../relay/qsp';
import { utcNow } from '../clock/utc';

export interface PskReporterSettings {
  on: boolean;
  /** The receiving antenna, shown on PSK Reporter's map; '' for none. */
  antenna: string;
}

export const PSK_DEFAULTS: Readonly<PskReporterSettings> = { on: false, antenna: '' };

const KEY = 'pskreporter';

export const pskReporter = $state<PskReporterSettings>({ ...PSK_DEFAULTS });

/** What the reports came to since the app started. */
export const pskStatus = $state<{ spots: number; atMs: number | null; waiting: number; error: string | null }>({
  spots: 0,
  atMs: null,
  waiting: 0,
  error: null,
});

export function validatePskReporter(raw: unknown): PskReporterSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    on: typeof r.on === 'boolean' ? r.on : PSK_DEFAULTS.on,
    antenna: typeof r.antenna === 'string' ? r.antenna.slice(0, 100) : PSK_DEFAULTS.antenna,
  };
}

let changed = false;

export async function loadPskReporter(): Promise<void> {
  try {
    const peeked = await peekKv<unknown>(KEY);
    const stored = peeked ? peeked.value : await getKv<unknown>(KEY);
    if (!changed) Object.assign(pskReporter, validatePskReporter(stored));
  } catch {
    // No storage: reporting stays off.
  }
}

export async function updatePskReporter(patch: Partial<PskReporterSettings>): Promise<void> {
  changed = true;
  Object.assign(pskReporter, patch);
  if (patch.on === false) {
    queue.clear();
    pskStatus.waiting = 0;
  }
  try {
    await mergeKv(KEY, { ...patch });
  } catch {
    // As in loadPskReporter.
  }
}

/** Why decodes are not reported now; null while they are. */
export type PskHold = 'off' | 'relay' | 'station' | 'practice' | 'web-sdr' | 'mode';

export function pskHold(): PskHold | null {
  if (!pskReporter.on) return 'off';
  if (!relay.base) return 'relay';
  if (!settings.callsign || !isGrid(settings.grid)) return 'station';
  if (practice.on) return 'practice';
  if (webSdrInput() !== null) return 'web-sdr';
  if (!isFt(settings.mode)) return 'mode';
  return null;
}

const queue = new PskQueue(
  (spots) =>
    qspReport(
      relay.base,
      relayKey(),
      {
        callsign: settings.callsign.toUpperCase(),
        locator: settings.grid,
        software: `RR73 ${__APP_VERSION__}`,
        antenna: pskReporter.antenna.trim(),
      },
      spots,
    ),
  {
    sent(r: SendResult, at: number) {
      pskStatus.spots += r.taken;
      pskStatus.atMs = at;
      pskStatus.error = null;
      pskStatus.waiting = queue.waiting;
    },
    failed(e: unknown) {
      pskStatus.error = qspErrorText(e);
      // A refusal does not pass by waiting: drop the spots. An unreachable relay keeps them.
      if (e instanceof QspError && e.kind !== 'network' && e.kind !== 'timeout') queue.clear();
      pskStatus.waiting = queue.waiting;
    },
  },
);

let started = false;

/** At app start: reports each slot's decodes while reporting is on. */
export function initPskReporter() {
  if (started) return;
  started = true;
  // The final pass carries the early pass's decodes again: they are reported once, with it.
  onSlotDecoded((slotStartMs, decodes, pass) => {
    if (pass === 'early' || pskHold() !== null || !isFt(settings.mode)) return;
    queue.add(spotsOf(decodes, utcNow(), currentDialHz(), settings.mode), slotStartMs);
    pskStatus.waiting = queue.waiting;
  });
}
