/**
 * The waterfall colormaps, chosen in Settings › Radio and audio › Waterfall colours. Colours come
 * from tokens.css (--rr-wf-<palette>-c0 onwards); positions on the 0 to 1 display scale are fixed
 * here.
 *
 * - RR73, the default: navy for average noise, cyan from 3 dB over it, then mint, yellow and a
 *   warm white for the strongest signals. With the default contrast (levels.ts) the stops sit at
 *   the average noise and 3, 6, 10, 14.5 and 20 dB over it.
 * - Fire: CIELAB lightness L* rises evenly from 2 to 97 while the hue turns from indigo through
 *   purple, crimson and orange to a pale yellow, so equal steps in dB look like equal steps.
 * - Grey: L* rises evenly from 1 to 100.
 *
 * Fire and Grey have 9 stops 1/8 apart, worked out in CIELCh (D65) along those paths, with chroma
 * reduced where a colour falls outside sRGB. Between stops the table is linear in sRGB, which keeps
 * L* within 2 of the straight line (colormap.test.ts).
 */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export type PaletteId = 'rr73' | 'fire' | 'grey';

export interface PaletteSpec {
  id: PaletteId;
  label: string;
  /** Where each colour token sits on the 0 to 1 display scale. */
  positions: readonly number[];
}

/** RR73's stops: average noise at 0.2, then 3, 6, 10, 14.5 and 20 dB over it at Normal contrast. */
export const RR73_POSITIONS = [0, 0.2, 0.32, 0.44, 0.6, 0.78, 1] as const;
/** Nine stops 1/8 apart, for the palettes even in lightness. */
const EVEN_POSITIONS = Array.from({ length: 9 }, (_, i) => i / 8);

export const PALETTES: readonly PaletteSpec[] = [
  { id: 'rr73', label: 'RR73', positions: RR73_POSITIONS },
  { id: 'fire', label: 'Fire', positions: EVEN_POSITIONS },
  { id: 'grey', label: 'Grey', positions: EVEN_POSITIONS },
];

export function isPaletteId(v: unknown): v is PaletteId {
  return PALETTES.some((p) => p.id === v);
}

export function paletteSpec(id: PaletteId): PaletteSpec {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Token names for a palette's stops, in order: --rr-wf-fire-c0 and on. */
export function stopTokens(id: PaletteId): string[] {
  return paletteSpec(id).positions.map((_, i) => `--rr-wf-${id}-c${i}`);
}

/**
 * Parses "#RGB", "#RGBA", "#RRGGBB", "#RRGGBBAA", "rgb(r g b)", "rgb(r g b / a%)" and
 * "rgba(r, g, b, a)". The build's CSS minifier may rewrite a token into any of these forms.
 */
export function parseColor(text: string): Rgba {
  const s = text.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const alpha = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alpha];
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map(Number);
      const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
      if ([r, g, b, a].every(Number.isFinite)) return [r, g, b, a];
    }
  }
  throw new Error(`Unreadable colour "${text}".`);
}

/** 256-entry RGB lookup table, linear between stops. */
export function buildLut(colors: Rgb[], positions: readonly number[]): Uint8ClampedArray {
  if (colors.length !== positions.length || colors.length < 2) throw new RangeError('One colour per stop.');
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let j = 0;
    while (j < positions.length - 2 && v > positions[j + 1]) j++;
    const f = (v - positions[j]) / (positions[j + 1] - positions[j]);
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(colors[j][k] + (colors[j + 1][k] - colors[j][k]) * f);
  }
  return lut;
}

/** Colours the waterfall needs, read from the tokens on the main thread and sent to the worker. */
export interface WaterfallPalette {
  stops: Rgb[];
  positions: number[];
  background: Rgb;
  line: Rgba;
}

export function paletteFrom(read: (token: string) => string, id: PaletteId = 'rr73'): WaterfallPalette {
  const rgb = (t: string): Rgb => parseColor(read(t)).slice(0, 3) as Rgb;
  return { stops: stopTokens(id).map(rgb), positions: [...paletteSpec(id).positions], background: rgb('--rr-wf-bg'), line: parseColor(read('--rr-wf-line')) };
}
