import type { WaterfallPalette } from './colormap';
import type { FrameInfo, TxWave } from './renderer';
import type { Mode } from '../clock/slots';
import type { Contrast } from './levels';

export type ToWaterfall =
  | { type: 'init'; canvas: OffscreenCanvas; palette: WaterfallPalette; mode: Mode; width: number; height: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'samples'; samples: Float32Array; utcMs: number; index: number }
  | { type: 'mode'; mode: Mode }
  | { type: 'span'; seconds: number | null }
  | { type: 'contrast'; contrast: Contrast }
  | { type: 'palette'; palette: WaterfallPalette }
  | { type: 'txSlots'; starts: number[] }
  | { type: 'txWave'; wave: TxWave }
  | { type: 'clear' }
  | { type: 'quietest'; id: number; nowMs: number; nearHz: number };

export type FromWaterfall = { type: 'frame'; info: FrameInfo } | { type: 'failed'; reason: string } | { type: 'quietest'; id: number; hz: number | null };
