// Contrast of decode rows in their decode colours, WCAG 2: 4.5:1 for the row's text in light and
// dark, 7:1 in Sun. Tints come from the values in tokens.css with the arithmetic of its .rr-hl rule
// (color-mix() in sRGB), and Sun's from highlight-colour.ts (sunTint); worked-before text colours
// from highlight-colour.ts, over a plain row or any tint.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, PALETTE } from './highlight';
import { BASE as TS_BASE, GROUND, OLD_TEXT, SUN_TINT_MAX, TINT as TS_TINT, TINT_OLD, inkFor, oldInkFor, rgb, sunShare, sunTint, tintOf } from './highlight-colour';

const css = readFileSync(join(__dirname, '../../styles/tokens.css'), 'utf8');

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`no --${name} in tokens.css`);
  return m[1].trim();
}

type Rgb = [number, number, number];
const hex = rgb;

/** light-dark(#light, #dark) from tokens.css. */
function pair(name: string): { light: Rgb; dark: Rgb } {
  const m = /light-dark\((#[0-9A-F]+),\s*(#[0-9A-F]+)\)/i.exec(token(name));
  if (!m) throw new Error(`--${name} is not light-dark() of two hex colours`);
  return { light: hex(m[1]), dark: hex(m[2]) };
}

const pct = (name: string) => parseFloat(token(name)) / 100;

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const mix = (c: Rgb, base: Rgb, a: number): Rgb => c.map((v, i) => v * a + base[i] * (1 - a)) as Rgb;

const TINT = { light: pct('rr-hl-tint-light'), dark: pct('rr-hl-tint-dark') };
const BASE = { light: hex(token('rr-hl-base-light')), dark: hex(token('rr-hl-base-dark')) };
const LABEL = pair('rr-label');
/** What a plain row's text sits on: the decode list and the groups. */
const GROUNDS = [pair('rr-plain'), pair('rr-surface')];

const tint = (c: Rgb, theme: 'light' | 'dark'): Rgb => mix(c, BASE[theme], TINT[theme]);

const SWATCHES = [...new Set([...CATEGORIES.map((c) => c.colour), ...PALETTE.map((p) => p.colour)])];
/** Every colour with channels in steps of 17, as custom colours from the colour picker. */
const SWEEP: string[] = [];
for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) SWEEP.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
const GREY = CATEGORIES.find((c) => c.id === 'worked')!.colour;

/** Pairs of text colour and what it sits on that fall below 4.5:1. */
function lowInk(inks: string[], bgs: (string | null)[], theme: 'light' | 'dark'): string[] {
  const out: string[] = [];
  for (const i of inks)
    for (const b of bgs) {
      const t = hex(inkFor(i, b)[theme]);
      const unders = b ? [tint(hex(b), theme)] : GROUNDS.map((g) => g[theme]);
      if (unders.some((u) => contrast(t, u) < 4.5)) out.push(`${i} on ${b ?? 'plain'}`);
    }
  return out;
}

describe('decode colour contrast', () => {
  it('works out text colours from the same tint as tokens.css', () => {
    expect(TS_TINT).toEqual(TINT);
    expect({ light: hex(TS_BASE.light), dark: hex(TS_BASE.dark) }).toEqual(BASE);
    expect(hex(GROUND.light)).toEqual(GROUNDS[0].light);
    expect(hex(GROUND.dark)).toEqual(GROUNDS[1].dark);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps row text at 4.5:1 on every default and palette tint, and any colour, in ${theme}`, () => {
      const low = [...SWATCHES, ...SWEEP].filter((s) => contrast(LABEL[theme], tint(hex(s), theme)) < 4.5);
      expect(low).toEqual([]);
    });

    it(`keeps worked-before text at 4.5:1 on a plain row and on every tint in ${theme}`, () => {
      expect(lowInk(SWATCHES, [null, ...SWATCHES], theme)).toEqual([]);
    });

    it(`holds for custom text and tint colours across the colour cube in ${theme}`, () => {
      expect(lowInk(SWEEP, [null], theme)).toEqual([]);
      expect(lowInk([GREY], SWEEP, theme)).toEqual([]);
    });
  }

  it('keeps the default worked-before grey apart from the row text', () => {
    const cq = CATEGORIES.find((c) => c.id === 'cq')!.colour;
    for (const theme of ['light', 'dark'] as const) {
      const ground = GROUNDS[0][theme];
      expect(contrast(hex(inkFor(GREY, null)[theme]), ground)).toBeLessThan(contrast(LABEL[theme], ground) / 2);
      // On the CQ tint the grey and the row text differ by 1.5:1 or more.
      expect(contrast(hex(inkFor(GREY, cq)[theme]), LABEL[theme])).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe('rows of older slots', () => {
  const colours = [...new Set([...CATEGORIES.map((c) => c.colour), ...PALETTE.map((p) => p.colour), '#000000', '#FFFFFF', '#808080', '#0000FF'])];

  it('take their faded tint and grey text from tokens.css', () => {
    expect(TINT_OLD).toEqual({ light: pct('rr-hl-tint-old-light'), dark: pct('rr-hl-tint-old-dark'), sun: pct('rr-hl-tint-old-sun') });
    const text = pair('rr-old-text');
    expect([rgb(OLD_TEXT.light), rgb(OLD_TEXT.dark)]).toEqual([text.light, text.dark]);
    expect(TINT_OLD.light).toBeLessThan(TS_TINT.light);
    expect(TINT_OLD.dark).toBeLessThan(TS_TINT.dark);
  });

  it('keep 4.5:1 for grey text on a plain row', () => {
    for (const theme of ['light', 'dark'] as const) expect(contrast(rgb(OLD_TEXT[theme]), rgb(GROUND[theme]))).toBeGreaterThanOrEqual(4.5);
  });

  it('keep 4.5:1 on every faded tint', () => {
    for (const c of colours) {
      const ink = oldInkFor(c);
      for (const theme of ['light', 'dark'] as const) expect(contrast(rgb(ink[theme]), tintOf(c, theme, TINT_OLD[theme])), `${c} ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stay the old grey on a plain row', () => {
    expect([rgb(OLD_TEXT.light), rgb(OLD_TEXT.dark), rgb(OLD_TEXT.sun)].map((c) => Math.max(...c) - Math.min(...c) < 24)).toEqual([true, true, true]);
  });
});

describe('decode colours in Sun', () => {
  /** A token's value in Sun: its own, or light's. */
  const SUN_BLOCK = css.slice(css.indexOf(":root[data-theme='sun'] {"), css.indexOf('\n}', css.indexOf(":root[data-theme='sun'] {")));
  const sunHex = (name: string): Rgb => {
    const m = new RegExp(`--${name}:\\s*(#[0-9A-F]+);`, 'i').exec(SUN_BLOCK);
    return m ? hex(m[1]) : pair(name).light;
  };
  const label = sunHex('rr-label');
  const grounds = [sunHex('rr-plain'), sunHex('rr-surface')];
  /** Sun's tint as CSS gets it: --rr-hl-sun, whole channel values. */
  const sunTintOf = (c: string): Rgb => hex(sunTint(c));
  const ALL = [...SWATCHES, ...SWEEP];
  const rr73 = CATEGORIES.filter((c) => c.style === 'background').map((c) => c.colour);

  it('works out text colours from the grounds and old grey of tokens.css', () => {
    expect([hex(GROUND.sun), hex(TS_BASE.sun)]).toEqual([grounds[0], hex('#FFFFFF')]);
    expect(grounds[1]).toEqual(grounds[0]);
    expect(rgb(OLD_TEXT.sun)).toEqual(sunHex('rr-old-text'));
    expect(label).toEqual([0, 0, 0]);
  });

  it('keeps row text at 7:1 on the tint of any colour, 9:1 within rounding', () => {
    const lowest = Math.min(...ALL.map((s) => contrast(label, sunTintOf(s))));
    expect(lowest).toBeGreaterThanOrEqual(7);
    expect(lowest).toBeGreaterThan(8.99);
  });

  it('tints RR73’s colours with more colour than light, up to 60%', () => {
    for (const c of rr73) {
      expect(sunShare(c), c).toBeGreaterThanOrEqual(TS_TINT.light);
      expect(sunShare(c), c).toBeLessThanOrEqual(SUN_TINT_MAX);
    }
    // Black, the darkest colour there is, still shows: a grey a third of the way to black.
    expect(sunShare('#000000')).toBeGreaterThan(0.3);
  });

  it('keeps worked-before text at 7:1 on a plain row, and 4.5:1 on every tint', () => {
    const low: string[] = [];
    for (const i of [...SWATCHES, ...SWEEP]) {
      const t = hex(inkFor(i, null).sun);
      if (grounds.some((g) => contrast(t, g) < 7)) low.push(`${i} on plain`);
    }
    for (const i of SWATCHES) for (const b of SWATCHES) if (contrast(hex(inkFor(i, b).sun), sunTintOf(b)) < 4.5) low.push(`${i} on ${b}`);
    for (const b of SWEEP) if (contrast(hex(inkFor(GREY, b).sun), sunTintOf(b)) < 4.5) low.push(`${GREY} on ${b}`);
    expect(low).toEqual([]);
  });

  it('keeps the default worked-before grey apart from the row text', () => {
    const ground = grounds[0];
    expect(contrast(hex(inkFor(GREY, null).sun), ground)).toBeLessThan(contrast(label, ground) / 2);
    // On every tint of RR73's scheme the grey and the row text differ by 1.9:1 or more.
    for (const c of rr73) expect(contrast(hex(inkFor(GREY, c).sun), label), c).toBeGreaterThanOrEqual(1.9);
  });

  it('keeps 7:1 in rows of older slots, on a plain row and on every faded tint', () => {
    expect(contrast(rgb(OLD_TEXT.sun), grounds[0])).toBeGreaterThanOrEqual(7);
    const colours = [...new Set([...SWATCHES, '#000000', '#FFFFFF', '#808080', '#0000FF'])];
    for (const c of colours) expect(contrast(rgb(oldInkFor(c).sun), tintOf(c, 'sun', TINT_OLD.sun)), c).toBeGreaterThanOrEqual(7);
    expect(TINT_OLD.sun).toBeLessThan(TS_TINT.light);
  });
});
