/**
 * A line of received text as the pane draws it: words and the spaces between them, each word in
 * runs of received, uncertain and sent characters. A received word with no uncertain character
 * that reads as a callsign is marked, so it can take the decode colours and a tap sets the call.
 */

import type { HighlightEntry, HighlightId } from '../decode/highlight';
import { bandModeKey, callKey, setOf, type LogIndex } from '../log/worked';
import type { CharKind, TextLine } from './transcript';
import { bare, isCallsign } from './words';

export interface Run {
  text: string;
  kind: CharKind;
}

export interface Token {
  /** Index of the token's first character in the line. */
  at: number;
  text: string;
  space: boolean;
  runs: Run[];
  /** Received: the word can be tapped. */
  rx: boolean;
  /** The callsign the word holds, without punctuation; null when it is none. */
  call: string | null;
}

function runsOf(text: string, kinds: string): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < text.length; i++) {
    const k = kinds[i] as CharKind;
    const last = out.at(-1);
    if (last && last.kind === k) last.text += text[i];
    else out.push({ text: text[i], kind: k });
  }
  return out;
}

/** Splits a line into tokens. `resolves` places a callsign in a country; null leaves it to the shape. */
export function tokens(line: TextLine, resolves: ((call: string) => boolean) | null): Token[] {
  const out: Token[] = [];
  const re = /(\s+)|(\S+)/g;
  for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
    const at = m.index;
    const text = m[0];
    const kinds = line.kinds.slice(at, at + text.length);
    const space = !!m[1];
    const certain = !space && /^r+$/.test(kinds);
    const b = bare(text);
    const call = certain && b && isCallsign(b, resolves) ? b.toUpperCase() : null;
    out.push({ at, text, space, runs: runsOf(text, kinds), rx: !space && !kinds.includes('t'), call });
  }
  return out;
}

/** The decode colours a callsign in received text takes: a background category's colour, and the worked-before text layer. */
export interface CallColour {
  /** Category colour, #RRGGBB, for the tint behind the word; null for none. */
  bg: string | null;
  /** Worked before on this band and mode: the text greys. */
  worked: boolean;
}

/**
 * The colours of a callsign: My call, New call and New call on this band, in the operator's
 * order, and Worked before as a text layer, as in FT8's list. Other categories need a message.
 */
export function callColour(call: string, myCall: string, index: LogIndex, band: string, mode: string, entries: readonly HighlightEntry[]): CallColour {
  const key = callKey(call);
  const me = callKey(myCall);
  const b = band.toLowerCase();
  const test: Partial<Record<HighlightId, () => boolean>> = {
    myCall: () => !!me && key === me,
    newCall: () => key !== me && !index.calls.has(key),
    newCallBand: () => key !== me && !setOf(index.callsByBand, b).has(key),
  };
  const bg = entries.find((e) => e.on && test[e.id]?.()) ?? null;
  const worked = entries.some((e) => e.on && e.id === 'worked') && key !== me && setOf(index.callsByBandMode, bandModeKey(b, mode)).has(key);
  return { bg: bg?.colour ?? null, worked };
}
