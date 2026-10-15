// Icon paths from the approved mockups, on a 24 × 24 grid, drawn with currentColor.

function gearPath(): string {
  const p: string[] = [];
  const c = 12;
  const outer = 10.2;
  const inner = 7.6;
  const pt = (rad: number, deg: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(c + rad * Math.cos(t)).toFixed(2)} ${(c + rad * Math.sin(t)).toFixed(2)}`;
  };
  for (let i = 0; i < 8; i++) {
    const a = i * 45 - 90;
    p.push(pt(inner, a - 13.5), pt(outer, a - 7), pt(outer, a + 7), pt(inner, a + 13.5));
  }
  return `M${p.join(' L')} Z`;
}

export interface IconShape {
  /** Stroked paths. */
  stroke?: string[];
  /** Filled paths. */
  fill?: string[];
  /** Filled circles: [cx, cy, r]. */
  dots?: [number, number, number][];
  /** Stroked circles and ellipses: [cx, cy, rx, ry]. */
  rings?: [number, number, number, number][];
  /** Stroke width. */
  width?: number;
  /** Strokes and dots knocked out of a filled shape, drawn in the colour on a fill. */
  inner?: string[];
  innerDots?: [number, number, number][];
  innerWidth?: number;
}

export const ICONS = {
  operate: {
    stroke: ['M15.11 8.89A4.4 4.4 0 0 1 15.11 15.11M8.89 8.89A4.4 4.4 0 0 0 8.89 15.11M17.62 5.76A8.4 8.4 0 0 1 17.62 18.24M6.38 5.76A8.4 8.4 0 0 0 6.38 18.24'],
    dots: [[12, 12, 1.9]],
    width: 1.75,
  },
  log: {
    stroke: ['M7.5 3.25H16.5A3 3 0 0 1 19.5 6.25V17.75A3 3 0 0 1 16.5 20.75H7.5A3 3 0 0 1 4.5 17.75V6.25A3 3 0 0 1 7.5 3.25Z', 'M10.6 8.5H16M10.6 12H16M10.6 15.5H16'],
    dots: [
      [7.9, 8.5, 1.05],
      [7.9, 12, 1.05],
      [7.9, 15.5, 1.05],
    ],
    width: 1.75,
  },
  spots: { stroke: ['M3.2 12H20.8'], rings: [[12, 12, 9, 9], [12, 12, 3.9, 9]], width: 1.75 },
  settings: { stroke: [gearPath()], rings: [[12, 12, 3.1, 3.1]], width: 1.75 },
  chevdown: { stroke: ['M6.5 9.5L12 15L17.5 9.5'], width: 2.4 },
  chevright: { stroke: ['M9 5L16 12L9 19'], width: 2.3 },
  chevup: { stroke: ['M6.5 14.5L12 9L17.5 14.5'], width: 2.4 },
  // A choice from a menu: chevrons up and down, as iOS's pop-up buttons.
  updown: { stroke: ['M7.5 9.5L12 5L16.5 9.5M7.5 14.5L12 19L16.5 14.5'], width: 2.4 },
  // Reorder handle: three lines, as in iOS table views.
  grip: { stroke: ['M4.5 8H19.5M4.5 12H19.5M4.5 16H19.5'], width: 1.8 },
  back: { stroke: ['M15.5 3.5L7 12L15.5 20.5'], width: 2.6 },
  // Back to the default value: an arrow going round anticlockwise, its open head at 12 o'clock.
  reset: { stroke: ['M6.02 8.81A7.3 7.3 0 1 0 12 5.7', 'M15.54 2.16L12 5.7L15.54 9.24'], width: 2.5 },
  // Bar glyphs share one stroke weight and an 18-unit-wide ink box centred on 12, as SF Symbols do.
  share: { stroke: ['M12 14.5V3.6M8.2 7.2L12 3.4L15.8 7.2M8.4 10.3H6.1A2.2 2.2 0 0 0 3.9 12.5V18.8A2.2 2.2 0 0 0 6.1 21H17.9A2.2 2.2 0 0 0 20.1 18.8V12.5A2.2 2.2 0 0 0 17.9 10.3H15.6'], width: 1.8 },
  // Log, activations and destinations.
  search: { stroke: ['M15.4 15.4L20.2 20.2'], rings: [[10.6, 10.6, 6.4, 6.4]], width: 2.1 },
  plus: { stroke: ['M12 3.9V20.1M3.9 12H20.1'], width: 1.8 },
  checkcircle: { dots: [[12, 12, 10]], inner: ['M7.4 12.4L10.6 15.5L16.7 9'], innerWidth: 2.3 },
  warncircle: { fill: ['M10.3 3.6a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3Z'], inner: ['M12 9.2V13.4'], innerDots: [[12, 16.8, 1.25]], innerWidth: 2.2 },
  cloudoff: { stroke: ['M21.2 16.4A4.4 4.4 0 0 0 17.6 9.6H16.5A7 7 0 0 0 9.9 4.4M5.6 6.9A7 7 0 0 0 8.7 19.6H17.4A4.6 4.6 0 0 0 18.8 19.4', 'M3 3L21 21'], width: 1.9 },
  tree: { stroke: ['M12 3.2L7.2 9.8H9.6L5.8 15.4H18.2L14.4 9.8H16.8Z', 'M12 15.4V20.6'], width: 1.9 },
  mountain: { stroke: ['M2.8 19.4L9.2 8.6L12.9 14.4L15.3 11L21.2 19.4Z'], width: 1.9 },
  locate: { stroke: ['M12 2.5V5.5M12 18.5V21.5M2.5 12H5.5M18.5 12H21.5'], rings: [[12, 12, 6.5, 6.5]], dots: [[12, 12, 2]], width: 1.8 },
  xmark: { stroke: ['M7.5 7.5L16.5 16.5M16.5 7.5L7.5 16.5'], width: 2.4 },
  check: { stroke: ['M5 12.6L9.8 17.2L19 7.4'], width: 2.6 },
  alert: { stroke: ['M10.3 3.9a2 2 0 0 1 3.4 0l7.8 13.6a2 2 0 0 1-1.7 3H4.2a2 2 0 0 1-1.7-3Z', 'M12 9.3V13.4'], dots: [[12, 16.7, 1.15]], width: 1.9 },
  mic: { stroke: ['M12 3A3 3 0 0 1 15 6V11A3 3 0 0 1 9 11V6A3 3 0 0 1 12 3Z', 'M5.8 11a6.2 6.2 0 0 0 12.4 0M12 17.2V20.6'], width: 1.7 },
  doc: { stroke: ['M7 3.2H13.4L17.6 7.4V20.8H7Z', 'M13.4 3.2V7.4H17.6'], width: 1.9 },
  // Save slot: the share glyph's tray with the arrow pointing in.
  save: { stroke: ['M12 3.4V14.3M9 11.3L12 14.3L15 11.3M8.4 10.3H6.1A2.2 2.2 0 0 0 3.9 12.5V18.8A2.2 2.2 0 0 0 6.1 21H17.9A2.2 2.2 0 0 0 20.1 18.8V12.5A2.2 2.2 0 0 0 17.9 10.3H15.6'], width: 1.8 },
  // The ••• menu: three dots on the bar glyphs' 18-unit ink box.
  more: { dots: [[4.6, 12, 1.9], [12, 12, 1.9], [19.4, 12, 1.9]] },
  globe: { stroke: ['M3.6 12H20.4M5 7.6H19M5 16.4H19'], rings: [[12, 12, 8.6, 8.6], [12, 12, 3.6, 8.6]], width: 1.6 },
  // Glyphs on the coloured tiles of the Settings sections (regular width), from the large-screens mockup.
  person: { stroke: ['M5.5 19c1.2-3.3 3.6-5 6.5-5s5.3 1.7 6.5 5'], rings: [[12, 9, 3.5, 3.5]], width: 2.2 },
  wave: { stroke: ['M3 12h3l2.2-6 3.4 12 3.2-9 2 3H21'], width: 2.2 },
  book: { stroke: ['M6 4h10a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3zM9.5 8.5h6'], width: 2.2 },
  play: { stroke: ['M8.5 6l9 6-9 6z'], width: 2.2 },
  addbox: { stroke: ['M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM12 8.5v7M8.5 12h7'], width: 2.2 },
  colours: { stroke: ['M12 4.5v15'], rings: [[12, 12, 7.5, 7.5]], width: 2.2 },
  sun: { stroke: ['M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4'], rings: [[12, 12, 3.5, 3.5]], width: 2.2 },
  info: { stroke: ['M12 11v5.5M12 7.8v.01'], rings: [[12, 12, 8.5, 8.5]], width: 2.2 },
  antenna: { stroke: ['M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2'], dots: [[12, 12, 1.8]], width: 2.2 },
  headphones: { stroke: ['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15a2 2 0 0 1 2-2h1.5v7H6a2 2 0 0 1-2-2z', 'M20 15a2 2 0 0 0-2-2h-1.5v7H18a2 2 0 0 0 2-2z'], width: 2.2 },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;
