// RR73's scheme keeps every pair of categories apart with colour blindness, as its subtitle says.
// Each colour is tinted as a row shows it (45% colour on white in light, 30% on #0B0D10 in dark,
// tokens.css), seen through Machado, Oliveira and Fernandes's 2009 simulation at severity 1, and
// compared in CIELAB (ΔE76), with each other and with a plain row (white in light, black in dark).
// The "on this band" categories are paler forms of their category and are left out of the pairs
// with it.
import { describe, expect, it } from 'vitest';
import { PRESETS, type HighlightId } from './highlight';

const SIM = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
type Vision = keyof typeof SIM | 'normal';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lab([r, g, b]: number[]): number[] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function tint(hex: string, theme: 'light' | 'dark'): number[] {
  const dark = [11, 13, 16];
  return rgb(hex).map((v, i) => (theme === 'light' ? 0.45 * v + 0.55 * 255 : 0.3 * v + 0.7 * dark[i]));
}
function seen(hex: string, theme: 'light' | 'dark', vision: Vision): number[] {
  let l = tint(hex, theme).map(linear);
  if (vision !== 'normal') l = SIM[vision].map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
  return lab(l);
}
const BACKGROUNDS: HighlightId[] = ['myCall', 'newGrid', 'newGridBand', 'newCall', 'newCallBand', 'ending', 'cq', 'sent'];
const SIBLINGS = new Set(['newGrid newGridBand', 'newCall newCallBand']);

/** The closest pair of background categories over both themes and every vision, ΔE. */
function closest(colours: Record<HighlightId, string>, pair?: [HighlightId, HighlightId]): number {
  let min = Infinity;
  for (const theme of ['light', 'dark'] as const)
    for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const)
      for (let i = 0; i < BACKGROUNDS.length; i++)
        for (let j = i + 1; j < BACKGROUNDS.length; j++) {
          const [a, b] = [BACKGROUNDS[i], BACKGROUNDS[j]];
          if (SIBLINGS.has(`${a} ${b}`) || (pair && !(a === pair[0] && b === pair[1]))) continue;
          const [p, q] = [seen(colours[a], theme, vision), seen(colours[b], theme, vision)];
          min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
        }
  return min;
}

const colours = (id: string) => PRESETS.find((p) => p.id === id)!.colours;

/** The background category closest to a plain row, over both themes and every vision, ΔE. */
function closestToPlain(colours: Record<HighlightId, string>): number {
  let min = Infinity;
  for (const theme of ['light', 'dark'] as const)
    for (const vision of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
      let plain = (theme === 'light' ? [255, 255, 255] : [0, 0, 0]).map(linear);
      if (vision !== 'normal') plain = SIM[vision].map((row) => Math.min(1, Math.max(0, row[0] * plain[0] + row[1] * plain[1] + row[2] * plain[2])));
      const p = lab(plain);
      for (const id of BACKGROUNDS) {
        const q = seen(colours[id], theme, vision);
        min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
    }
  return min;
}

describe('RR73’s scheme with colour blindness', () => {
  it('keeps every pair of categories 5.5 ΔE apart or more, and each 10 ΔE from a plain row, in both themes', () => {
    expect(closest(colours('rr73'))).toBeGreaterThanOrEqual(5.5);
    expect(closestToPlain(colours('rr73'))).toBeGreaterThanOrEqual(10);
  });

  it('keeps My call and CQ 16 ΔE apart or more, where WSJT-X’s colours fall to 11', () => {
    expect(closest(colours('rr73'), ['myCall', 'cq'])).toBeGreaterThanOrEqual(16);
    expect(closest(colours('wsjtx'), ['myCall', 'cq'])).toBeLessThan(12);
  });

  it('beats every other scheme on its closest pair', () => {
    const rr73 = closest(colours('rr73'));
    for (const p of PRESETS.filter((x) => x.id !== 'rr73' && x.id !== 'quiet')) expect(closest(p.colours), p.id).toBeLessThan(rr73);
  });
});
