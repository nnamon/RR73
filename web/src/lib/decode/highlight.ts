/**
 * Decode colours as in WSJT-X (Settings › Decode colours). Background categories come in
 * priority order: the first enabled one that matches a decode tints its row. Text categories are
 * layers over that: worked before greys the text of any decode whose sender is in the log on this
 * band and mode, whatever its background. Sources for the defaults are in
 * docs/design/decode-colours.md.
 *
 * New call, new grid and ending a QSO look at the station sending a CQ, 73 or RR73, as WSJT-X
 * does. No category looks at the operator's own callsign as a sender. Calls compare by base
 * callsign. Own transmissions match only Sent, and received decodes never match it.
 */

import { parseExchange } from '../qso/messages';
import { baseCall, looksLikeCall } from './marking';
import { bandModeKey, callKey, gridKey, setOf, type LogIndex } from '../log/worked';

export type HighlightId = 'myCall' | 'sent' | 'newGrid' | 'newGridBand' | 'newCall' | 'newCallBand' | 'ending' | 'cq' | 'worked';

/** How a category shows its colour: a tint behind the row, in priority order, or a text colour layered over it. */
export type HighlightStyle = 'background' | 'text';

export interface HighlightCategory {
  id: HighlightId;
  /**
   * Position in WSJT-X's default order. The gaps are the categories that need reference data:
   * new continent (2, 3), CQ zone (4, 5), ITU zone (6, 7) and DXCC (8, 9), each overall and on
   * the band, and LoTW user (14). When they ship, settings insert them by rank. Ending a QSO
   * (14.5) and worked before are RR73's own; worked before is a text layer outside the order.
   */
  rank: number;
  label: string;
  sub?: string;
  style: HighlightStyle;
  /** Default colour, #RRGGBB. */
  colour: string;
  /** Read out with the row by screen readers. */
  spoken: string;
}

/**
 * The colour of a category "on this band": its colour mixed 40:60 with white, the rule behind
 * WSJT-X's own pairs (#FF8000 and #FFCC99, #00FFFF and #99FFFF).
 */
export function bandColour(colour: string): string {
  const c = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(0.4 * v + 0.6 * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * RR73's colours (docs/design/decode-colours.md, RR73's scheme): the Okabe–Ito palette, assigned
 * so the closest pair of row tints, and each tint and a plain row, stay furthest apart for
 * protanopia, deuteranopia and tritanopia, in light and dark.
 */
const RR73: Record<HighlightId, string> = {
  myCall: '#D55E00',
  newGrid: '#E69F00',
  newGridBand: bandColour('#E69F00'),
  newCall: '#0072B2',
  newCallBand: bandColour('#0072B2'),
  ending: '#CC79A7',
  cq: '#009E73',
  sent: '#56B4E9',
  worked: '#8C93A0',
};

export const CATEGORIES: readonly HighlightCategory[] = [
  { id: 'myCall', rank: 1, label: 'My call in the message', sub: 'Including portable forms', style: 'background', colour: RR73.myCall, spoken: 'my call' },
  { id: 'newGrid', rank: 10, label: 'New grid', style: 'background', colour: RR73.newGrid, spoken: 'new grid' },
  { id: 'newGridBand', rank: 11, label: 'New grid on this band', style: 'background', colour: RR73.newGridBand, spoken: 'new grid on this band' },
  { id: 'newCall', rank: 12, label: 'New call', style: 'background', colour: RR73.newCall, spoken: 'new call' },
  { id: 'newCallBand', rank: 13, label: 'New call on this band', style: 'background', colour: RR73.newCallBand, spoken: 'new call on this band' },
  { id: 'ending', rank: 14.5, label: 'Ending a QSO', sub: 'RR73 or 73 to another station', style: 'background', colour: RR73.ending, spoken: 'ending a QSO' },
  { id: 'cq', rank: 15, label: 'CQ in the message', style: 'background', colour: RR73.cq, spoken: 'CQ' },
  { id: 'sent', rank: 16, label: 'Sent', style: 'background', colour: RR73.sent, spoken: 'sent' },
  { id: 'worked', rank: 17, label: 'Worked before', sub: 'On this band and mode', style: 'text', colour: RR73.worked, spoken: 'worked before' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: HighlightId): HighlightCategory {
  return BY_ID.get(id)!;
}

export function isHighlightId(v: unknown): v is HighlightId {
  return typeof v === 'string' && BY_ID.has(v as HighlightId);
}

/** One category in the operator's order: on or off, and its colour. */
export interface HighlightEntry {
  id: HighlightId;
  on: boolean;
  /** #RRGGBB, upper case. */
  colour: string;
}

/** The swatches in the colour sheet: RR73's colours, then WSJT-X's. Every default colour is one of them. */
export const PALETTE: readonly { name: string; colour: string }[] = [
  { name: 'Vermillion', colour: '#D55E00' },
  { name: 'Orange', colour: '#E69F00' },
  { name: 'Light orange', colour: RR73.newGridBand },
  { name: 'Yellow', colour: '#F0E442' },
  { name: 'Bluish green', colour: '#009E73' },
  { name: 'Sky blue', colour: '#56B4E9' },
  { name: 'Blue', colour: '#0072B2' },
  { name: 'Light blue', colour: RR73.newCallBand },
  { name: 'Reddish purple', colour: '#CC79A7' },
  { name: 'Black', colour: '#000000' },
  { name: 'Grey', colour: '#8C93A0' },
  { name: 'Red', colour: '#FF6666' },
  { name: 'Bright orange', colour: '#FF8000' },
  { name: 'Apricot', colour: '#FFCC99' },
  { name: 'Peach', colour: '#FFE2C8' },
  { name: 'Bright yellow', colour: '#FFFF00' },
  { name: 'Green', colour: '#66FF66' },
  { name: 'Cyan', colour: '#00FFFF' },
  { name: 'Light cyan', colour: '#99FFFF' },
];

/** RR73's colours, every category on, in WSJT-X's order: background categories by rank, then text layers. */
export function defaultHighlights(): HighlightEntry[] {
  const key = (c: HighlightCategory) => (c.style === 'text' ? 1000 : 0) + c.rank;
  return [...CATEGORIES].sort((a, b) => key(a) - key(b)).map((c) => ({ id: c.id, on: true, colour: c.colour }));
}

/** True for categories that tint the row's background, in priority order. */
export function isBackground(e: { id: HighlightId }): boolean {
  return category(e.id).style === 'background';
}

/** `entries` with the background category at `from` moved to `to`, both counted among background categories only. */
export function moveBackground(entries: readonly HighlightEntry[], from: number, to: number): HighlightEntry[] {
  return [...moveEntry(entries.filter(isBackground), from, to), ...entries.filter((e) => !isBackground(e)).map((e) => ({ ...e }))];
}

/** "#ff6666" gives "#FF6666"; anything that is not a 6-digit hex colour gives null. */
export function normaliseColour(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : null;
}

/**
 * The stored order with unknown and repeated categories dropped, bad values replaced by the
 * defaults, and each missing category inserted after the last stored one that ranks above it in
 * WSJT-X's order, or first when none does.
 */
export function normaliseHighlights(raw: unknown): HighlightEntry[] {
  if (!Array.isArray(raw)) return defaultHighlights();
  const out: HighlightEntry[] = [];
  for (const r of raw as unknown[]) {
    const e = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    if (!isHighlightId(e.id) || out.some((o) => o.id === e.id)) continue;
    const c = category(e.id);
    out.push({ id: c.id, on: typeof e.on === 'boolean' ? e.on : true, colour: normaliseColour(e.colour) ?? c.colour });
  }
  for (const c of [...CATEGORIES].sort((a, b) => a.rank - b.rank)) {
    if (out.some((o) => o.id === c.id)) continue;
    let above = -1;
    out.forEach((o, i) => {
      if (category(o.id).rank < c.rank) above = i;
    });
    out.splice(above + 1, 0, { id: c.id, on: true, colour: c.colour });
  }
  return out;
}

/** True when `entries` hold the default order and colours with every category on. */
export function isDefault(entries: readonly HighlightEntry[]): boolean {
  const d = defaultHighlights();
  return entries.length === d.length && entries.every((e, i) => e.id === d[i].id && e.on && e.colour === d[i].colour);
}

/** `entries` with the one at `from` moved to `to`. */
/** A preset in Settings › Decode colours: a colour scheme and which categories are on. Every preset keeps the default order. */
export type PresetId = 'rr73' | 'quiet' | 'wsjtx' | 'monokai' | 'solarized' | 'dracula' | 'nord' | 'gruvbox';

export interface Preset {
  id: PresetId;
  label: string;
  /** Only what the label leaves out. */
  sub?: string;
  colours: Record<HighlightId, string>;
  off: readonly HighlightId[];
}

/** A scheme from 6 colours: each "on this band" category takes its category's colour mixed with white. */
function scheme(c: { myCall: string; newGrid: string; newCall: string; ending: string; cq: string; sent: string; worked: string }): Record<HighlightId, string> {
  return { ...c, newGridBand: bandColour(c.newGrid), newCallBand: bandColour(c.newCall) };
}

/**
 * The presets. WSJT-X's colours and switches are WSJT-X 2.7.0's defaults, read from its Settings ›
 * Colors tab; it has no Ending a QSO or Worked before, so those start off. The editor schemes take
 * each palette's accents, assigned so the closest pair of row tints stays furthest apart.
 */
export const PRESETS: readonly Preset[] = [
  { id: 'rr73', label: 'RR73', sub: 'Distinct with colour blindness', colours: RR73, off: [] },
  // My call, Sent, CQ and Ending a QSO only.
  { id: 'quiet', label: 'Quiet', colours: RR73, off: ['newGrid', 'newGridBand', 'newCall', 'newCallBand', 'worked'] },
  {
    id: 'wsjtx',
    // lint-copy: off
    label: 'WSJT-X',
    // lint-copy: on
    colours: { myCall: '#FF6666', newGrid: '#FF8000', newGridBand: '#FFCC99', newCall: '#00FFFF', newCallBand: '#99FFFF', ending: '#FFE2C8', cq: '#66FF66', sent: '#FFFF00', worked: '#8C93A0' },
    off: ['newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'worked'],
  },
  { id: 'monokai', label: 'Monokai', colours: scheme({ myCall: '#F92672', newGrid: '#E6DB74', newCall: '#66D9EF', ending: '#FD971F', cq: '#A6E22E', sent: '#AE81FF', worked: '#75715E' }), off: [] },
  { id: 'solarized', label: 'Solarized', colours: scheme({ myCall: '#DC322F', newGrid: '#CB4B16', newCall: '#268BD2', ending: '#D33682', cq: '#859900', sent: '#93A1A1', worked: '#586E75' }), off: [] },
  { id: 'dracula', label: 'Dracula', colours: scheme({ myCall: '#FF5555', newGrid: '#FFB86C', newCall: '#8BE9FD', ending: '#BD93F9', cq: '#50FA7B', sent: '#FF79C6', worked: '#6272A4' }), off: [] },
  { id: 'nord', label: 'Nord', colours: scheme({ myCall: '#BF616A', newGrid: '#EBCB8B', newCall: '#88C0D0', ending: '#5E81AC', cq: '#A3BE8C', sent: '#4C566A', worked: '#616E88' }), off: [] },
  { id: 'gruvbox', label: 'Gruvbox', colours: scheme({ myCall: '#FB4934', newGrid: '#FE8019', newCall: '#83A598', ending: '#FABD2F', cq: '#8EC07C', sent: '#928374', worked: '#A89984' }), off: [] },
];

/** The entries a preset sets: the default order, the preset's colours, its categories off. */
export function presetHighlights(id: PresetId): HighlightEntry[] {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return defaultHighlights().map((e) => ({ id: e.id, on: !p.off.includes(e.id), colour: p.colours[e.id] }));
}

/** The preset whose order, colours and switches the entries match, or 'custom'. */
export function presetOf(entries: readonly HighlightEntry[]): PresetId | 'custom' {
  for (const p of PRESETS) {
    const d = presetHighlights(p.id);
    if (entries.length === d.length && entries.every((e, i) => e.id === d[i].id && e.on === d[i].on && e.colour === d[i].colour)) return p.id;
  }
  return 'custom';
}

/** The name Settings shows for a preset, or Custom. */
export function presetLabel(id: PresetId | 'custom'): string {
  return PRESETS.find((p) => p.id === id)?.label ?? 'Custom';
}

export function moveEntry(entries: readonly HighlightEntry[], from: number, to: number): HighlightEntry[] {
  const out = entries.map((e) => ({ ...e }));
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [e] = out.splice(from, 1);
  out.splice(to, 0, e);
  return out;
}

/** Where the decodes are heard: band ("20m") and mode ("FT8"). */
export interface Where {
  band: string;
  mode: string;
}

/** A decode as the matcher needs it; `sent` is true for the operator's own transmissions. */
export interface HighlightInput {
  text: string;
  sent?: boolean;
}

/** A decode's colours: the background category that won, and the text layer, each null when none. */
export interface DecodeHighlight {
  bg: HighlightId | null;
  ink: HighlightId | null;
}

/**
 * The first enabled background category in `entries` that matches the decode, and the first
 * enabled text layer that does. `myCall` is the operator's callsign; `index` is the log's
 * (buildLogIndex), built once per change of the log.
 */
export function highlightDecode(decode: HighlightInput, myCall: string, index: LogIndex, where: Where, entries: readonly HighlightEntry[]): DecodeHighlight {
  const sent = decode.sent === true;
  const me = baseCall(myCall.trim().toUpperCase());
  const tokens = decode.text.trim().toUpperCase().split(/\s+/);
  const mine = !sent && !!me && tokens.some((t) => looksLikeCall(t) && baseCall(t) === me);
  const ex = sent ? null : parseExchange(decode.text);
  // The sender, unless it is the operator or an unresolved hash; for new call, new grid and
  // ending a QSO, only the sender of a CQ, 73 or RR73.
  const from = ex?.from && ex.from !== '<...>' ? callKey(ex.from) : '';
  const sender = from && from !== me ? from : '';
  const station = sender && (ex?.kind === 'cq' || ex?.kind === '73' || ex?.kind === 'rr73') ? sender : '';
  const grid = station && ex?.grid ? gridKey(ex.grid) : '';
  // RR73 or 73 from a station to anyone but the operator: that station is about to be free.
  const ending = !!station && (ex?.kind === '73' || ex?.kind === 'rr73') && !!ex.to && callKey(ex.to) !== me;
  const band = where.band.toLowerCase();

  const test: Record<HighlightId, () => boolean> = {
    myCall: () => mine,
    sent: () => sent,
    cq: () => !sent && tokens[0] === 'CQ',
    ending: () => ending,
    newCall: () => !!station && !index.calls.has(station),
    newCallBand: () => !!station && !setOf(index.callsByBand, band).has(station),
    newGrid: () => !!grid && !index.grids.has(grid),
    newGridBand: () => !!grid && !setOf(index.gridsByBand, band).has(grid),
    worked: () => !!sender && setOf(index.callsByBandMode, bandModeKey(band, where.mode)).has(sender),
  };
  const first = (style: HighlightStyle) => entries.find((e) => e.on && category(e.id).style === style && test[e.id]())?.id ?? null;
  return { bg: first('background'), ink: first('text') };
}
