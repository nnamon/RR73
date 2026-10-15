/**
 * Colours for decode colours that depend on the row: the text colour of the worked-before layer,
 * which sits on a plain row or on any category's tint, and Sun's tints. The tint itself is CSS
 * (.rr-hl in tokens.css); TINT and BASE mirror its tokens, and highlight-contrast.test.ts checks
 * they match.
 *
 * A text colour keeps 4.5:1 or more against what it sits on, in light and dark: darkened toward
 * black in light and lightened toward white in dark, as little as that takes, so it stays closest
 * to the colour chosen. In Sun it keeps 7:1 on a plain row; on a tint it keeps 4.5:1, which leaves
 * it 2:1 or more apart from the tint's black row text.
 */

export type Theme = 'light' | 'dark' | 'sun';
export type Rgb = [number, number, number];

/** Share of the category colour in a row's tint (--rr-hl-tint-light, --rr-hl-tint-dark). Sun's depends on the colour (sunShare). */
export const TINT: Record<'light' | 'dark', number> = { light: 0.45, dark: 0.3 };
/** The same in rows of older slots, which fade (--rr-hl-tint-old-light, --rr-hl-tint-old-dark, --rr-hl-tint-old-sun). */
export const TINT_OLD: Record<Theme, number> = { light: 0.25, dark: 0.18, sun: 0.3 };
/** Text of rows from older slots (--rr-old-text). */
export const OLD_TEXT: Record<Theme, string> = { light: '#6E7684', dark: '#8C93A0', sun: '#4B515C' };
/** What the tint is mixed with (--rr-hl-base-light, --rr-hl-base-dark; Sun takes light's). */
export const BASE: Record<Theme, string> = { light: '#FFFFFF', dark: '#000000', sun: '#FFFFFF' };
/**
 * The ground under a plain row's text that gives the least contrast: the list and the groups are
 * #FFF in light and Sun; in dark the groups (#1C1C1E) are lighter than the list (#000).
 */
export const GROUND: Record<Theme, string> = { light: '#FFFFFF', dark: '#1C1C1E', sun: '#FFFFFF' };
/** Sun's tint: as much colour as keeps its luminance at SUN_LUMINANCE, up to SUN_TINT_MAX. */
export const SUN_TINT_MAX = 0.6;
/** #000 row text has 9:1 on it, and worked-before text at 4.5:1 stays 2:1 apart from that text. */
export const SUN_LUMINANCE = 0.4;
/** Aimed a little above 4.5:1 and 7:1, so rounding to whole channel values never drops below them. */
const TARGET = 4.6;
const TARGET_SUN = 7.1;

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

const mix = (c: Rgb, base: Rgb, share: number): Rgb => c.map((v, i) => v * share + base[i] * (1 - share)) as Rgb;

const sunShares = new Map<string, number>();

/** Share of `colour` in Sun's tint: the most, up to SUN_TINT_MAX, that keeps the tint's luminance at SUN_LUMINANCE. */
export function sunShare(colour: string): number {
  let s = sunShares.get(colour);
  if (s !== undefined) return s;
  const c = rgb(colour);
  const white = rgb(BASE.sun);
  // Measured on the colour as CSS gets it: whole channel values.
  const ok = (k: number) => luminance(rgb(hex(mix(c, white, k)))) >= SUN_LUMINANCE;
  if (ok(SUN_TINT_MAX)) s = SUN_TINT_MAX;
  else {
    let [lo, hi] = [0, SUN_TINT_MAX];
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    s = lo;
  }
  sunShares.set(colour, s);
  return s;
}

/** A row's tint for `colour` in `theme`, as color-mix() in sRGB gives it; `share` of the colour. */
export function tintOf(colour: string, theme: Theme, share = theme === 'sun' ? sunShare(colour) : TINT[theme]): Rgb {
  return mix(rgb(colour), rgb(BASE[theme]), share);
}

/** Sun's tint for `colour`, as #RRGGBB, for --rr-hl-sun beside --rr-hl. */
export function sunTint(colour: string): string {
  return hex(tintOf(colour, 'sun'));
}

function adjust(c: Rgb, theme: Theme, k: number): Rgb {
  return theme === 'dark' ? (c.map((v) => 255 - (255 - v) * k) as Rgb) : (c.map((v) => v * k) as Rgb);
}

/** `ink` as text on `under` in `theme`, changed as little as `target` contrast needs: 4.5:1, a little over. */
export function readableOn(ink: string, under: Rgb, theme: Theme, target = TARGET): string {
  const c = rgb(ink);
  const ok = (k: number) => contrast(rgb(hex(adjust(c, theme, k))), under) >= target;
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
    sun: bg ? readableOn(ink, rgb(sunTint(bg)), 'sun') : readableOn(ink, rgb(GROUND.sun), 'sun', TARGET_SUN),
  };
}

/** The text colour of an older slot's row tinted with `bg`, in each theme: the old grey, kept at 4.5:1 on the faded tint, 7:1 in Sun. */
export function oldInkFor(bg: string): Record<Theme, string> {
  return {
    light: readableOn(OLD_TEXT.light, tintOf(bg, 'light', TINT_OLD.light), 'light'),
    dark: readableOn(OLD_TEXT.dark, tintOf(bg, 'dark', TINT_OLD.dark), 'dark'),
    sun: readableOn(OLD_TEXT.sun, tintOf(bg, 'sun', TINT_OLD.sun), 'sun', TARGET_SUN),
  };
}
