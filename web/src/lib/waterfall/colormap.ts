/**
 * The waterfall colormap: navy for average noise, cyan from 3 dB over it, then mint, yellow and a
 * warm white for the strongest signals. Colours come from tokens.css (--rr-wf-c0 to --rr-wf-c6);
 * positions are fixed here. With the default contrast (levels.ts) the stops sit at the average
 * noise and 3, 6, 10, 14.5 and 20 dB over it.
 */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** Where each colour token sits on the 0 to 1 display scale. */
export const STOP_POSITIONS = [0, 0.2, 0.32, 0.44, 0.6, 0.78, 1] as const;
/** Token names for the stops, in order. */
export const STOP_TOKENS = STOP_POSITIONS.map((_, i) => `--rr-wf-c${i}`);

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
export function buildLut(colors: Rgb[], positions: readonly number[] = STOP_POSITIONS): Uint8ClampedArray {
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
  background: Rgb;
  line: Rgba;
}

export function paletteFrom(read: (token: string) => string): WaterfallPalette {
  const rgb = (t: string): Rgb => parseColor(read(t)).slice(0, 3) as Rgb;
  return { stops: STOP_TOKENS.map(rgb), background: rgb('--rr-wf-bg'), line: parseColor(read('--rr-wf-line')) };
}
