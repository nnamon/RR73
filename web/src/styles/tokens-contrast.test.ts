// Text contrast of every text token on what it sits on, in light and dark, WCAG 2. Text needs 4.5:1;
// glyphs that carry no text (chevrons) need 3:1. Values come from tokens.css: light-dark() picks
// the theme, var() references resolve, and translucent layers composite in sRGB over the ground
// beneath them, as the browser draws them. Decode colours have their own test
// (lib/decode/highlight-contrast.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Theme = 'light' | 'dark';
type Rgba = [number, number, number, number];

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

/** The custom properties of the :root block. */
const TOKENS: Map<string, string> = (() => {
  const start = css.indexOf(':root {');
  const body = css.slice(start, css.indexOf('\n}', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--(rr-[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
})();

/** Splits a function's arguments at top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseColour(s: string): Rgba {
  const v = s.trim();
  if (v.startsWith('#')) {
    const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!m) throw new Error(`not a colour: ${s}`);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), a];
}

/** A token's colour in a theme. */
function colour(name: string, theme: Theme): Rgba {
  const raw = TOKENS.get(name);
  if (raw === undefined) throw new Error(`no --${name} in tokens.css`);
  return valueOf(raw, theme);
}

function valueOf(raw: string, theme: Theme): Rgba {
  const v = raw.trim();
  const ref = /^var\(--(rr-[a-z0-9-]+)\)$/.exec(v);
  if (ref) return colour(ref[1], theme);
  if (v.startsWith('light-dark(')) {
    const [light, dark] = args(v.slice('light-dark('.length, -1));
    return valueOf(theme === 'light' ? light : dark, theme);
  }
  return parseColour(v);
}

/** `top` drawn over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as Rgba;
}

/** Layers listed from the one right under the text down to an opaque ground, drawn as one colour. */
function ground(layers: string[], theme: Theme): Rgba {
  const cols = layers.map((l) => colour(l, theme));
  const base = cols.at(-1)!;
  if (base[3] !== 1) throw new Error(`${layers.at(-1)} is not opaque in ${theme}`);
  return cols.slice(0, -1).reduceRight((acc, c) => over(c, acc), base);
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Grounds, from the layer under the text down to an opaque colour.
const BG = ['rr-bg'];
const SURFACE = ['rr-surface'];
const PLAIN = ['rr-plain'];
const SHEET = ['rr-sheet'];
const CARD = ['rr-sheet-card'];
/** Operate's bars: the bar material over the screen. */
const DOCK = ['rr-dock', 'rr-plain'];
/** Every ground text in the label colours can sit on. */
const GROUNDS = [BG, SURFACE, PLAIN, SHEET, CARD, DOCK];

interface Pair {
  text: string;
  on: string[];
  /** 4.5 for text, 3 for glyphs without text. */
  min: number;
  where: string;
}

const pairs: Pair[] = [];
const add = (text: string, grounds: string[][], where: string, min = 4.5) => {
  for (const on of grounds) pairs.push({ text, on, min, where });
};

add('rr-label', GROUNDS, 'text on screens, groups, sheets and bars');
add('rr-label', [['rr-fill-bg', ...DOCK]], 'bottom bar buttons, the mode tag');
add('rr-label', [['rr-fill-bg', ...PLAIN]], 'filter chips');
add('rr-label', [['rr-fill3', ...BG], ['rr-fill3', ...SURFACE], ['rr-fill3', ...SHEET]], 'segmented controls, the search field');
add('rr-label', [['rr-seg-sel']], 'the selected segment');
add('rr-label', [['rr-fill', ...BG], ['rr-fill', ...SURFACE], ['rr-fill', ...SHEET], ['rr-fill', ...CARD], ['rr-fill', ...PLAIN]], 'buttons, the Next row');
add('rr-label', [['rr-sel-tint', ...PLAIN]], 'a selected decode');
add('rr-label', [['rr-accent-soft', ...PLAIN], ['rr-warn-soft', ...PLAIN]], 'banners in Operate');

add('rr-label2', GROUNDS, 'values, subtitles, section headers and footers, notes');
add('rr-label2', [['rr-fill-bg', ...PLAIN]], 'chip counts');
add('rr-label2', [['rr-fill2', ...SURFACE]], 'the not-sent badge');
add('rr-label2', [['rr-fill3', ...BG]], 'the search placeholder, segment counts');
add('rr-label2', [['rr-fill', ...PLAIN]], 'the Next tag');

add('rr-label3', GROUNDS, 'placeholders, SNR and frequency in decodes, step labels');
// On a tint, an older slot or a selected row the country takes the row's other text colours,
// which lib/decode/highlight-contrast.test.ts and the selected decode above check.
add('rr-label2', [PLAIN], 'the country on a CQ row');
add('rr-chev', [SURFACE, CARD], 'chevrons', 3);

add('rr-accent', GROUNDS, 'links, Back, bar buttons, row actions');
add('rr-accent', [['rr-accent-soft', ...DOCK], ['rr-accent-soft', ...SURFACE], ['rr-accent-soft', ...SHEET]], 'tinted buttons: Tx on, Share, Download');
add('rr-accent', [['rr-accent-soft', ...BG]], 'the This version badge');
add('rr-accent', [['rr-fill2', ...SURFACE], ['rr-fill2', ...CARD]], 'Use GPS');
add('rr-accent', [['rr-fill', ...PLAIN]], 'the countdown in the Next row');

add('rr-on-fill', [['rr-accent-fill'], ['rr-tx-fill'], ['rr-run']], 'filled buttons and tags');
add('rr-on-strong', [['rr-label'], ['rr-ok'], ['rr-teal'], ['rr-mag'], ['rr-run']], 'the open More button, filled badges, the Run tag');

add('rr-tx-text', [BG, SURFACE, SHEET, CARD, DOCK], 'errors, the current step');
add('rr-tx-text', [['rr-tx-soft', ...DOCK], ['rr-tx-soft', ...SHEET]], 'Halt in the bottom bar and in sheets');
add('rr-tx-text', [['rr-tx-soft', ...SURFACE], ['rr-tx-soft', ...BG], ['rr-tx-soft', ...PLAIN]], 'the refused badge, error banners');

add('rr-ok', [BG, SURFACE, PLAIN, CARD], 'delivered and level texts');
add('rr-ok', [['rr-ok-soft', ...SURFACE], ['rr-ok-soft', ...PLAIN]], 'the delivered badge, the activation chip');
add('rr-warn', [BG, SURFACE, PLAIN, DOCK], 'warnings');
add('rr-warn', [['rr-warn-soft', ...SURFACE], ['rr-warn-soft', ...PLAIN], ['rr-warn-soft', ...DOCK]], 'the waiting and Practice badges, the decoder notice');
add('rr-label', [['rr-warn-soft', ...BG]], 'the no-signal notice in Spots');
add('rr-warn', [['rr-warn-soft', ...BG]], 'the no-signal icon', 3);
add('rr-accent', [['rr-accent-soft', ...PLAIN]], 'the audio banner icon', 3);

add('rr-toast-text', [['rr-toast']], 'notices');
add('rr-toast-link', [['rr-toast']], 'notice actions');

add('rr-slot-even-strong', [['rr-slot-even']], 'even slot bars');
add('rr-slot-even-text', [['rr-slot-even']], 'even slot bars');
add('rr-slot-odd-strong', [['rr-slot-odd']], 'odd slot bars');
add('rr-slot-odd-text', [['rr-slot-odd']], 'odd slot bars');

add('rr-wf-text', [['rr-wf-bg'], ['rr-wf-tag-bg', 'rr-wf-bg']], 'waterfall times and hints');
add('rr-wf-ruler-text', [['rr-wf-ruler-veil', 'rr-wf-bg']], 'waterfall ruler');
add('rr-slot-quiet-strong', [['rr-slot-quiet']], 'the bar for a run of empty slots');
add('rr-slot-quiet-text', [['rr-slot-quiet']], 'the bar for a run of empty slots');

describe('token contrast', () => {
  it('reads every token it checks from tokens.css', () => {
    for (const p of pairs) for (const t of [p.text, ...p.on]) for (const theme of ['light', 'dark'] as const) expect(() => colour(t, theme), t).not.toThrow();
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps text at 4.5:1 and glyphs at 3:1 in ${theme}`, () => {
      const low = pairs
        .map((p) => {
          const under = ground(p.on, theme);
          const r = contrast(over(colour(p.text, theme), under), under);
          return { p, r };
        })
        .filter(({ p, r }) => r < p.min)
        .map(({ p, r }) => `--${p.text} on ${p.on.map((l) => `--${l}`).join(' over ')}: ${r.toFixed(2)}:1, under ${p.min}:1 (${p.where})`);
      expect(low).toEqual([]);
    });
  }
});
