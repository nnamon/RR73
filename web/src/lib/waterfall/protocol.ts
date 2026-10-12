import type { WaterfallPalette } from './colormap';
import type { FrameInfo } from './renderer';
import type { Mode } from '../clock/slots';

export type ToWaterfall =
  | { type: 'init'; canvas: OffscreenCanvas; palette: WaterfallPalette; mode: Mode; width: number; height: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'samples'; samples: Float32Array; utcMs: number; index: number }
  | { type: 'mode'; mode: Mode }
  | { type: 'clear' };

export type FromWaterfall = { type: 'frame'; info: FrameInfo } | { type: 'failed'; reason: string };
