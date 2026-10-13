/**
 * Callsign to DXCC entity, from the country file (cty.json, built from Big CTY).
 *
 * Lookup order:
 *
 * 1. The whole callsign among the exact callsigns (`=CALL`): 3D2AG/P, 4U1UN, KH8K.
 * 2. Maritime and aeronautical mobile (/MM, /AM): no entity.
 * 3. The location from the portable rules in callsign.ts, by longest prefix: VK3/9V1NE uses VK3,
 *    K1ABC/6 uses K6ABC, 9M6/PA0RRS/2 uses 9M2.
 * 4. At home: the home call among the exact callsigns (3D2RR/P is 3D2RR, Rotuma), then by
 *    longest prefix (9V1NE/P uses 9V1NE, Singapore).
 *
 * Longest prefix: the longest alias that begins the text wins, so VP2EAB is Anguilla (VP2E), not
 * a shorter VP2 match, and 9M6AB is East Malaysia (9M6), not West Malaysia (9M).
 *
 * Duplicates: the country file says a callsign or prefix listed twice keeps its first entity, so
 * the first record in file order wins.
 *
 * Zones, continent, position and time offset come from the matched alias's overrides, else from
 * its entity. WAE entities (Sicily, Shetland, European Turkey, Vienna Intl Ctr, African Italy,
 * Bear Island) are matched like any other; the result names the WAE entity for CQ contests and
 * gives the DXCC entity it belongs to for DXCC and ADIF.
 */

import { parsePortable, withArea } from './callsign';
import { CtyFormatError, parseAlias, TOKEN_SYNTAX, type CtyAlias } from './cty';
import { readCtyJson, type Continent, type CtyEntityJson, type CtyJson } from './format';

export interface DxccMatch {
  found: true;
  /** The callsign as looked up: upper case, without spaces. */
  call: string;
  /** Country-file entity: "Sicily", "Hawaii". */
  entity: string;
  /** Its primary prefix: "IT9", "KH6", "3D2/r". */
  prefix: string;
  /** True when the entity is on the WAE list only; dxcc then names the DXCC entity it belongs to. */
  wae: boolean;
  /** ADIF DXCC entity code: 248 for Sicily (Italy), 110 for Hawaii. Null when the data has no code. */
  dxcc: number | null;
  /**
   * DXCC entity name as the country file writes it: "Italy" for Sicily, "Hawaii" for Hawaii,
   * "Asiatic Turkey" for European Turkey (the country file's name for DXCC entity 390, Turkey).
   */
  dxccEntity: string;
  cqZone: number;
  ituZone: number;
  continent: Continent;
  /** Entity or alias position, degrees, north and east positive. */
  lat: number;
  lon: number;
  /** Local time, hours east of UTC. */
  utcOffsetH: number;
  /** How the match was made: the rule, the alias that matched and the text looked up. */
  via: { rule: 'exact' | 'prefix'; alias: string; lookedUp: string };
}

export interface DxccMiss {
  found: false;
  call: string;
  /**
   * invalid: not a callsign. maritime-mobile, aeronautical-mobile: /MM and /AM count for no
   * entity. unknown: no prefix in the country file matches.
   */
  reason: 'invalid' | 'maritime-mobile' | 'aeronautical-mobile' | 'unknown';
}

export type DxccResult = DxccMatch | DxccMiss;

/**
 * One alias in the index. Its overrides are parsed on its first match: parsing all 29,000
 * aliases up front took most of the index build (about 100 ms in Node).
 */
interface Entry {
  entity: number;
  token: string;
  alias?: CtyAlias;
}

/** An entity's alias list: tokens in cty.dat syntax, one space apart. */
const ALIAS_LIST = new RegExp(`^${TOKEN_SYNTAX}(?: ${TOKEN_SYNTAX})*$`);

/** Where a token's overrides start: ( [ < { or ~. */
function overridesAt(token: string): number {
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    if (c === 40 || c === 91 || c === 60 || c === 123 || c === 126) return i;
  }
  return token.length;
}

export class DxccIndex {
  /** Release date of the country file, YYYY-MM-DD, or null. */
  readonly version: string | null;
  /** The country file's copyright and permission notice. */
  readonly notice: string;
  readonly entities: readonly CtyEntityJson[];
  private readonly exact = new Map<string, Entry>();
  private readonly prefixes = new Map<string, Entry>();
  private readonly longest: number;
  /** For WAE entities: the index of the DXCC entity with the same code. */
  private readonly parent: number[];

  private constructor(data: CtyJson) {
    this.version = data.version;
    this.notice = data.notice;
    this.entities = data.entities;
    let longest = 0;
    data.entities.forEach((e, entity) => {
      const aliases = e.aliases.trim().toUpperCase();
      if (!aliases) return;
      if (!ALIAS_LIST.test(aliases)) throw new CtyFormatError(`The aliases of ${e.name} are not in cty.dat syntax`);
      for (const token of aliases.split(' ')) {
        const exact = token.charCodeAt(0) === 61;
        const text = token.slice(exact ? 1 : 0, overridesAt(token));
        const map = exact ? this.exact : this.prefixes;
        if (!map.has(text)) map.set(text, { entity, token });
        if (!exact) longest = Math.max(longest, text.length);
      }
    });
    this.longest = longest;
    const byCode = new Map<number, number>();
    data.entities.forEach((e, i) => {
      if (!e.wae && e.dxcc !== null && !byCode.has(e.dxcc)) byCode.set(e.dxcc, i);
    });
    this.parent = data.entities.map((e, i) => (e.wae && e.dxcc !== null ? (byCode.get(e.dxcc) ?? i) : i));
  }

  /** Builds the index from cty.json content. Throws ReferenceFormatError or CtyFormatError on malformed data. */
  static fromJson(json: unknown): DxccIndex {
    return new DxccIndex(readCtyJson(json));
  }

  /** Callsign to entity, zones and position. */
  lookup(input: string): DxccResult {
    const p = parsePortable(input);
    if (!p) return { found: false, call: input.trim().toUpperCase(), reason: 'invalid' };
    const whole = this.exact.get(p.call);
    if (whole) return this.match(p.call, whole, 'exact', p.call);
    if (p.mobile) return { found: false, call: p.call, reason: p.mobile === 'maritime' ? 'maritime-mobile' : 'aeronautical-mobile' };
    if (p.location) {
      const at = p.area ? withArea(p.location, p.area) : p.location;
      const hit = this.longestPrefix(at);
      if (hit) return this.match(p.call, hit, 'prefix', at);
    }
    if (p.area) {
      const at = withArea(p.home, p.area);
      const hit = this.longestPrefix(at);
      if (hit) return this.match(p.call, hit, 'prefix', at);
    }
    const home = this.exact.get(p.home);
    if (home) return this.match(p.call, home, 'exact', p.home);
    const hit = this.longestPrefix(p.home);
    if (hit) return this.match(p.call, hit, 'prefix', p.home);
    return { found: false, call: p.call, reason: 'unknown' };
  }

  private longestPrefix(text: string): Entry | null {
    for (let n = Math.min(text.length, this.longest); n > 0; n--) {
      const e = this.prefixes.get(text.slice(0, n));
      if (e) return e;
    }
    return null;
  }

  private match(call: string, hit: Entry, rule: 'exact' | 'prefix', lookedUp: string): DxccMatch {
    const e = this.entities[hit.entity];
    const a = (hit.alias ??= parseAlias(hit.token));
    return {
      found: true,
      call,
      entity: e.name,
      prefix: e.prefix,
      wae: e.wae,
      dxcc: e.dxcc,
      dxccEntity: this.entities[this.parent[hit.entity]].name,
      cqZone: a.cq ?? e.cq,
      ituZone: a.itu ?? e.itu,
      continent: a.cont ?? e.cont,
      lat: a.lat ?? e.lat,
      lon: a.lon ?? e.lon,
      utcOffsetH: a.utc ?? e.utc,
      via: { rule, alias: a.text, lookedUp },
    };
  }
}
