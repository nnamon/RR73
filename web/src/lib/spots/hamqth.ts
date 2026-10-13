/**
 * DX cluster spots from HamQTH: the latest 200 spots, about 95 minutes of the cluster on
 * 13 October 2026. Checked against the live feeds and HamQTH's developer page
 * (https://www.hamqth.com/developers) on 13 October 2026.
 *
 * The source reads the CSV feed, https://www.hamqth.com/dxc_csv.php?limit=200, one spot per
 * line, fields separated by ^:
 *
 * | # | Field | Example |
 * | --- | --- | --- |
 * | 0 | spotter | F5NZO |
 * | 1 | frequency, kHz, one decimal | 14237.0 |
 * | 2 | spotted callsign | ZL1KS |
 * | 3 | comment | POTA NZ-0008 IOTA OC-134 |
 * | 4 | time, UTC, to the minute | 0547 2026-10-13 |
 * | 5 | L when the spotted station uses LoTW | L |
 * | 6 | E when it uses eQSL | E |
 * | 7 | its continent | OC |
 * | 8 | band | 20M |
 * | 9 | its DXCC entity | New Zealand |
 * | 10 | ADIF DXCC number | 170 |
 *
 * The developer page's header line lists the fields as Call, Frequency, Date/Time, Spotter,
 * Comment and so on; its own example and the live feed have the order above. There is no mode
 * field. The feed came with `Access-Control-Allow-Origin: *` and gzip, 4.9 kB for 200 spots.
 *
 * HamQTH calls the CSV feed legacy and its JSON API v2 current:
 * https://www.hamqth.com/api/v2/spots?limit=200 gives `{ spots: [{ spotter, dxcall, freq (kHz),
 * band, mode (CW, SSB, DIGI or null), comment, time (ISO 8601 UTC), dxcc, country, continent,
 * lotw, eqsl }] }`. It came without compression, 43 kB, so it costs 9 times the mobile data at
 * one request a minute. The source uses it only as a fallback: when the CSV feed answers with an
 * HTTP error other than 429, or when most of its lines no longer have a readable frequency and
 * time, the source asks the JSON API at once and uses it until the app starts again, and says so
 * once in the console. A network failure or a timeout does not switch.
 *
 * HamQTH asks for no request more often than every 10 s (CSV) or 15 s (JSON), and for apps using
 * its data to say so where users see it ("Data provided by HamQTH.com"); `credit` carries that.
 */

import { detectDigital } from './digital';
import { bandOfHz, parseFrequencyHz } from './frequency';
import { getJson, getText, pageFetch, REQUEST_TIMEOUT_MS, type FetchFn } from './http';
import { callsign, isSkimmer, mode, parseUtc, saysQrt, skimmerSnr, spotterCall, text } from './normalise';
import { parseRefs } from './refs';
import { SPOT_CLASSES, SpotFetchError, type Normalised, type Spot, type SpotSource } from './types';

export const HAMQTH_SPOTS_URL = 'https://www.hamqth.com/dxc_csv.php?limit=200';
export const HAMQTH_JSON_URL = 'https://www.hamqth.com/api/v2/spots?limit=200';

/** The fields both formats share, read. */
interface ClusterFields {
  spotter: unknown;
  freqKhz: unknown;
  call: unknown;
  comments: string;
  spottedAt: number | null;
  mode: string;
  country: unknown;
}

function clusterSpot(f: ClusterFields): Spot | null {
  const activator = callsign(f.call);
  if (!activator || f.spottedAt === null) return null;
  const freqHz = parseFrequencyHz(f.freqKhz, 'kHz');
  const automatic = isSkimmer(f.spotter, f.comments);
  const spotter = spotterCall(f.spotter);
  const freqId = freqHz === null ? '' : (freqHz / 1000).toFixed(1);
  return {
    id: `hamqth:${activator}@${f.spottedAt}/${spotter}/${freqId}`,
    source: 'hamqth',
    activator,
    refs: parseRefs(f.comments),
    country: text(f.country),
    freqHz,
    band: freqHz === null ? null : bandOfHz(freqHz),
    mode: f.mode,
    digital: detectDigital(f.mode, f.comments, freqHz),
    spottedAt: f.spottedAt,
    spotter,
    automatic,
    snrDb: automatic ? skimmerSnr(f.comments) : null,
    qrt: saysQrt(f.comments),
    comments: f.comments,
  };
}

/** The CSV time field, "0547 2026-10-13", as UTC ms. */
function csvTime(v: string): number | null {
  const m = /^(\d{2})(\d{2}) (\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [h, min, y, mo, d] = m.slice(1).map(Number);
  if (h > 23 || min > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d, h, min);
}

/** A CSV line split into its fields; a ^ inside the comment adds fields between the first 3 and the last 7. */
function csvFields(line: string): ClusterFields | null {
  const f = line.split('^');
  if (f.length < 11) return null;
  const tail = f.slice(f.length - 7);
  return { spotter: f[0], freqKhz: f[1], call: f[2], comments: text(f.slice(3, f.length - 7).join('^')), spottedAt: csvTime(tail[0]), mode: '', country: tail[5] };
}

/** One CSV line as a Spot, or null when it lacks fields, a callsign or a time. */
export function hamqthSpot(line: string): Spot | null {
  const f = csvFields(line);
  return f ? clusterSpot(f) : null;
}

export interface ParsedCsv extends Normalised {
  /** Lines that are not blank. */
  lines: number;
  /** Lines with all 11 fields, a readable frequency and a readable time. */
  wellFormed: number;
}

/** The CSV feed as spots. Blank lines are ignored; other lines that cannot be read are counted. */
export function parseHamqthCsv(body: string): ParsedCsv {
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  const spots: Spot[] = [];
  let wellFormed = 0;
  for (const l of lines) {
    const f = csvFields(l);
    if (f && f.spottedAt !== null && parseFrequencyHz(f.freqKhz, 'kHz') !== null) wellFormed++;
    const s = f ? clusterSpot(f) : null;
    if (s) spots.push(s);
  }
  return { spots, skipped: lines.length - spots.length, lines: lines.length, wellFormed };
}

/** True when most lines no longer have the expected layout. */
export function csvLayoutBroken(p: ParsedCsv): boolean {
  return p.lines > 0 && p.wellFormed * 2 < p.lines;
}

/** The JSON API's answer as spots, or null when it is not `{ spots: [...] }`. */
export function normaliseHamqthJson(raw: unknown): Normalised | null {
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).spots : undefined;
  if (!Array.isArray(list)) return null;
  const spots: Spot[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const s = clusterSpot({ spotter: r.spotter, freqKhz: r.freq, call: r.dxcall, comments: text(r.comment), spottedAt: parseUtc(r.time), mode: mode(r.mode), country: r.country });
    if (s) spots.push(s);
  }
  return { spots, skipped: list.length - spots.length };
}

export interface HamqthOptions {
  url?: string;
  jsonUrl?: string;
  fetch?: FetchFn;
  /** ms */
  timeoutMs?: number;
  /** Where the switch to the JSON API is reported. */
  log?: (message: string) => void;
}

/** The HamQTH source. Each instance reads the CSV feed until a fallback switches it to JSON for good. */
export function hamqthSource(opts: HamqthOptions = {}): SpotSource & { readonly format: 'csv' | 'json' } {
  const { url = HAMQTH_SPOTS_URL, jsonUrl = HAMQTH_JSON_URL, fetch = pageFetch, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  const log = opts.log ?? ((m: string) => console.warn(m));
  let format: 'csv' | 'json' = 'csv';

  async function fromJson(signal: AbortSignal): Promise<Spot[]> {
    const r = normaliseHamqthJson(await getJson(jsonUrl, signal, fetch, timeoutMs));
    if (!r) throw new SpotFetchError('format');
    return r.spots;
  }

  function fallBack(reason: string) {
    format = 'json';
    log(`RR73 spots: the HamQTH CSV feed ${reason}. Using the HamQTH JSON API until the app restarts.`);
  }

  return {
    id: 'hamqth',
    name: 'HamQTH',
    classes: SPOT_CLASSES,
    credit: 'DX cluster data provided by HamQTH.com.',
    get format() {
      return format;
    },
    async fetch(signal) {
      if (format === 'json') return fromJson(signal);
      let body: string;
      try {
        body = await getText(url, signal, fetch, timeoutMs);
      } catch (e) {
        if (!(e instanceof SpotFetchError) || e.kind !== 'http' || e.status === 429) throw e;
        fallBack(`answered with HTTP ${e.status}`);
        return fromJson(signal);
      }
      const parsed = parseHamqthCsv(body);
      if (csvLayoutBroken(parsed)) {
        fallBack(`changed layout: ${parsed.wellFormed} of ${parsed.lines} lines readable`);
        return fromJson(signal);
      }
      return parsed.spots;
    },
  };
}
