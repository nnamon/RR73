/**
 * Colours for decode colours that depend on the row: the text colour of the worked-before layer,
 * which sits on a plain row or on any category's tint. The tint itself is CSS (.rr-hl in
 * tokens.css); TINT and BASE mirror its tokens, and highlight-contrast.test.ts checks they match.
 *
 * A text colour keeps 4.5:1 or more against what it sits on, in each theme: darkened toward black
 * in light and lightened toward white in dark, as little as that takes, so it stays closest to the
 * colour chosen.
 */

export type Theme = 'light' | 'dark';
export type Rgb = [number, number, number];

/** Share of the category colour in a row's tint (--rr-hl-tint-light, --rr-hl-tint-dark). */
export const TINT: Record<Theme, number> = { light: 0.45, dark: 0.3 };
/** The same in rows of older slots, which fade (--rr-hl-tint-old-light, --rr-hl-tint-old-dark). */
export const TINT_OLD: Record<Theme, number> = { light: 0.25, dark: 0.18 };
/** Text of rows from older slots (--rr-old-text). */
export const OLD_TEXT: Record<Theme, string> = { light: '#6E7684', dark: '#8C93A0' };
/** What the tint is mixed with (--rr-hl-base-light, --rr-hl-base-dark). */
export const BASE: Record<Theme, string> = { light: '#FFFFFF', dark: '#000000' };
/**
 * The ground under a plain row's text that gives the least contrast: the list and the groups are
 * #FFF in light; in dark the groups (#1C1C1E) are lighter than the list (#000).
 */
export const GROUND: Record<Theme, string> = { light: '#FFFFFF', dark: '#1C1C1E' };
/** Aimed a little above 4.5:1, so rounding to whole channel values never drops below it. */
const TARGET = 4.6;

export function rgb(hex: string): Rgb {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export function hex(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG 2 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A row's tint for `colour` in `theme`, as color-mix() in sRGB gives it; `share` of the colour. */
export function tintOf(colour: string, theme: Theme, share = TINT[theme]): Rgb {
  const c = rgb(colour);
  const base = rgb(BASE[theme]);
  return c.map((v, i) => v * share + base[i] * (1 - share)) as Rgb;
}

function adjust(c: Rgb, theme: Theme, k: number): Rgb {
  return theme === 'light' ? (c.map((v) => v * k) as Rgb) : (c.map((v) => 255 - (255 - v) * k) as Rgb);
}

/** `ink` as text on `under` in `theme`, changed as little as 4.5:1 needs. */
export function readableOn(ink: string, under: Rgb, theme: Theme): string {
  const c = rgb(ink);
  const ok = (k: number) => contrast(rgb(hex(adjust(c, theme, k))), under) >= TARGET;
  if (ok(1)) return hex(c);
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return hex(adjust(c, theme, lo));
}

/** The text colour for `ink` on a row tinted with `bg` (null for a plain row), in each theme. */
export function inkFor(ink: string, bg: string | null): Record<Theme, string> {
  return {
    light: readableOn(ink, bg ? tintOf(bg, 'light') : rgb(GROUND.light), 'light'),
    dark: readableOn(ink, bg ? tintOf(bg, 'dark') : rgb(GROUND.dark), 'dark'),
  };
}

/** The text colour of an older slot's row tinted with `bg`, in each theme: the old grey, kept at 4.5:1 on the faded tint. */
export function oldInkFor(bg: string): Record<Theme, string> {
  return {
    light: readableOn(OLD_TEXT.light, tintOf(bg, 'light', TINT_OLD.light), 'light'),
    dark: readableOn(OLD_TEXT.dark, tintOf(bg, 'dark', TINT_OLD.dark), 'dark'),
  };
}
