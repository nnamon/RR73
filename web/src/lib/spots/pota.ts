/**
 * POTA activator spots from https://api.pota.app/spot/activator.
 *
 * Checked against the live API on 13 October 2026: a JSON array with the latest spot of each
 * activator, served through CloudFront with `Access-Control-Allow-Origin: *`. Each record has
 * spotId, activator, frequency (kHz, as text: "14074", "7010.5", "430510"), mode (may be empty),
 * reference, name (the park; parkName was null in every record), spotTime (UTC without a zone),
 * spotter (skimmers end in -#), comments, source (Web, RBN, GT), invalid, locationDesc, grid4,
 * grid6, latitude, longitude, count and expire (s). No published terms of use were found on
 * docs.pota.app.
 */

import { detectDigital } from './digital';
import { bandOfHz, parseFrequencyHz } from './frequency';
import { getJson, pageFetch, REQUEST_TIMEOUT_MS, type FetchFn } from './http';
import { callsign, isSkimmer, mode, parseUtc, saysQrt, skimmerSnr, spotterCall, text } from './normalise';
import { SpotFetchError, type Normalised, type Spot, type SpotSource } from './types';

export const POTA_SPOTS_URL = 'https://api.pota.app/spot/activator';

/** One POTA record as a Spot, or null when it has no activator or time, or is marked invalid. */
export function potaSpot(raw: unknown): Spot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.invalid === true || r.invalid === 1 || r.invalid === 'true') return null;
  const activator = callsign(r.activator);
  const spottedAt = parseUtc(r.spotTime);
  if (!activator || spottedAt === null) return null;
  const comments = text(r.comments);
  const spotMode = mode(r.mode);
  const freqHz = parseFrequencyHz(r.frequency, 'kHz');
  const automatic = text(r.source).toUpperCase() === 'RBN' || isSkimmer(r.spotter, comments);
  const reference = text(r.reference).toUpperCase();
  const id = typeof r.spotId === 'number' || typeof r.spotId === 'string' ? String(r.spotId) : `${activator}@${spottedAt}`;
  return {
    id: `pota:${id}`,
    source: 'pota',
    activator,
    refs: reference ? [{ programme: 'POTA', ref: reference, name: text(r.name) || text(r.parkName) }] : [],
    country: '',
    freqHz,
    band: freqHz === null ? null : bandOfHz(freqHz),
    mode: spotMode,
    digital: detectDigital(spotMode, comments, freqHz),
    spottedAt,
    spotter: spotterCall(r.spotter),
    automatic,
    snrDb: automatic ? skimmerSnr(comments) : null,
    qrt: saysQrt(comments),
    comments,
  };
}

/** A POTA response as spots, or null when it is not a list. */
export function normalisePota(raw: unknown): Normalised | null {
  if (!Array.isArray(raw)) return null;
  const spots: Spot[] = [];
  for (const r of raw) {
    const s = potaSpot(r);
    if (s) spots.push(s);
  }
  return { spots, skipped: raw.length - spots.length };
}

export interface SourceOptions {
  url?: string;
  fetch?: FetchFn;
  /** ms */
  timeoutMs?: number;
}

export function potaSource(opts: SourceOptions = {}): SpotSource {
  const { url = POTA_SPOTS_URL, fetch = pageFetch, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  return {
    id: 'pota',
    name: 'POTA',
    classes: ['POTA'],
    credit: null,
    async fetch(signal) {
      const result = normalisePota(await getJson(url, signal, fetch, timeoutMs));
      if (!result) throw new SpotFetchError('format');
      return result.spots;
    },
  };
}
