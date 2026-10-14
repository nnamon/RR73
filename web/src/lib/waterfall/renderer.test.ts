import { describe, expect, it } from 'vitest';
import { WaterfallRenderer, columns, VISIBLE_S, type Context2D } from './renderer';
import type { WaterfallPalette } from './colormap';
import { DISPLAY_BINS } from './spectrum';
import { prng } from '../testing/signal';

const MOCKUP_STOPS: WaterfallPalette['stops'] = [
  [4, 6, 10],
  [10, 21, 48],
  [18, 62, 110],
  [26, 127, 154],
  [76, 195, 163],
  [240, 210, 90],
  [255, 248, 230],
];
const PALETTE: WaterfallPalette = { stops: MOCKUP_STOPS, background: [4, 6, 10], line: [255, 255, 255, 0.18] };

/** A 2D context over a plain RGBA buffer, enough for the renderer. */
class FakeContext {
  canvas = { width: 0, height: 0 };
  fillStyle: unknown = '';
  pixels = new Uint8ClampedArray(0);

  private sync() {
    const need = this.canvas.width * this.canvas.height * 4;
    if (this.pixels.length !== need) this.pixels = new Uint8ClampedArray(need);
  }
  createImageData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
  putImageData(img: ImageData, dx: number, dy: number) {
    this.sync();
    for (let y = 0; y < img.height; y++) this.pixels.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((dy + y) * this.canvas.width + dx) * 4);
  }
  drawImage(_src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) {
    this.sync();
    const w = this.canvas.width;
    const copy = this.pixels.slice((sy * w + sx) * 4, ((sy + sh) * w + sx) * 4);
    for (let y = 0; y < sh; y++) this.pixels.set(copy.subarray(y * sw * 4, (y + 1) * sw * 4), ((dy + y) * w + dx) * 4);
  }
  fillRect() {}
  pixel(x: number, y: number): number[] {
    const o = (y * this.canvas.width + x) * 4;
    return Array.from(this.pixels.slice(o, o + 4));
  }
}

const bright = (p: number[]) => p[0] + p[1] + p[2];

/** Noise plus tones of amplitude 0.05 at `tones` Hz, 12 kHz, `seconds` long. */
function signal(seconds: number, tones: number[], seed = 1, noise = 0.02): Float32Array {
  const r = prng(seed);
  const n = Math.round(seconds * 12000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = (r() - 0.5) * noise;
    for (const f of tones) v += 0.05 * Math.sin((2 * Math.PI * f * i) / 12000);
    out[i] = v;
  }
  return out;
}

/** Feeds x in 512-sample chunks; `index0` continues the running index of an earlier feed. */
function feed(r: WaterfallRenderer, x: Float32Array, utc0: number, index0 = 0, jitterMs = 0) {
  let info = null;
  const rand = prng(77);
  for (let i = 0; i < x.length; i += 512) info = r.push(x.subarray(i, i + 512), utc0 + (i / 12000) * 1000 + (rand() - 0.5) * 2 * jitterMs, index0 + i) ?? info;
  return info;
}

/** Brightest row (mean over the width) between rows y0 and y1. */
function brightestRow(ctx: FakeContext, y0: number, y1: number): number {
  let best = 0;
  for (let y = y0; y < y1; y++) {
    let sum = 0;
    for (let x = 0; x < ctx.canvas.width; x++) sum += bright(ctx.pixel(x, y));
    best = Math.max(best, sum / ctx.canvas.width);
  }
  return best;
}

describe('columns', () => {
  it('interpolates when a pixel is narrower than a bin and takes the peak when wider', () => {
    const wide = columns(1125);
    expect(wide.every((c) => !c.peak)).toBe(true);
    const narrow = columns(200);
    expect(narrow.every((c) => c.peak && c.i1 >= c.i0)).toBe(true);
    expect(narrow[narrow.length - 1].i1).toBeLessThan(DISPLAY_BINS);
  });
});

describe('WaterfallRenderer', () => {
  const T0 = Date.UTC(2026, 9, 13, 13, 14, 50);

  it('scrolls 45 s through the canvas height', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 540);
    expect(ctx.canvas).toEqual({ width: 300, height: 540 });
    expect((r.rowMs * 540) / 1000).toBeCloseTo(VISIBLE_S, 0);
  });

  it('scrolls four slots through the height in regular width, and back to 45 s', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 1440, 870);
    r.setSpan(60);
    expect((r.rowMs * 870) / 1000).toBeCloseTo(60, 0);
    r.setSpan(null);
    expect((r.rowMs * 870) / 1000).toBeCloseTo(VISIBLE_S, 0);
  });

  it('shows tones as bright columns at their frequencies', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 600, 200);
    feed(r, signal(8, [700, 1900]), T0);
    const y = 10;
    const at = (hz: number) => bright(ctx.pixel(Math.floor((hz / 3000) * 600), y));
    expect(at(700)).toBeGreaterThan(3 * at(1300));
    expect(at(1900)).toBeGreaterThan(3 * at(2500));
  });

  it('puts the newest row at the top', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    feed(r, signal(4, [1000]), T0);
    feed(r, signal(2, [2000], 2), T0 + 4000, 48000);
    const x1000 = Math.floor((1000 / 3000) * 300);
    const x2000 = Math.floor((2000 / 3000) * 300);
    expect(bright(ctx.pixel(x2000, 2))).toBeGreaterThan(bright(ctx.pixel(x1000, 2)));
    const info = r.info();
    const rowsFor2s = Math.round(2000 / info.rowMs);
    expect(bright(ctx.pixel(x1000, rowsFor2s + 6))).toBeGreaterThan(bright(ctx.pixel(x2000, rowsFor2s + 6)));
  });

  it('reports the slot boundaries on screen with their rows', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    const info = feed(r, signal(30, []), T0)!;
    // From 13:14:50 for 30 s: boundaries at 13:15:00 and 13:15:15.
    expect(info.boundaries.map((b) => b.utcMs)).toEqual([Date.UTC(2026, 9, 13, 13, 15, 15), Date.UTC(2026, 9, 13, 13, 15, 0)]);
    const [b15, b00] = info.boundaries;
    expect(b00.y - b15.y).toBeCloseTo(15000 / info.rowMs, -0.5);
    expect(b15.y).toBeCloseTo((info.newestUtcMs - b15.utcMs) / info.rowMs, -0.5);
    // The hairline brightens its row.
    const x = 150;
    expect(bright(ctx.pixel(x, b00.y))).toBeGreaterThan(bright(ctx.pixel(x, b00.y + 3)));
  });

  it('draws missing audio as blank rows that keep the time scale', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    feed(r, signal(5, [1500]), T0);
    // The index continues, but 6 s of time went by: the audio stopped and resumed.
    const info = feed(r, signal(2, [1500]), T0 + 5000 + 6000, 60000)!;
    const rows2s = Math.round(2000 / info.rowMs);
    const x = 150;
    const gapY = rows2s + Math.round(3000 / info.rowMs);
    expect(ctx.pixel(x, gapY).slice(0, 3)).toEqual([4, 6, 10]);
    expect(bright(ctx.pixel(x, 3))).toBeGreaterThan(bright([4, 6, 10]));
  });

  it('ignores jitter in chunk times: no gaps and no streaks', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    const info = feed(r, signal(20, [700, 1300, 1900, 2600], 1, 0.001), T0, 0, 60)!;
    const rows = Math.round(20000 / info.rowMs);
    // Away from the slot line, no row is much brighter than the noise rows around it.
    const lineY = info.boundaries[0].y;
    const noise = brightestRow(ctx, lineY + 4, Math.min(rows - 4, lineY + 30));
    expect(brightestRow(ctx, 2, lineY - 2)).toBeLessThan(noise * 1.3);
    // No blank rows: jitter is not a gap.
    for (let y = 2; y < rows - 4; y++) expect(brightestRow(ctx, y, y + 1), `row ${y}`).toBeGreaterThan(2 * bright([4, 6, 10]));
  });

  it('starts drawing only once a full frame of audio is in, so the first row has no streak', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    // Strong tones over faint noise: a frame that starts in silence spreads them over every bin.
    const info = feed(r, signal(3, [700, 1300, 1900, 2600], 1, 0.001), T0)!;
    const rows = Math.round(3000 / info.rowMs);
    // The oldest row, at the bottom, is the first one drawn.
    const all = brightestRow(ctx, 0, rows + 2);
    const typical = brightestRow(ctx, Math.floor(rows / 2) - 2, Math.floor(rows / 2) + 2);
    expect(all).toBeLessThan(typical * 1.3);
  });

  it('treats digital silence at the start of a stream as no audio, so tones arriving after it leave no streak', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    const x = new Float32Array(4 * 12000);
    x.set(signal(3.5, [700, 1300, 1900, 2600], 1, 0.001), 6000);
    const info = feed(r, x, T0)!;
    const rows = Math.round(4000 / info.rowMs);
    expect(brightestRow(ctx, 0, rows + 2)).toBeLessThan(brightestRow(ctx, 2, 6) * 1.3);
  });

  it('keeps scrolling through digital silence with blank rows', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    const info = feed(r, new Float32Array(12 * 12000), T0)!;
    expect(info.newestUtcMs).toBeGreaterThan(T0 + 11500);
    expect(info.boundaries.map((b) => b.utcMs)).toEqual([Date.UTC(2026, 9, 13, 13, 15, 0)]);
    expect(ctx.pixel(150, 3).slice(0, 3)).toEqual([4, 6, 10]);
  });

  it('starts a fresh frame after a break without a streak', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    feed(r, signal(4, [700, 1300, 1900, 2600], 1, 0.001), T0);
    const info = feed(r, signal(4, [700, 1300, 1900, 2600], 3, 0.001), T0 + 4000 + 2000, 0)!; // a new capture: the index restarts
    const rows = Math.round(4000 / info.rowMs);
    // The first row after the break sits just above the blank rows.
    expect(brightestRow(ctx, 0, rows + 2)).toBeLessThan(brightestRow(ctx, 2, 6) * 1.3);
  });

  it('keeps its history through a resize', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 400);
    feed(r, signal(20, [1500]), T0);
    r.resize(600, 300);
    expect(ctx.canvas).toEqual({ width: 600, height: 300 });
    expect(bright(ctx.pixel(300, 20))).toBeGreaterThan(bright(ctx.pixel(450, 20)) * 2);
    expect(r.info().boundaries.map((b) => b.utcMs)).toEqual([Date.UTC(2026, 9, 13, 13, 15, 0)]);
  });

  it('clears the picture', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 100, 100);
    feed(r, signal(5, [1500]), T0);
    r.clear();
    expect(ctx.pixel(50, 5).slice(0, 3)).toEqual([4, 6, 10]);
    expect(r.info().boundaries).toEqual([]);
  });
});

describe('WaterfallRenderer in transmitted slots', () => {
  const T0 = Date.UTC(2026, 9, 13, 13, 14, 50);
  const SLOT = Date.UTC(2026, 9, 13, 13, 15, 0);
  const background = [...PALETTE.background, 255];

  it('draws the slots RR73 transmitted in blank until their transmission is known, rows drawn before included', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    const x = Math.floor((1000 / 3000) * 300);
    // 13:14:50 to 13:15:04 with a tone throughout; the transmission in 13:15:00 becomes known after.
    feed(r, signal(14, [1000]), T0);
    expect(bright(ctx.pixel(x, 2))).toBeGreaterThan(bright(background));
    r.setTxSlots([SLOT]);
    const rows = (s: number) => Math.round((s * 1000) / r.rowMs);
    // 13:15:03 (1 s before the newest row) is blank; 13:14:57 (7 s before) keeps its tone.
    expect(ctx.pixel(x, rows(1))).toEqual(background);
    expect(bright(ctx.pixel(x, rows(7)))).toBeGreaterThan(3 * bright(background));
    // Rows arriving later in the slot are blank as they are drawn.
    feed(r, signal(4, [1000], 3), T0 + 14_000, 14 * 12000);
    expect(ctx.pixel(x, 2)).toEqual(background);
    expect(ctx.pixel(x, rows(5))).toEqual(background);
  });

  it('draws the transmitted audio in its slot, before and after it arrives, and cuts it at Halt', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    const rx = Math.floor((1000 / 3000) * 300);
    const txX = Math.floor((1500 / 3000) * 300);
    const rows = (s: number) => Math.round((s * 1000) / r.rowMs);
    r.setTxSlots([SLOT]);
    // The receive audio carries a tone at 1000 Hz; the transmission is a tone at 1500 Hz from 13:15:00.5.
    feed(r, signal(14, [1000]), T0);
    expect(ctx.pixel(txX, rows(1))).toEqual(background);
    const start = SLOT + 500;
    const tone = signal(12.64, [1500], 7, 0);
    r.setTxWave({ startUtcMs: start, endUtcMs: start + 12_640, samples: tone });
    // 13:15:03: the transmitted tone, over a floor brighter than the background; the received 1000 Hz tone is gone.
    const on = bright(ctx.pixel(txX, rows(1)));
    const floor = bright(ctx.pixel(rx, rows(1)));
    expect(floor).toBeGreaterThan(bright(background));
    expect(on).toBeGreaterThan(2 * floor);
    // Before the slot, the received tone shows as usual.
    expect(bright(ctx.pixel(rx, rows(7)))).toBeGreaterThan(3 * bright(background));
    // Rows drawn later in the transmission show it as they arrive.
    feed(r, signal(4, [1000], 3), T0 + 14_000, 14 * 12000);
    expect(bright(ctx.pixel(txX, 2))).toBeGreaterThan(2 * floor);
    // Halt at 13:15:06: rows after it show what the radio receives again, the 1000 Hz tone; rows
    // before keep the transmitted tone. They were blank until the slot ended, 2 min in WSPR.
    r.setTxWave({ startUtcMs: start, endUtcMs: SLOT + 6000, samples: tone });
    expect(bright(ctx.pixel(rx, 2))).toBeGreaterThan(3 * bright(background));
    expect(bright(ctx.pixel(txX, 2))).toBeLessThan(on / 2);
    expect(bright(ctx.pixel(txX, rows(4)))).toBeGreaterThan(2 * floor);
    // Rows arriving after Halt show the received audio as they are drawn.
    feed(r, signal(2, [1000], 4), T0 + 18_000, 18 * 12000);
    expect(bright(ctx.pixel(rx, 2))).toBeGreaterThan(3 * bright(background));
  });

  it('draws the received audio before a transmission that starts late in its slot', () => {
    const ctx = new FakeContext();
    const r = new WaterfallRenderer(ctx as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    const rx = Math.floor((1000 / 3000) * 300);
    const rows = (s: number) => Math.round((s * 1000) / r.rowMs);
    // A call answered 3 s late: the transmission runs from 13:15:03.
    feed(r, signal(14, [1000]), T0);
    r.setTxSlots([SLOT]);
    expect(ctx.pixel(rx, rows(2.5))).toEqual(background);
    const start = SLOT + 3000;
    r.setTxWave({ startUtcMs: start, endUtcMs: start + 9_640, samples: signal(9.64, [1500], 7, 0) });
    // 13:15:01.5 is before the transmission: the received tone. 13:15:03.5 is in it: no received tone.
    expect(bright(ctx.pixel(rx, rows(2.5)))).toBeGreaterThan(3 * bright(background));
    expect(bright(ctx.pixel(rx, rows(0.5)))).toBeLessThan(2 * bright(ctx.pixel(rx, rows(2.5))) / 3);
  });

  it('keeps its noise level through a transmission: the radio’s own signal does not raise it', () => {
    const quiet = new FakeContext();
    const a = new WaterfallRenderer(quiet as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    const loud = new FakeContext();
    const b = new WaterfallRenderer(loud as unknown as Context2D, PALETTE, 'FT8', 300, 200);
    const x = Math.floor((1000 / 3000) * 300);
    b.setTxSlots([SLOT]);
    b.setTxWave({ startUtcMs: SLOT + 500, endUtcMs: SLOT + 6000, samples: signal(5.5, [1500], 7, 0) });
    // The same receive audio, except that in b the transmission from 13:15:00.5 to 13:15:06 comes
    // back 26 dB stronger, as the radio's own signal does.
    feed(a, signal(10, [1000]), T0);
    feed(b, signal(10, [1000]), T0);
    const own = signal(6, [1000, 1500, 2000], 2);
    for (let i = 0; i < own.length; i++) own[i] *= 20;
    feed(a, signal(6, [1000], 2), T0 + 10_000, 10 * 12000);
    feed(b, own, T0 + 10_000, 10 * 12000);
    feed(a, signal(4, [1000], 3), T0 + 16_000, 16 * 12000);
    feed(b, signal(4, [1000], 3), T0 + 16_000, 16 * 12000);
    // 13:15:09.5, 3.5 s after the transmission: both draw the received tone and the noise alike, within a level tracker still settling.
    for (const px of [x, Math.floor((2500 / 3000) * 300)]) {
      const want = bright(quiet.pixel(px, 2));
      expect(Math.abs(bright(loud.pixel(px, 2)) - want)).toBeLessThan(0.25 * want);
    }
  });
});
