import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PALETTES, RR73_POSITIONS, buildLut, isPaletteId, paletteFrom, paletteSpec, parseColor, stopTokens, type PaletteId, type Rgb } from './colormap';

const tokens = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
  if (!m) throw new Error(`${name} missing from tokens.css`);
  return m[1];
};

/** The colormap agreed in October 2026: navy noise, cyan from 3 dB over it, mint, yellow, warm white. */
const MOCKUP: Rgb[] = [
  [4, 6, 10],
  [11, 29, 69],
  [24, 152, 216],
  [79, 210, 255],
  [138, 240, 200],
  [255, 240, 96],
  [255, 248, 230],
];

/** CIELAB (D65) of an sRGB colour. */
function lab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const lutAt = (lut: Uint8ClampedArray, i: number): Rgb => [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];

describe('parseColor', () => {
  it('reads hex and rgb() forms', () => {
    expect(parseColor('#04060A')).toEqual([4, 6, 10, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor(' rgb(255 255 255 / 18%) ')).toEqual([255, 255, 255, 0.18]);
    expect(parseColor('rgba(4, 6, 10, 0.62)')).toEqual([4, 6, 10, 0.62]);
    expect(parseColor('rgb(1 2 3)')).toEqual([1, 2, 3, 1]);
    // Minified forms of the same tokens.
    expect(parseColor('#ffffff2e')).toEqual([255, 255, 255, 0.18]);
    expect(parseColor('#04060a9e')).toEqual([4, 6, 10, 0.62]);
    expect(parseColor('#fff8')).toEqual([255, 255, 255, 0.533]);
  });

  it('rejects anything else', () => {
    expect(() => parseColor('light-dark(#fff, #000)')).toThrow();
    expect(() => parseColor('')).toThrow();
  });
});

describe('waterfall palettes', () => {
  it('are RR73, Fire and Grey, RR73 first', () => {
    expect(PALETTES.map((p) => [p.id, p.label])).toEqual([
      ['rr73', 'RR73'],
      ['fire', 'Fire'],
      ['grey', 'Grey'],
    ]);
    expect(PALETTES.every((p) => isPaletteId(p.id))).toBe(true);
    expect([isPaletteId('viridis'), isPaletteId('Grey'), isPaletteId(undefined)]).toEqual([false, false, false]);
    expect(stopTokens('fire')).toEqual(Array.from({ length: 9 }, (_, i) => `--rr-wf-fire-c${i}`));
  });

  for (const spec of PALETTES) {
    describe(spec.label, () => {
      const palette = paletteFrom(token, spec.id);
      const lut = buildLut(palette.stops, palette.positions);

      it('takes one stop per position from tokens.css, from 0 to 1', () => {
        expect(palette.stops).toHaveLength(spec.positions.length);
        expect(palette.positions).toEqual([...spec.positions]);
        expect(spec.positions[0]).toBe(0);
        expect(spec.positions.at(-1)).toBe(1);
        for (let i = 1; i < spec.positions.length; i++) expect(spec.positions[i]).toBeGreaterThan(spec.positions[i - 1]);
        expect(palette.background).toEqual([4, 6, 10]);
        expect(palette.line).toEqual([255, 255, 255, 0.18]);
      });

      it('runs from its first stop to its last, through each stop', () => {
        expect(lutAt(lut, 0)).toEqual(palette.stops[0]);
        expect(lutAt(lut, 255)).toEqual(palette.stops.at(-1));
        spec.positions.forEach((p, i) => {
          lutAt(lut, Math.round(p * 255)).forEach((c, k) => expect(Math.abs(c - palette.stops[i][k])).toBeLessThanOrEqual(6));
        });
      });

      // RR73's table dips 0.04 L* where cyan turns to mint, far under the 1 L* an eye can tell.
      it('gets lighter at every step, from near black', () => {
        for (let i = 1; i < 256; i++) expect(lab(lutAt(lut, i))[0], `step ${i}`).toBeGreaterThan(lab(lutAt(lut, i - 1))[0] - 0.1);
        expect(lab(palette.stops[0])[0]).toBeLessThan(3);
      });
    });
  }

  it('keeps RR73’s colours as agreed: navy noise, cyan from 3 dB over it', () => {
    const palette = paletteFrom(token);
    expect(palette.stops).toEqual(MOCKUP);
    expect(palette.positions).toEqual([...RR73_POSITIONS]);
    expect(paletteSpec('rr73').positions).toBe(RR73_POSITIONS);
  });

  for (const id of ['fire', 'grey'] as PaletteId[]) {
    it(`raises lightness evenly in ${paletteSpec(id).label}: L* within 2 of a straight line`, () => {
      const p = paletteFrom(token, id);
      const lut = buildLut(p.stops, p.positions);
      const [l0, l1] = [lab(p.stops[0])[0], lab(p.stops.at(-1)!)[0]];
      let worst = 0;
      for (let i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(lab(lutAt(lut, i))[0] - (l0 + ((l1 - l0) * i) / 255)));
      expect(worst).toBeLessThan(2);
      expect(l1 - l0).toBeGreaterThan(90);
    });
  }

  it('turns Fire from indigo through crimson and orange to pale yellow', () => {
    const p = paletteFrom(token, 'fire');
    const hue = (c: Rgb) => {
      const [, a, b] = lab(c);
      return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    };
    // Bluish at the bottom, red at the middle, yellow at the top: CIELAB hue angles.
    expect(hue(p.stops[1])).toBeGreaterThan(270);
    expect(hue(p.stops[4])).toBeLessThan(20);
    expect(hue(p.stops[6])).toBeGreaterThan(40);
    expect(hue(p.stops[7])).toBeGreaterThan(65);
    expect(lab(p.stops[8])[0]).toBeGreaterThan(95);
  });

  it('keeps Grey neutral', () => {
    const p = paletteFrom(token, 'grey');
    for (const [r, g, b] of p.stops) expect([g, b]).toEqual([r, r]);
    expect(p.stops.at(-1)).toEqual([255, 255, 255]);
  });

  it('needs one colour per stop', () => {
    expect(() => buildLut(MOCKUP.slice(0, 3), RR73_POSITIONS)).toThrow(RangeError);
  });
});
