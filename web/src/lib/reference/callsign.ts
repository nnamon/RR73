/**
 * Callsign forms for country and LoTW lookups: which part of a portable callsign says where the
 * station is.
 *
 * Rules, applied to the parts between slashes:
 *
 * 1. The home call is the part with the most letters after its last digit (9V1NE, K1ABC, 3D2AG),
 *    then the longest. Prefixes such as VP2E and VK9X end in a single letter, so VP2E/W1AW is
 *    W1AW operating from VP2E.
 * 2. A part before the home call is a location prefix: VK3/9V1NE operates from VK3, F/G3ABC
 *    from F. This is the form ITU and CEPT licences prescribe.
 * 3. A part after the home call is:
 *    - MM or AM: maritime or aeronautical mobile. The station is in no DXCC entity.
 *    - one digit: a call area inside the home country. K1ABC/6 operates from K6, EA8LU/7 from EA7.
 *    - a designator that does not move the station, ignored: one letter (P, M, A, R; Argentine
 *      province letters such as /D), LH, AE, AG, and any part of 3 or more letters (QRP, QRPP,
 *      YOTA, NHS).
 *    - anything else (KH6, VE3, OE): a location prefix. 9V1NE/VK3 operates from VK3.
 * 4. With location prefixes on both sides, the one before the home call wins.
 * 5. A call-area digit with a location prefix changes the prefix's digit: 9M6/PA0RRS/2 operates
 *    from 9M2.
 *
 * The country file's exact callsigns come first: a callsign listed whole, such as 3D2AG/P or
 * LW7DQQ/Y, keeps its listed entity whatever these rules say.
 */

/** Designators after the home call that do not change where the station is. */
const DESIGNATORS = new Set(['LH', 'AE', 'AG']);

export interface PortableCall {
  /** The callsign upper case, without spaces or angle brackets: "VK3/9V1NE/P". */
  call: string;
  /** The home callsign: "9V1NE". */
  home: string;
  /** The location prefix when the station operates away from home: "VK3"; null at home. */
  location: string | null;
  /** Call-area digit after the home call: "6" in K1ABC/6. */
  area: string | null;
  /** Maritime or aeronautical mobile (/MM, /AM): no DXCC entity. */
  mobile: 'maritime' | 'aeronautical' | null;
  /** Parts ignored as designators: ["P"]. */
  ignored: string[];
}

/**
 * Upper case, without spaces or the angle brackets FT8 puts around hashed callsigns. Returns ""
 * when anything other than letters, digits and slashes remains.
 */
export function normaliseCallsign(s: string): string {
  const t = s.replace(/[\s<>]/g, '').toUpperCase().replace(/^\/+|\/+$/g, '');
  return /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(t) ? t : '';
}

/** Letters after the last digit when the part ends that way (2 for 9V1NE, 1 for VP2E), else 0. */
function suffixLetters(p: string): number {
  const m = /\d([A-Z]+)$/.exec(p);
  return m && p.length >= 3 ? m[1].length : 0;
}

/**
 * The home call among the parts: most letters after the last digit, then the longest, then the
 * first. VP2E/W1AW gives W1AW: a prefix such as VP2E or VK9X ends in one letter.
 */
function pickHome(parts: readonly string[]): string {
  const score = (p: string) => suffixLetters(p) * 100 + p.length;
  return parts.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** Splits a callsign into its home call, location prefix and designators. Null for text that is not a callsign. */
export function parsePortable(input: string): PortableCall | null {
  const call = normaliseCallsign(input);
  if (!call) return null;
  const parts = call.split('/');
  const home = pickHome(parts);
  const at = parts.indexOf(home);
  const result: PortableCall = { call, home, location: null, area: null, mobile: null, ignored: [] };
  let before: string | null = null;
  let after: string | null = null;
  parts.forEach((p, i) => {
    if (i === at) return;
    if (i < at) {
      if (/^\d$/.test(p)) result.area ??= p;
      else before ??= p;
      return;
    }
    if (p === 'MM') result.mobile ??= 'maritime';
    else if (p === 'AM') result.mobile ??= 'aeronautical';
    else if (/^\d$/.test(p)) result.area ??= p;
    else if (p.length === 1 || DESIGNATORS.has(p) || /^[A-Z]{3,}$/.test(p)) result.ignored.push(p);
    else after ??= p;
  });
  result.location = before ?? after;
  return result;
}

/**
 * Puts a call-area digit into a callsign or prefix: ("K1ABC", "6") gives "K6ABC", ("9M6", "2")
 * gives "9M2". Text without a digit is returned unchanged.
 */
export function withArea(s: string, digit: string): string {
  if (/\d$/.test(s)) return s.slice(0, -1) + digit;
  const m = /^(.*)\d([A-Z]+)$/.exec(s);
  return m ? m[1] + digit + m[2] : s;
}
