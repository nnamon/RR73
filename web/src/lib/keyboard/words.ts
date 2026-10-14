/**
 * Words in received keyboard text (docs/design/rtty.md, "Words in received text"): callsigns,
 * reports, serial numbers, names and QTHs, and the other-case reading of a word whose FIGS or
 * LTRS was lost. Pure functions over text; the keyboard session feeds them the transcript.
 */

/** One word of a line and where it sits, by character index. */
export interface Word {
  word: string;
  start: number;
  end: number;
}

/** The words of `text`, split on spaces. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Punctuation that ends a word in running text: "BV2KQ." and "UR RST 579," read without it. */
export function bare(word: string): string {
  return word.replace(/^[.,:;?!'"()]+|[.,:;?!'"()]+$/g, '');
}

// A base callsign: a prefix with a letter in its first two characters, a digit, and a suffix
// that ends in a letter. 9V1NE, JA1XYZ, 3DA0RU and E3TQ match; 599, 5NN, 100W and KX2 do not.
const BASE = '(?=[A-Z]|[0-9][A-Z])[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}[A-Z]';
const CALL = new RegExp(`^(?:[A-Z0-9]{1,4}/)?${BASE}(?:/(?:[A-Z0-9]{1,4}|QRP))?$`);
const GRID6 = /^[A-R]{2}\d{2}[A-X]{2}$/;

/**
 * True for a word shaped like an amateur callsign, with an optional prefix or suffix (VK3/,
 * /P, /M, /QRP), that `resolves` places in a country. Without a country table the shape decides.
 */
export function isCallsign(word: string, resolves: ((call: string) => boolean) | null = null): boolean {
  const w = word.toUpperCase();
  if (!CALL.test(w) || GRID6.test(w)) return false;
  return resolves ? resolves(w) : true;
}

const REPORT = /^5[1-9][1-9]$/;
const NUMBER = /^\d{1,4}$/;
const NAME = /^[A-Z][A-Z'-]{0,15}$/;
/** Words that end a QTH or are never a name: the usual RTTY abbreviations around them. */
const STOP = new Set([
  'NAME', 'QTH', 'RIG', 'ANT', 'WX', 'PWR', 'HW', 'BTU', 'K', 'KN', 'SK', 'DE', 'ES', 'OP', 'RST', 'UR', 'IS', 'HR', 'HERE', 'TNX', 'FB', 'OM', 'AND', 'CPY', 'CQ', 'PSE', 'BK', 'TU', 'TEST', '73',
]);

/** What received text says: each field from its last mention. */
export interface Heard {
  name?: string;
  qth?: string;
  /** The report they sent: RST received. */
  rst?: string;
  /** The serial number they sent, in the Contest set. */
  nr?: string;
}

/**
 * Reads name, QTH, report and serial number from received text, one run of it at a time:
 * - report: 5 and two digits from 1 to 9, after RST or UR, or anywhere in a contest exchange;
 * - serial number (contest only): 1 to 4 digits after a report;
 * - name: the word after NAME, NAME IS, NAME HR IS or OP;
 * - QTH: up to 2 words after QTH, QTH IS or QTH HR IS, to a full stop or the end of the run.
 * A word with an uncertain character (U+FFFD) never matches.
 */
export function heard(runs: readonly string[], contest: boolean): Heard {
  const out: Heard = {};
  for (const run of runs) {
    const raw = words(run).map((w) => w.word.toUpperCase());
    const ws = raw.map(bare);
    const ends = raw.map((w) => /[.]$/.test(w));
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const prev = ws[i - 1];
      if (REPORT.test(w) && (contest || prev === 'RST' || prev === 'UR' || (prev && REPORT.test(prev)))) {
        out.rst = w;
        if (contest) {
          let j = i + 1;
          while (j < ws.length && ws[j] === w) j++;
          if (j < ws.length && NUMBER.test(ws[j])) out.nr = ws[j];
        }
      }
      if (w === 'NAME' || w === 'OP') {
        let j = i + 1;
        if (ws[j] === 'HR') j++;
        if (ws[j] === 'IS') j++;
        const n = ws[j];
        if (n && NAME.test(n) && !STOP.has(n) && !n.includes('�')) out.name = n;
      }
      if (w === 'QTH') {
        let j = i + 1;
        if (ws[j] === 'HR') j++;
        if (ws[j] === 'IS') j++;
        const parts: string[] = [];
        for (; j < ws.length && parts.length < 2; j++) {
          const p = ws[j];
          if (!p || STOP.has(p) || !/^[A-Z][A-Z'-]*$/.test(p)) break;
          if (parts[0] !== p) parts.push(p);
          if (ends[j]) break;
        }
        if (parts.length) out.qth = parts.join(' ');
      }
    }
  }
  return out;
}

/** The field a word can fill, for the field menu. */
export type FillField = 'name' | 'qth' | 'rstRcvd' | 'srx' | 'notes';

/**
 * The other-case reading of `word` (from the modem's table), or null when it reads the same or
 * reads as nothing useful: digits, or letters only.
 */
export function otherReading(word: string, read: (text: string) => string): { text: string; to: 'figures' | 'letters' } | null {
  const w = bare(word.toUpperCase());
  if (!w) return null;
  const r = read(w);
  if (r === w) return null;
  if (/^\d{1,4}$/.test(r) && /^[A-Z]+$/.test(w)) return { text: r, to: 'figures' };
  if (/^[A-Z]+$/.test(r) && /^[\d]+$/.test(w)) return { text: r, to: 'letters' };
  return null;
}

/** The field a reading fills: a report for 5 and two digits 1 to 9, else a serial number for digits, else a name. */
export function fieldOfReading(text: string): FillField {
  if (REPORT.test(text)) return 'rstRcvd';
  if (NUMBER.test(text)) return 'srx';
  return 'name';
}
