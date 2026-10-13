// Field readers shared by the spot sources: times, callsigns, modes, skimmer reports.

/** Trimmed text with runs of white space collapsed, or '' for anything that is not a string. */
export function text(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * A spot time, UTC ms, or null. Spot APIs write UTC without a zone ("2026-10-13T05:21:25"), so
 * a time without one is read as UTC; "Z" and offsets are honoured. Numbers are epoch seconds or
 * milliseconds.
 */
export function parseUtc(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v < 1e11 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(v.trim());
  if (!m) return null;
  const zone = m[3] ? m[3].toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z';
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A callsign in upper case, or '' when the text cannot be one: callsigns hold letters, digits
 * and slashes, with at least one letter and one digit.
 */
export function callsign(v: unknown): string {
  const c = text(v).toUpperCase();
  return /^[A-Z0-9/]{3,20}$/.test(c) && /[A-Z]/.test(c) && /\d/.test(c) ? c : '';
}

/** A callsign without a portable suffix, for matching one station across spots: W7QRP/P and W7QRP/7 give W7QRP. */
export function baseCall(call: string): string {
  return call.replace(/\/(?:P|M|MM|AM|QRP|\d)$/, '');
}

/** A skimmer's spotter name without its -# suffix: "JI1HFJ-#" gives "JI1HFJ". */
export function spotterCall(v: unknown): string {
  return text(v).toUpperCase().replace(/-#$/, '');
}

/** True for a skimmer spot: a -# spotter, or comments that open with RBN. */
export function isSkimmer(spotter: unknown, comments: string): boolean {
  return /-#$/.test(text(spotter)) || /^\[?RBN/i.test(comments);
}

/** The mode as spotted, upper case. */
export function mode(v: unknown): string {
  return text(v).toUpperCase();
}

/** The SNR in a skimmer's comments ("RBN -15 dB via JI1HFJ-#"), dB, or null. */
export function skimmerSnr(comments: string): number | null {
  const m = /(?:^|\s)([+\-−]?\d{1,2})\s?dB\b/i.exec(comments);
  if (!m) return null;
  return Number(m[1].replace('−', '-'));
}

/** True when the comments say the activator has stopped: "QRT", "QRT TNX", "qrt, next JP-1498". */
export function saysQrt(comments: string): boolean {
  return /\bQRT\b/i.test(comments);
}
