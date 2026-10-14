/**
 * The beacon's messages and the reading of decoded WSPR text (crates/rr73-wspr has the codec).
 *
 * - A standard callsign sends one Type 1 message: callsign, the first 4 characters of the grid
 *   and the power, "9V1NE OJ11 37".
 * - A compound callsign (with a prefix or suffix) sends a Type 2 message, "9V1NE/P 37", and with
 *   a 6-character grid a Type 3 message after it, "<9V1NE/P> OJ11VI 37", in turn: the beacon
 *   alternates them from one transmission to the next. A Type 3 message carries 6 characters, so
 *   with a 4-character grid only the Type 2 message goes out.
 *
 * Whether a callsign fits is the codec's call (pack_wspr); these functions only build the text.
 */

const GRID = /^[A-R]{2}\d{2}([A-X]{2})?$/i;

/** "FN42ab" from "fn42AB"; null when not a 4 or 6-character grid. */
function gridOf(s: string): string | null {
  return GRID.test(s) ? s.slice(0, 4).toUpperCase() + s.slice(4).toLowerCase() : null;
}

/** The texts the beacon sends in turn, or why it cannot send. */
export type Beacon = { ok: true; texts: string[] } | { ok: false; error: string };

export function beaconMessages(call: string, grid: string, powerDbm: number): Beacon {
  const c = call.trim().toUpperCase();
  const g = grid.trim();
  if (!c && !g) return { ok: false, error: 'Callsign and grid not set' };
  if (!c) return { ok: false, error: 'Callsign not set' };
  if (!GRID.test(g)) return { ok: false, error: 'Grid not set' };
  if (!c.includes('/')) return { ok: true, texts: [`${c} ${g.slice(0, 4).toUpperCase()} ${powerDbm}`] };
  const texts = [`${c} ${powerDbm}`];
  if (g.length === 6) texts.push(`<${c}> ${g.toUpperCase()} ${powerDbm}`);
  return { ok: true, texts };
}

/** What a decoded WSPR message says. */
export interface WsprMessage {
  /** The station, without hash brackets; null for a hash RR73 has not resolved ("<...>"). */
  call: string | null;
  /** 4 or 6 characters, field and square upper case and subsquare lower case; null in Type 2. */
  grid: string | null;
  powerDbm: number | null;
  /** 1: callsign, grid and power. 2: compound callsign and power. 3: hashed callsign, 6-character grid and power. */
  msgType: 1 | 2 | 3;
}

/** Reads decoded text such as "K1ABC FN42 37", "PJ4/K1ABC 33" or "<K1ABC> FN42AB 37". */
export function readMessage(text: string): WsprMessage {
  const parts = text.trim().split(/\s+/);
  const power = Number(parts[parts.length - 1]);
  const powerDbm = parts.length >= 2 && Number.isInteger(power) ? power : null;
  if (parts[0]?.startsWith('<')) {
    const inner = parts[0].replace(/[<>]/g, '');
    return { call: inner && inner !== '...' ? inner.toUpperCase() : null, grid: parts.length === 3 ? gridOf(parts[1]) : null, powerDbm, msgType: 3 };
  }
  if (parts.length === 2) return { call: parts[0].toUpperCase(), grid: null, powerDbm, msgType: 2 };
  return { call: parts[0]?.toUpperCase() || null, grid: parts.length === 3 ? gridOf(parts[1]) : null, powerDbm, msgType: 1 };
}
