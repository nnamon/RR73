/**
 * Spots in the app. The Optional features switches turn the feed's sources on and off, and the
 * practice band pauses them; the feed polls only while Spots is shown (lib/spots/feed.svelte.ts).
 *
 * Go on a spot chases its station. It sets the spot's band and mode and opens Operate with the
 * band sheet, where the operator reads the frequency to set the radio to; with a radio connected
 * (lib/state/cat.svelte.ts), RR73 sets it. The station's rows in
 * the decode list show its reference. A QSO the sequencer logs with the station on that band
 * takes the spot's references, for park to park and summit to summit, and ends the chase.
 * Another Go replaces the chase, and it lapses 60 min after Go.
 */

import { untrack } from 'svelte';
import { go } from '../app/router.svelte';
import { sheets } from '../app/sheets.svelte';
import type { LogQsoRecord, Reference } from '../log/types';
import { sameCall } from '../qso/messages';
import { BAND_IDS, dialHz, type BandId } from '../radio/bands';
import { spotFeed } from '../spots/feed.svelte';
import { defaultFilter, type SpotFilter } from '../spots/filter';
import type { Spot } from '../spots/types';
import { features } from './features.svelte';
import { practice } from './practice.svelte';
import { settings, updateSettings } from './settings.svelte';
import { tuneRadioToBand } from './cat.svelte';
import { utcNow } from '../clock/utc';

/** The station Go chases. */
export interface Chase {
  /** As spotted: W7QRP/P. */
  call: string;
  band: BandId;
  refs: Reference[];
  /** When Go was tapped, UTC ms. */
  atMs: number;
}

/** How long a chase lasts after Go, ms. */
export const CHASE_MS = 60 * 60_000;

/** The chase, and the Spots screen's chips and open row, kept between visits. */
export const spots = $state<{ chase: Chase | null; filter: SpotFilter; selected: string | null }>({ chase: null, filter: defaultFilter(), selected: null });

/**
 * Turns the feed's sources on and off with the switches. The practice band pauses them, since
 * its network guard refuses their requests. Returns the function that stops it.
 */
export function linkSpotFeed(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const live = !practice.on;
      const on = { pota: live && features.potaSpots, hamqth: live && features.clusterSpots };
      untrack(() => spotFeed.setEnabled(on));
    });
  });
}

/** The band and mode Go takes for a spot: FT8, FT4 or LQ8 on a band RR73 has a dial for, else null. */
export function goTarget(s: Spot): { band: BandId; mode: 'FT8' | 'FT4' | 'LQ8' } | null {
  if (!s.digital || !s.band) return null;
  const band = BAND_IDS.find((b) => b === s.band);
  if (!band || dialHz(band, s.digital) === null) return null;
  return { band, mode: s.digital };
}

/** Go: chases the spot's station and opens Operate with the band sheet. False when RR73 cannot work the spot. */
export function goToSpot(s: Spot, nowMs = utcNow()): boolean {
  const t = goTarget(s);
  if (!t) return false;
  spots.chase = { call: s.activator, band: t.band, refs: s.refs.map(({ programme, ref }) => ({ programme, ref })), atMs: nowMs };
  if (settings.band !== t.band || settings.mode !== t.mode) void updateSettings({ band: t.band, mode: t.mode });
  // With a radio connected, it goes to the spot's band too.
  void tuneRadioToBand();
  go('operate');
  sheets.band = true;
  return true;
}

/** What a row from the chased station shows where a CQ row has its country. */
export interface ChaseMark {
  call: string;
  /** The first reference, or Spotted for a DX spot: "K-0817". */
  text: string;
  /** "spotted, POTA K-0817". */
  spoken: string;
}

/** The mark for the chase at `nowMs`; null without one, or once it has lapsed. */
export function chaseMark(c: Chase | null, nowMs: number): ChaseMark | null {
  if (!c || nowMs - c.atMs > CHASE_MS) return null;
  const r = c.refs[0];
  return { call: c.call, text: r ? r.ref : 'Spotted', spoken: r ? `spotted, ${r.programme} ${r.ref}` : 'spotted' };
}

/**
 * A record the sequencer logs, with the chased station's references when it is that station on
 * that band, ending within the chase; that QSO ends the chase. References already on the record
 * stay.
 */
export function withChaseRefs(r: LogQsoRecord): LogQsoRecord {
  const c = spots.chase;
  if (!c || r.endUtcMs - c.atMs > CHASE_MS || r.band !== c.band || !sameCall(c.call, r.call)) return r;
  spots.chase = null;
  return r.theirRefs?.length || !c.refs.length ? r : { ...r, theirRefs: c.refs };
}
