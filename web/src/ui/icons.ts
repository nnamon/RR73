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
  activate: { stroke: ['M2.6 20.2L9.4 9.2L13.3 15.3L15.6 12L21.4 20.2Z', 'M9.4 9.2V3.6L13.4 5.1L9.4 6.6'], width: 1.75 },
  spots: { stroke: ['M3.2 12H20.8'], rings: [[12, 12, 9, 9], [12, 12, 3.9, 9]], width: 1.75 },
  settings: { stroke: [gearPath()], rings: [[12, 12, 3.1, 3.1]], width: 1.75 },
  chevdown: { stroke: ['M6.5 9.5L12 15L17.5 9.5'], width: 2.4 },
  chevright: { stroke: ['M9 5L16 12L9 19'], width: 2.3 },
  back: { stroke: ['M15.5 3.5L7 12L15.5 20.5'], width: 2.6 },
  share: { stroke: ['M12 14.5V3.6M8.2 7.2L12 3.4L15.8 7.2M8.6 10.3H7.2A2.2 2.2 0 0 0 5 12.5V18.8A2.2 2.2 0 0 0 7.2 21H16.8A2.2 2.2 0 0 0 19 18.8V12.5A2.2 2.2 0 0 0 16.8 10.3H15.4'], width: 1.8 },
  // Log, activations and destinations.
  search: { stroke: ['M15.4 15.4L20.2 20.2'], rings: [[10.6, 10.6, 6.4, 6.4]], width: 2.1 },
  plus: { stroke: ['M12 5V19M5 12H19'], width: 2.2 },
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
  globe: { stroke: ['M3.6 12H20.4M5 7.6H19M5 16.4H19'], rings: [[12, 12, 8.6, 8.6], [12, 12, 3.6, 8.6]], width: 1.6 },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;
