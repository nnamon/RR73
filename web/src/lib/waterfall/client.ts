/**
 * Main-thread side of the waterfall. Hands the canvas to the waterfall worker as an
 * OffscreenCanvas where the browser supports it (Safari 16.4 and later), and otherwise draws on
 * the main thread with the same renderer.
 */

import type { WaterfallPalette } from './colormap';
import type { FromWaterfall, ToWaterfall } from './protocol';
import { WaterfallRenderer, type Context2D, type FrameInfo } from './renderer';
import type { Mode } from '../clock/slots';

export class WaterfallClient {
  /** True when the worker draws; false on the main-thread fallback. */
  readonly offscreen: boolean;
  private worker: Worker | null = null;
  private local: WaterfallRenderer | null = null;
  private readonly onFrame: (info: FrameInfo) => void;

  constructor(canvas: HTMLCanvasElement, palette: WaterfallPalette, mode: Mode, width: number, height: number, onFrame: (info: FrameInfo) => void) {
    this.onFrame = onFrame;
    const canTransfer = typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (canTransfer) {
      const offscreen = canvas.transferControlToOffscreen();
      this.worker = new Worker(new URL('./waterfall.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FromWaterfall>) => {
        if (e.data.type === 'frame') this.onFrame(e.data.info);
      };
      this.send({ type: 'init', canvas: offscreen, palette, mode, width, height }, [offscreen]);
      this.offscreen = true;
    } else {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('No 2D canvas context.');
      this.local = new WaterfallRenderer(ctx as unknown as Context2D, palette, mode, width, height);
      this.offscreen = false;
      onFrame(this.local.info());
    }
  }

  /** Adds 12 kHz samples: `index` is the running index of samples[0], `utcMs` its time. The array is copied. */
  push(samples: Float32Array, utcMs: number, index: number) {
    if (this.worker) {
      const copy = samples.slice();
      this.send({ type: 'samples', samples: copy, utcMs, index }, [copy.buffer]);
    } else if (this.local) {
      const info = this.local.push(samples, utcMs, index);
      if (info) this.onFrame(info);
    }
  }

  resize(width: number, height: number) {
    if (this.worker) this.send({ type: 'resize', width, height });
    else if (this.local) {
      this.local.resize(width, height);
      this.onFrame(this.local.info());
    }
  }

  setMode(mode: Mode) {
    if (this.worker) this.send({ type: 'mode', mode });
    else if (this.local) {
      this.local.setMode(mode);
      this.onFrame(this.local.info());
    }
  }

  clear() {
    if (this.worker) this.send({ type: 'clear' });
    else if (this.local) {
      this.local.clear();
      this.onFrame(this.local.info());
    }
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.local = null;
  }

  private send(m: ToWaterfall, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }
}
