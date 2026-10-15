// Waterfall worker: computes the display spectrum and draws on the OffscreenCanvas it was given,
// so scrolling never waits for the main thread.

import { WaterfallRenderer, type Context2D } from './renderer';
import type { FromWaterfall, ToWaterfall } from './protocol';

const scope = self as unknown as {
  postMessage(m: FromWaterfall): void;
  onmessage: ((e: MessageEvent<ToWaterfall>) => void) | null;
};

let renderer: WaterfallRenderer | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const ctx = m.canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      scope.postMessage({ type: 'failed', reason: 'no-2d-context' });
      return;
    }
    renderer = new WaterfallRenderer(ctx as unknown as Context2D, m.palette, m.mode, m.width, m.height);
    scope.postMessage({ type: 'frame', info: renderer.info() });
    return;
  }
  if (m.type === 'quietest') {
    scope.postMessage({ type: 'quietest', id: m.id, hz: renderer?.quietest(m.nowMs, m.nearHz) ?? null });
    return;
  }
  if (!renderer) return;
  if (m.type === 'samples') {
    const info = renderer.push(m.samples, m.utcMs, m.index);
    if (info) scope.postMessage({ type: 'frame', info });
    return;
  }
  if (m.type === 'resize') renderer.resize(m.width, m.height);
  else if (m.type === 'mode') renderer.setMode(m.mode);
  else if (m.type === 'span') renderer.setSpan(m.seconds);
  else if (m.type === 'clear') renderer.clear();
  else if (m.type === 'contrast') renderer.setContrast(m.contrast);
  else if (m.type === 'palette') renderer.setPalette(m.palette);
  else if (m.type === 'txSlots') renderer.setTxSlots(m.starts);
  else if (m.type === 'txWave') renderer.setTxWave(m.wave);
  scope.postMessage({ type: 'frame', info: renderer.info() });
};
