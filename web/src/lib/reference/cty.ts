/**
 * The country file, cty.dat, as published by Jim Reisert AD1C at https://www.country-files.com
 * (format: https://www.country-files.com/cty-dat-format/). RR73 uses Big CTY, the edition for
 * everyday logging, which lists exception callsigns back to 2000.
 *
 * Each record is a header of 8 fields ending in ":" and an alias list ending in ";":
 *
 *     Hawaii:  31:  61:  OC:   21.12:   157.48:    10.0:  KH6:
 *         AH6,AH7,KH6,KH7,NH6,NH7,WH6,WH7,=AA2TT,...;
 *
 * Header fields: name, CQ zone, ITU zone, continent, latitude (north positive), longitude (WEST
 * positive), local time offset (hours WEST of UTC) and primary prefix. A leading `*` on the
 * primary prefix marks an entity on the DARC WAEDC list only. This module converts positions and
 * offsets to the usual signs: east positive, hours east of UTC.
 *
 * Alias tokens: `=CALL` is an exact callsign; anything else is a prefix. Suffixes override the
 * entity's values for that alias: `(cq)` CQ zone, `[itu]` ITU zone, `<lat/lon>` position (cty.dat
 * signs), `{AA}` continent, `~hours~` time offset (cty.dat sign).
 *
 * This module has no runtime imports: the build script loads it directly in Node.
 */

import type { Continent, CtyEntityJson, CtyJson } from './format';

export class CtyFormatError extends Error {
  override name = 'CtyFormatError';
}

/** One alias of an entity with its overrides, in the usual signs (east positive, hours east of UTC). */
export interface CtyAlias {
  /** Prefix or callsign, upper case: "KH6", "AA2TT", "9M6/LA6VM". */
  text: string;
  /** True for `=CALL`: matches only the whole callsign. */
  exact: boolean;
  cq?: number;
  itu?: number;
  lat?: number;
  lon?: number;
  cont?: Continent;
  utc?: number;
}

/** One record of cty.dat, in the usual signs. */
export interface CtyEntity {
  name: string;
  /** Primary prefix without the WAE star. */
  prefix: string;
  wae: boolean;
  cq: number;
  itu: number;
  cont: Continent;
  lat: number;
  lon: number;
  /** Local time, hours east of UTC. */
  utc: number;
  /** Alias tokens exactly as written in the file, in file order. */
  tokens: string[];
}

const CONTINENT = /^(AF|AN|AS|EU|NA|OC|SA)$/;
const TOKEN = /^(=?)([A-Z0-9/]+)((?:\(\d+\)|\[\d+\]|<-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?>|\{[A-Z]{2}\}|~-?\d+(?:\.\d+)?~)*)$/;
/** TOKEN without anchors or groups, for checking a whole alias list in one pass. */
export const TOKEN_SYNTAX = String.raw`=?[A-Z0-9/]+(?:\(\d+\)|\[\d+\]|<-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?>|\{[A-Z]{2}\}|~-?\d+(?:\.\d+)?~)*`;
const OVERRIDE = /\((\d+)\)|\[(\d+)\]|<(-?[\d.]+)\/(-?[\d.]+)>|\{([A-Z]{2})\}|~(-?[\d.]+)~/g;

/** Negates without producing -0, which JSON and equality checks treat as a different value. */
const neg = (v: number): number => (v === 0 ? 0 : -v);

/** Parses one alias token. Throws CtyFormatError on anything outside the cty.dat grammar. */
export function parseAlias(token: string): CtyAlias {
  const m = TOKEN.exec(token.trim().toUpperCase());
  if (!m) throw new CtyFormatError(`Alias "${token}" is not in cty.dat syntax`);
  const alias: CtyAlias = { text: m[2], exact: m[1] === '=' };
  for (const o of m[3].matchAll(OVERRIDE)) {
    if (o[1] !== undefined) alias.cq = Number(o[1]);
    else if (o[2] !== undefined) alias.itu = Number(o[2]);
    else if (o[3] !== undefined) {
      alias.lat = Number(o[3]);
      alias.lon = neg(Number(o[4]));
    } else if (o[5] !== undefined) {
      if (!CONTINENT.test(o[5])) throw new CtyFormatError(`Alias "${token}" names an unknown continent`);
      alias.cont = o[5] as Continent;
    } else if (o[6] !== undefined) alias.utc = neg(Number(o[6]));
  }
  return alias;
}

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Parses cty.dat text into its records, in file order. Throws CtyFormatError with a line number on malformed input. */
export function parseCtyDat(text: string): CtyEntity[] {
  const entities: CtyEntity[] = [];
  let offset = 0;
  for (const record of text.split(';')) {
    const start = offset;
    offset += record.length + 1;
    if (!record.trim()) continue;
    const where = () => `line ${lineAt(text, start + (record.length - record.trimStart().length))}`;
    const parts = record.split(':');
    if (parts.length < 9) throw new CtyFormatError(`Record at ${where()} has fewer than 8 header fields`);
    const [name, cq, itu, cont, lat, lon, utc, primary] = parts.slice(0, 8).map((s) => s.trim());
    const numbers = [cq, itu, lat, lon, utc].map(Number);
    if (!name || numbers.some((v, i) => !Number.isFinite(v) || [cq, itu, lat, lon, utc][i] === '')) {
      throw new CtyFormatError(`Record at ${where()} has a malformed header`);
    }
    if (!CONTINENT.test(cont)) throw new CtyFormatError(`Record at ${where()} names an unknown continent "${cont}"`);
    const tokens = parts
      .slice(8)
      .join(':')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const t of tokens) {
      try {
        parseAlias(t);
      } catch (e) {
        throw new CtyFormatError(`Record at ${where()}: ${(e as Error).message}`);
      }
    }
    const wae = primary.startsWith('*');
    entities.push({
      name,
      prefix: wae ? primary.slice(1) : primary,
      wae,
      cq: numbers[0],
      itu: numbers[1],
      cont: cont as Continent,
      lat: numbers[2],
      lon: neg(numbers[3]),
      utc: neg(numbers[4]),
      tokens,
    });
  }
  if (!entities.length) throw new CtyFormatError('The country file has no records');
  return entities;
}

/**
 * Reads ADIF DXCC codes from cty.csv, which the Big CTY package ships beside cty.dat: one line
 * per record, "primary prefix,name,DXCC code,...". Keys are primary prefixes without the WAE star.
 */
export function parseCtyCsvCodes(text: string): Map<string, number> {
  const codes = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [prefix, , code] = line.split(',');
    const n = Number(code);
    if (!prefix || !Number.isInteger(n)) throw new CtyFormatError(`cty.csv line "${line.slice(0, 40)}" has no DXCC code`);
    codes.set(prefix.replace(/^\*/, ''), n);
  }
  return codes;
}

/** Builds cty.json from parsed records and the DXCC codes from cty.csv (empty when cty.csv is missing). */
export function toCtyJson(entities: readonly CtyEntity[], codes: ReadonlyMap<string, number>, meta: { version: string | null; source: string; notice: string }): CtyJson {
  const rows: CtyEntityJson[] = entities.map((e) => ({
    name: e.name,
    prefix: e.prefix,
    wae: e.wae,
    dxcc: codes.get(e.prefix) ?? null,
    cq: e.cq,
    itu: e.itu,
    cont: e.cont,
    lat: e.lat,
    lon: e.lon,
    utc: e.utc,
    aliases: e.tokens.join(' '),
  }));
  return { format: 1, version: meta.version, source: meta.source, notice: meta.notice, entities: rows };
}
