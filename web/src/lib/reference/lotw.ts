/**
 * LoTW users and the date of their last upload, from ARRL's user activity list
 * (https://lotw.arrl.org/lotw-user-activity.csv, updated about once a week).
 *
 * The list names each callsign that holds a LoTW certificate, portable forms included (9V1NE and
 * 9V1NE/P are separate entries). A lookup tries the callsign as given, then its home call.
 */

import { parsePortable } from './callsign';
import { readLotwJson } from './format';

export interface LotwUser {
  /** The callsign found in the list: the one asked for, or its home call. */
  call: string;
  /** Date of the last upload to LoTW, YYYY-MM-DD, UTC. */
  lastUpload: string;
  /** exact: the callsign as asked. home: its home call (9V1NE for VK3/9V1NE/P). */
  via: 'exact' | 'home';
}

const DAY_MS = 86_400_000;

export class LotwIndex {
  /** Newest upload date in the list, YYYY-MM-DD: how current the list is. */
  readonly latest: string;
  readonly count: number;
  private readonly dates: string[];
  private readonly byCall: Map<string, number>;

  private constructor(latest: string, dates: string[], byCall: Map<string, number>) {
    this.latest = latest;
    this.dates = dates;
    this.byCall = byCall;
    this.count = byCall.size;
  }

  /** Builds the index from lotw.json content. Throws ReferenceFormatError on malformed data. */
  static fromJson(json: unknown): LotwIndex {
    const data = readLotwJson(json);
    const dates = Object.keys(data.byDate).sort();
    const byCall = new Map<string, number>();
    dates.forEach((d, i) => {
      for (const call of data.byDate[d].split(' ')) if (call) byCall.set(call, i);
    });
    return new LotwIndex(data.latest, dates, byCall);
  }

  /** The LoTW entry for a callsign, or null when neither it nor its home call uploads to LoTW. */
  lookup(input: string): LotwUser | null {
    const p = parsePortable(input);
    if (!p) return null;
    const exact = this.byCall.get(p.call);
    if (exact !== undefined) return { call: p.call, lastUpload: this.dates[exact], via: 'exact' };
    const home = this.byCall.get(p.home);
    if (home !== undefined) return { call: p.home, lastUpload: this.dates[home], via: 'home' };
    return null;
  }
}

/** Whole days from a YYYY-MM-DD date to now, UTC: 0 on the same day. */
export function daysSince(date: string, now: Date = new Date()): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t) / DAY_MS);
}
