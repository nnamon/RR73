/**
 * Size classes, from the window and never the device (docs/decisions/0008-large-screens.md):
 *
 * - compact: under 700 pt wide. The phone layout, also iPad Slide Over and Split View up to half
 *   the screen.
 * - compact height: 700 pt wide or more and under 500 pt tall, a phone on its side. Operate puts
 *   the decodes on the left and the waterfall and controls on the right; Log, Spots and Settings
 *   show their list and detail side by side.
 * - regular: everything else, iPad and desktop. Tabs in the top bar, Operate with Band activity,
 *   Rx frequency and the transmit panel, list and detail elsewhere. A window taller than wide (an
 *   iPad upright) keeps Operate's controls in a bar along the bottom.
 *
 * The class rides on the root element as data-size, so styles follow it without a media query of
 * their own, and on `layout` for the markup. 1 pt is 1 CSS pixel.
 */

export type SizeClass = 'compact' | 'compact-height' | 'regular';

/** Windows narrower than this are compact, pt. */
export const REGULAR_MIN_WIDTH = 700;
/** Windows at least REGULAR_MIN_WIDTH wide and shorter than this have compact height, pt. */
export const REGULAR_MIN_HEIGHT = 500;

export function sizeClassOf(width: number, height: number): SizeClass {
  if (width < REGULAR_MIN_WIDTH) return 'compact';
  if (height < REGULAR_MIN_HEIGHT) return 'compact-height';
  return 'regular';
}

/** Regular width in a window taller than wide: Operate keeps a bottom bar. */
export function uprightOf(width: number, height: number): boolean {
  return sizeClassOf(width, height) === 'regular' && height > width;
}

/**
 * A mouse or a trackpad is the main pointer (a desktop browser): the status line says
 * "Double-click to call" and Halt shows its key. An iPad stays touch, with a trackpad attached too.
 */
export type PointerKind = 'touch' | 'mouse';

const POINTER_QUERY = '(hover: hover) and (pointer: fine)';

function initialPointer(): PointerKind {
  if (typeof matchMedia === 'undefined') return 'touch';
  return matchMedia(POINTER_QUERY).matches ? 'mouse' : 'touch';
}

const w = typeof window === 'undefined' ? 393 : window.innerWidth;
const h = typeof window === 'undefined' ? 852 : window.innerHeight;

export const layout = $state<{ size: SizeClass; upright: boolean; pointer: PointerKind }>({
  size: sizeClassOf(w, h),
  upright: uprightOf(w, h),
  pointer: initialPointer(),
});

/** Compact height or regular: Log, Spots and Settings show list and detail side by side. */
export function split(): boolean {
  return layout.size !== 'compact';
}

function apply() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = sizeClassOf(width, height);
  const upright = uprightOf(width, height);
  if (size !== layout.size) layout.size = size;
  if (upright !== layout.upright) layout.upright = upright;
  const root = document.documentElement;
  root.dataset.size = size;
  if (upright) root.dataset.upright = '';
  else delete root.dataset.upright;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  apply();
  window.addEventListener('resize', apply);
  matchMedia(POINTER_QUERY).addEventListener('change', (e) => (layout.pointer = e.matches ? 'mouse' : 'touch'));
}
