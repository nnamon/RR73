/**
 * WSPR spots to WSPRnet, straight from this phone (docs/design/qsp.md, WSPRnet). Off by default,
 * kept in IndexedDB under "wsprnet". Only what the operator's radio hears goes: the practice band
 * and a web SDR are someone else's signals or antenna. A slot the decoder skipped sends nothing.
 */

import { getKv, mergeKv, peekKv } from './db';
import { practice } from './practice.svelte';
import { settings } from './settings.svelte';
import { onWsprDecoded } from './station.svelte';
import { webSdrInput } from './relay.svelte';
import { dialNow } from './radio.svelte';
import { wspr, wsprStation } from './wspr.svelte';
import { dialHz } from '../radio/bands';
import { isGrid } from '../qso/messages';
import { records } from '../wsprnet/records';
import { WsprnetQueue } from '../wsprnet/queue';

/** WSPRnet's upload handler. HTTPS works; the answer cannot be read from a page. */
export const WSPRNET_POST = 'https://wsprnet.org/post/';
const KEY = 'wsprnet';

export const wsprnet = $state<{ on: boolean }>({ on: false });

/** What went since the app started. */
export const wsprnetStatus = $state<{ spots: number; atMs: number | null; waiting: number; error: string | null }>({ spots: 0, atMs: null, waiting: 0, error: null });

let changed = false;

export async function loadWsprnet(): Promise<void> {
  try {
    const peeked = await peekKv<unknown>(KEY);
    const stored = (peeked ? peeked.value : await getKv<unknown>(KEY)) as { on?: unknown } | undefined;
    if (!changed && typeof stored?.on === 'boolean') wsprnet.on = stored.on;
  } catch {
    // No storage: off.
  }
}

export async function setWsprnet(on: boolean): Promise<void> {
  changed = true;
  wsprnet.on = on;
  if (!on) {
    queue.clear();
    wsprnetStatus.waiting = 0;
  }
  try {
    await mergeKv(KEY, { on });
  } catch {
    // As in loadWsprnet.
  }
}

/** Why spots do not go now; null while they do. */
export type WsprnetHold = 'off' | 'station' | 'practice' | 'web-sdr' | 'mode';

export function wsprnetHold(): WsprnetHold | null {
  if (!wsprnet.on) return 'off';
  const s = wsprStation();
  if (!s.call || !isGrid(s.grid)) return 'station';
  if (practice.on) return 'practice';
  if (webSdrInput() !== null) return 'web-sdr';
  if (settings.mode !== 'WSPR') return 'mode';
  return null;
}

/** One record to WSPRnet; rejects when the request did not go out. */
async function post(body: string): Promise<void> {
  await fetch(WSPRNET_POST, {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

const queue = new WsprnetQueue(post, {
  sent(body, atMs) {
    if (body.startsWith('function=wspr&')) wsprnetStatus.spots++;
    wsprnetStatus.atMs = atMs;
    wsprnetStatus.error = null;
    wsprnetStatus.waiting = queue.waiting;
  },
  failed(_body, _e, final) {
    wsprnetStatus.error = final ? 'WSPRnet unreachable for 1 h, spots dropped' : 'WSPRnet unreachable, trying again';
    wsprnetStatus.waiting = queue.waiting;
  },
});

let started = false;

/** At app start: uploads each WSPR slot while uploads are on. */
export function initWsprnet() {
  if (started) return;
  started = true;
  onWsprDecoded((r) => {
    if (wsprnetHold() !== null || r.skipped) return;
    const s = wsprStation();
    const dial = dialNow(dialHz(settings.band, 'WSPR'));
    if (dial === null) return;
    const tx = { pct: wspr.beacon.on ? settings.wspr.txPct : 0, frequencyHz: dial + settings.wspr.txHz, dbm: settings.wspr.powerDbm };
    queue.addSlot(records({ callsign: s.call, grid: s.grid, version: `RR73 ${__APP_VERSION__}` }, r.startUtcMs, dial, r.decodes, tx));
    wsprnetStatus.waiting = queue.waiting;
  });
}
