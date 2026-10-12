import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STOP_POSITIONS, STOP_TOKENS, buildLut, paletteFrom, parseColor, type Rgb } from './colormap';

const tokens = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
  if (!m) throw new Error(`${name} missing from tokens.css`);
  return m[1];
};

/** The mockup's colormap (mockups.js STOPS), for comparison with the tokens. */
const MOCKUP: Rgb[] = [
  [4, 6, 10],
  [10, 21, 48],
  [18, 62, 110],
  [26, 127, 154],
  [76, 195, 163],
  [240, 210, 90],
  [255, 248, 230],
];

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

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

describe('waterfall colormap', () => {
  const palette = paletteFrom(token);

  it('takes its stops from tokens.css, matching the mockups', () => {
    expect(STOP_TOKENS).toHaveLength(STOP_POSITIONS.length);
    expect(palette.stops).toEqual(MOCKUP);
    expect(palette.background).toEqual([4, 6, 10]);
    expect(palette.line).toEqual([255, 255, 255, 0.18]);
  });

  it('runs from the darkest stop to the brightest', () => {
    const lut = buildLut(palette.stops);
    expect(Array.from(lut.slice(0, 3))).toEqual(MOCKUP[0]);
    expect(Array.from(lut.slice(255 * 3))).toEqual(MOCKUP[6]);
  });

  it('passes through each stop', () => {
    const lut = buildLut(palette.stops);
    STOP_POSITIONS.forEach((p, i) => {
      const at = Math.round(p * 255);
      const got = Array.from(lut.slice(at * 3, at * 3 + 3));
      got.forEach((c, k) => expect(Math.abs(c - MOCKUP[i][k])).toBeLessThanOrEqual(6));
    });
  });

  it('gets brighter at every step', () => {
    const lut = buildLut(palette.stops);
    for (let i = 1; i < 256; i++) {
      const a = luminance(lut[(i - 1) * 3], lut[(i - 1) * 3 + 1], lut[(i - 1) * 3 + 2]);
      const b = luminance(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });

  it('needs one colour per stop', () => {
    expect(() => buildLut(MOCKUP.slice(0, 3))).toThrow(RangeError);
  });
});
