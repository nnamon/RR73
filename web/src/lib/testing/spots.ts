// Spots for tests: a builder, and the responses recorded on 13 October 2026 (fixtures/spots).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Spot } from '../spots/types';

/** 05:57:00 UTC on 13 October 2026, a minute after the last recording. */
export const NOW = Date.UTC(2026, 9, 13, 5, 57, 0);

/** POTA API responses, trimmed. */
export const POTA_0532 = 'pota-activator-2026-10-13T0532Z.json';
export const POTA_0536 = 'pota-activator-2026-10-13T0536Z.json';
/** HamQTH DX cluster lines, trimmed. */
export const HAMQTH_0554 = 'hamqth-dxc-2026-10-13T0554Z.csv';
/** HamQTH's JSON API answer at the same minute, trimmed. */
export const HAMQTH_V2_0554 = 'hamqth-v2-spots-2026-10-13T0554Z.json';
/** Both feeds fetched within a second of each other, trimmed to stations in both and a few others. */
export const PAIR_POTA_0556 = 'pair-pota-2026-10-13T0556Z.json';
export const PAIR_HAMQTH_0556 = 'pair-hamqth-dxc-2026-10-13T0556Z.csv';

// A path, not new URL(…, import.meta.url): Vite turns that form into an asset import in jsdom tests.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/spots');

/** A recorded response as text. */
export function recordedText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** A recorded JSON response, parsed. */
export function recorded(name: string): unknown {
  return JSON.parse(recordedText(name)) as unknown;
}

let n = 0;

/** A POTA FT8 spot on 20m, two minutes before NOW, with `over` applied. */
export function spot(over: Partial<Spot> = {}): Spot {
  n++;
  return {
    id: `pota:${n}`,
    source: 'pota',
    activator: 'VK3QRP',
    refs: [{ programme: 'POTA', ref: 'VK-0921', name: 'Example park' }],
    country: '',
    freqHz: 14_074_000,
    band: '20m',
    mode: 'FT8',
    digital: 'FT8',
    spottedAt: NOW - 120_000,
    spotter: 'VK2ESN',
    automatic: false,
    snrDb: null,
    qrt: false,
    comments: '',
    ...over,
  };
}

/** A DX cluster spot without references, as `spot`. */
export function dxSpot(over: Partial<Spot> = {}): Spot {
  return spot({ id: `hamqth:${++n}`, source: 'hamqth', refs: [], country: 'New Zealand', mode: '', ...over });
}
