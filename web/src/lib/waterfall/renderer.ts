/**
 * Draws the waterfall: newest time at the top, the mode's view across (spectrum.ts: 0 to 3000 Hz
 * for FT8 and FT4, 1400 to 1600 Hz for WSPR), one device pixel per row.
 * Runs in the waterfall worker on an OffscreenCanvas, or on the main thread where
 * OffscreenCanvas is missing; both use this class.
 *
 * The visible height covers the view's span (45 s, three FT8 slots; 240 s, two WSPR slots; four
 * FT8 slots in regular width, setSpan), so
 * the row period follows the canvas height. A change between views starts the picture afresh. A slot boundary paints a hairline into the row that contains it. When audio stops and
 * resumes, the missing time is drawn as blank rows, so the slot lines stay at their UTC times.
 * In the slots RR73 transmitted in, the receive audio is the radio's own transmission, so those
 * rows show the transmitted audio instead (setTxWave), as a strong signal over an even floor.
 * Before the transmission starts and after it ends, or Halt cuts it, the radio receives: those
 * rows show the received audio, which every row keeps. A row in such a slot is blank while the
 * slot's transmission is not known yet.
 */

import { buildLut, type WaterfallPalette } from './colormap';
import { LevelMapper, bandFor, type Contrast } from './levels';
import { DISPLAY_RATE, DisplaySpectrum, FT_VIEW, binHz, binsOf, viewOf, type View } from './spectrum';
import { NOISE_POSITION } from './levels';
import { SLOT_MS, hasSlots, isFt, type Mode } from '../clock/slots';
import { QuietTracker, quietestHz } from './pick';

/** The parts of a 2D context the renderer uses, shared by canvas and OffscreenCanvas. */
export type Context2D = Pick<CanvasRenderingContext2D, 'drawImage' | 'putImageData' | 'createImageData' | 'fillRect'> & {
  fillStyle: unknown;
  canvas: { width: number; height: number };
};

export interface Boundary {
  /** Slot start, UTC ms. */
  utcMs: number;
  /** Rows from the top of the canvas, device pixels. */
  y: number;
}

export interface FrameInfo {
  /** Slot boundaries on screen, newest first. */
  boundaries: Boundary[];
  /** Time of the top row, UTC ms. */
  newestUtcMs: number;
  /** Row period, ms. */
  rowMs: number;
}

/** Visible span of the FT8 and FT4 waterfall, s. */
export const VISIBLE_S = FT_VIEW.visibleS;
/** A jump of more than this between chunks is a gap in the audio, ms. */
const GAP_MS = 150;

/** Transmitted audio drawn on the waterfall. */
export interface TxWave {
  /** UTC of samples[0], ms. */
  startUtcMs: number;
  /** End of the transmission, UTC ms; earlier than the audio's end after Halt. */
  endUtcMs: number;
  /** The transmitted audio at 12 kHz (DISPLAY_RATE). */
  samples: Float32Array;
}

/** Transmissions kept for drawing: the visible 45 s holds at most 4 FT8 or 7 FT4 slots, 240 s 3 WSPR slots. */
const TX_WAVES_KEPT = 8;
/** dB under its peak where a transmitted row reaches the floor colour. */
const TX_RANGE_DB = 30;
/** Levels for the transmitted rows: the floor sits where receive noise does, the tones near the top. */
const TX_FLOOR = Math.round(NOISE_POSITION * 255);
const TX_TOP = 240;

interface Row {
  /** What the row shows. */
  levels: Uint8Array;
  utcMs: number;
  blank: boolean;
  /** The received audio's levels, kept for rows a transmission covers; null without a full frame of audio. */
  rx: Uint8Array | null;
}

/** For each pixel column, the bins it covers. */
interface Column {
  i0: number;
  i1: number;
  frac: number;
  peak: boolean;
}

export function columns(width: number, view: View = FT_VIEW): Column[] {
  const out: Column[] = [];
  const bin = binHz(view);
  const { first, count } = binsOf(view);
  const span = view.maxHz - view.minHz;
  for (let x = 0; x < width; x++) {
    const b0 = (view.minHz + (x * span) / width) / bin - first;
    const b1 = (view.minHz + ((x + 1) * span) / width) / bin - first;
    if (b1 - b0 >= 1) {
      out.push({ i0: Math.floor(b0), i1: Math.min(count - 1, Math.ceil(b1) - 1), frac: 0, peak: true });
    } else {
      const c = (b0 + b1) / 2;
      const i0 = Math.max(0, Math.min(count - 2, Math.floor(c)));
      out.push({ i0, i1: i0 + 1, frac: c - i0, peak: false });
    }
  }
  return out;
}

export class WaterfallRenderer {
  private ctx: Context2D;
  private width = 0;
  private height = 0;
  private mode: Mode;
  private lut: Uint8ClampedArray;
  private palette: WaterfallPalette;
  private cols: Column[] = [];
  private hop = 1000;
  private view: View;
  private spectrum: DisplaySpectrum;
  private mapper: LevelMapper;
  private db: Float32Array<ArrayBuffer>;
  /** The newest view.fft samples. */
  private frame: Float32Array<ArrayBuffer>;
  private sinceRow = 0;
  /** UTC of the sample after the last one received, ms. */
  private expectedUtc: number | null = null;
  /** Sample index and UTC the row times are counted from. */
  private anchor: { index: number; utcMs: number } | null = null;
  private nextIndex = -1;
  /** Samples of real audio in the frame, up to view.fft. */
  private valid = 0;
  /** Exact zeros in a row at the end of the frame. */
  private zeroRun = 0;
  private history: Row[] = [];
  /** Rows drawn so far; a row's distance from the top is rowCount − 1 − its number. */
  private rowCount = 0;
  private marks: { utcMs: number; row: number }[] = [];
  private lastRowUtc: number | null = null;
  private readonly quiet: QuietTracker;
  /** Starts of the slots RR73 transmitted in, UTC ms. */
  private txSlots = new Set<number>();
  private txWaves: TxWave[] = [];
  private txFrame: Float32Array<ArrayBuffer>;
  private txDb: Float32Array<ArrayBuffer>;

  constructor(ctx: Context2D, palette: WaterfallPalette, mode: Mode, width: number, height: number) {
    this.ctx = ctx;
    this.palette = palette;
    this.mode = mode;
    this.quiet = new QuietTracker(isFt(mode) ? mode : 'FT8');
    this.lut = buildLut(palette.stops, palette.positions);
    this.view = viewOf(mode);
    this.spectrum = new DisplaySpectrum(this.view);
    this.mapper = new LevelMapper(12, bandFor(this.view));
    this.db = new Float32Array(this.spectrum.bins);
    this.frame = new Float32Array(this.view.fft);
    this.txFrame = new Float32Array(this.view.fft);
    this.txDb = new Float32Array(this.spectrum.bins);
    this.resize(width, height);
  }

  /** Bins in a row. */
  private get bins(): number {
    return this.spectrum.bins;
  }

  /** Sets up the spectrum, levels and frames for another view, and starts the picture afresh. */
  private useView(view: View) {
    this.view = view;
    this.spectrum = new DisplaySpectrum(view);
    const contrast = this.contrast;
    this.mapper = new LevelMapper(1000 / this.rowMs, bandFor(view));
    this.mapper.setContrast(contrast);
    this.db = new Float32Array(this.spectrum.bins);
    this.frame = new Float32Array(view.fft);
    this.txFrame = new Float32Array(view.fft);
    this.txDb = new Float32Array(this.spectrum.bins);
    this.history = [];
    this.resize(this.width, this.height);
    this.clear();
  }

  /** Row period, ms. */
  get rowMs(): number {
    return (this.hop / DISPLAY_RATE) * 1000;
  }

  setMode(mode: Mode) {
    this.mode = mode;
    if (isFt(mode)) this.quiet.setMode(mode);
    const view = viewOf(mode);
    if (view !== this.view) this.useView(view);
    else this.redraw();
  }

  /** The quietest Tx frequency from the last 2 to 4 slots, nearest `nearHz` among equals, Hz; or null. */
  quietest(nowMs: number, nearHz: number): number | null {
    return isFt(this.mode) ? quietestHz(this.quiet.slots(nowMs), this.mode, nearHz) : null;
  }

  /** The time the picture covers, s; null for the view's own. */
  private spanS: number | null = null;

  /** Sets the time the picture covers, s, or null for the view's own: four FT8 slots in regular width. */
  setSpan(seconds: number | null) {
    if (seconds === this.spanS) return;
    this.spanS = seconds;
    this.resize(this.width, this.height);
  }

  /** Sets the canvas size in device pixels and redraws the history. */
  resize(width: number, height: number) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.ctx.canvas.width = this.width;
    this.ctx.canvas.height = this.height;
    this.cols = columns(this.width, this.view);
    this.hop = Math.max(64, Math.round(((this.spanS ?? this.view.visibleS) * DISPLAY_RATE) / this.height));
    this.mapper.setRate(1000 / this.rowMs);
    this.history = this.history.slice(-this.height);
    this.redraw();
  }

  /** Sets the colormap and redraws the picture in it, rows drawn before included. */
  setPalette(palette: WaterfallPalette) {
    this.palette = palette;
    this.lut = buildLut(palette.stops, palette.positions);
    this.redraw();
  }

  private contrast: Contrast = 'normal';

  /** Sets the contrast of the colormap for the rows drawn from now on. */
  setContrast(c: Contrast) {
    this.contrast = c;
    this.mapper.setContrast(c);
  }

  /**
   * Sets the slots RR73 transmitted in, UTC ms. Their rows show the transmitted audio, or blank
   * where none covers them, including rows drawn before the slot was known.
   */
  setTxSlots(starts: readonly number[]) {
    this.txSlots = new Set(starts);
    this.redrawTx();
  }

  /**
   * Adds or updates a transmission's audio (matched by its start), including rows drawn before
   * it arrived. A Halt sends the same transmission again with an earlier end.
   */
  setTxWave(w: TxWave) {
    this.txWaves = [...this.txWaves.filter((x) => x.startUtcMs !== w.startUtcMs), w].slice(-TX_WAVES_KEPT);
    this.redrawTx();
  }

  /** Redraws the rows in transmitted slots from the transmitted audio. */
  private redrawTx() {
    let changed = false;
    for (const r of this.history) {
      if (!this.inTxSlot(r.utcMs)) continue;
      const shown = this.txRow(r.utcMs, r.rx);
      if (shown.levels !== r.levels || shown.blank !== r.blank) {
        r.levels = shown.levels;
        r.blank = shown.blank;
        changed = true;
      }
    }
    if (changed) this.redraw();
  }

  /**
   * What a row in a transmitted slot shows: the transmitted audio where the transmission covers
   * it; the received audio `rx` before it starts and after it ends or Halt cuts it; blank while
   * the slot's transmission is not known yet, or without received audio.
   */
  private txRow(utcMs: number, rx: Uint8Array | null): { levels: Uint8Array; blank: boolean } {
    const tx = this.txLevels(utcMs);
    if (tx) return { levels: tx, blank: false };
    if (rx && this.txKnown(utcMs)) return { levels: rx, blank: false };
    return { levels: this.blankLevels(), blank: true };
  }

  /** True when the transmission of the slot holding `utcMs` is known, so its start and end are. */
  private txKnown(utcMs: number): boolean {
    if (!hasSlots(this.mode)) return false;
    const slot = SLOT_MS[this.mode];
    const s = Math.floor(utcMs / slot);
    return this.txWaves.some((w) => Math.floor(w.startUtcMs / slot) === s);
  }

  private blankLevels(): Uint8Array {
    return new Uint8Array(this.bins);
  }

  /**
   * Levels for a row centred at `utcMs` from the transmitted audio, or null where no transmission
   * covers it. Each row is levelled against its own peak: RR73 does not know the radio's power.
   */
  private txLevels(utcMs: number): Uint8Array | null {
    const w = this.txWaves.find((x) => utcMs >= x.startUtcMs && utcMs < x.endUtcMs);
    if (!w) return null;
    const fft = this.view.fft;
    const centre = Math.round(((utcMs - w.startUtcMs) / 1000) * DISPLAY_RATE);
    const end = Math.round(((w.endUtcMs - w.startUtcMs) / 1000) * DISPLAY_RATE);
    for (let i = 0, j = centre - fft / 2; i < fft; i++, j++) this.txFrame[i] = j >= 0 && j < end && j < w.samples.length ? w.samples[j] : 0;
    this.spectrum.compute(this.txFrame, this.txDb);
    let peak = -Infinity;
    for (const v of this.txDb) if (v > peak) peak = v;
    const out = new Uint8Array(this.bins);
    if (!Number.isFinite(peak)) return out.fill(TX_FLOOR);
    for (let k = 0; k < this.bins; k++) {
      const p = Math.min(1, Math.max(0, (this.txDb[k] - (peak - TX_RANGE_DB)) / TX_RANGE_DB));
      out[k] = Math.round(TX_FLOOR + p * (TX_TOP - TX_FLOOR));
    }
    return out;
  }

  private inTxSlot(utcMs: number): boolean {
    if (!this.txSlots.size || !hasSlots(this.mode)) return false;
    const slot = SLOT_MS[this.mode];
    return this.txSlots.has(Math.floor(utcMs / slot) * slot);
  }

  /** Clears the picture and the history. */
  clear() {
    this.history = [];
    this.marks = [];
    this.rowCount = 0;
    this.lastRowUtc = null;
    this.expectedUtc = null;
    this.anchor = null;
    this.nextIndex = -1;
    this.quiet.reset();
    this.frame.fill(0);
    this.valid = 0;
    this.sinceRow = 0;
    this.mapper.reset();
    this.redraw();
  }

  /**
   * Adds 12 kHz samples: `index` is the running sample index of samples[0] and `utcMs` its UTC
   * time. Row times follow the sample count from an anchor, so jitter in chunk times never moves
   * rows; a break in the index or a jump of more than 150 ms starts a new anchor, drawing the
   * missing time as blank rows. Returns frame info when rows were drawn.
   */
  push(samples: Float32Array, utcMs: number, index: number): FrameInfo | null {
    const rows: Row[] = [];
    let t0 = utcMs;
    if (this.anchor && index === this.nextIndex) {
      const predicted = this.anchor.utcMs + ((index - this.anchor.index) / DISPLAY_RATE) * 1000;
      if (Math.abs(utcMs - predicted) <= GAP_MS) t0 = predicted;
      else this.anchor = null;
    } else this.anchor = null;
    if (!this.anchor) {
      const jump = this.expectedUtc === null ? 0 : utcMs - this.expectedUtc;
      if (jump > GAP_MS) {
        const count = Math.min(this.height, Math.floor(jump / this.rowMs));
        const from = this.lastRowUtc ?? utcMs - jump;
        for (let i = 1; i <= count; i++) rows.push({ levels: new Uint8Array(this.bins), utcMs: from + i * this.rowMs, blank: true, rx: null });
      }
      if (this.expectedUtc !== null && Math.abs(jump) > GAP_MS) {
        // The frame holds audio from before the break; a row across it would smear.
        this.frame.fill(0);
        this.valid = 0;
        this.zeroRun = 0;
        this.sinceRow = 0;
      }
      this.anchor = { index, utcMs };
    }
    this.nextIndex = index + samples.length;
    this.expectedUtc = t0 + (samples.length / DISPLAY_RATE) * 1000;
    const fft = this.view.fft;
    let at = 0;
    while (at < samples.length) {
      const n = Math.min(samples.length - at, this.hop - this.sinceRow, fft);
      this.frame.copyWithin(0, n);
      this.frame.set(samples.subarray(at, at + n), fft - n);
      this.countValid(samples, at, n);
      at += n;
      this.sinceRow += n;
      if (this.sinceRow >= this.hop) {
        this.sinceRow = 0;
        // The row shows the window's centre.
        const t = t0 + ((at - fft / 2) / DISPLAY_RATE) * 1000;
        // Only full frames of audio get a spectrum: a window that starts in silence splatters
        // across every bin. Until then the row is blank, so the time scale keeps moving.
        if (this.valid < fft) {
          rows.push({ levels: new Uint8Array(this.bins), utcMs: t, blank: true, rx: null });
          continue;
        }
        this.spectrum.compute(this.frame, this.db);
        if (this.inTxSlot(t)) {
          // The radio's own transmission may be in this audio: the levels do not learn from it.
          const rx = this.mapper.peek(this.db);
          rows.push({ ...this.txRow(t, rx), utcMs: t, rx });
          continue;
        }
        if (isFt(this.mode)) this.quiet.add(this.db, t);
        const rx = this.mapper.map(this.db);
        rows.push({ levels: rx, utcMs: t, blank: false, rx });
      }
    }
    if (!rows.length) return null;
    this.draw(rows);
    return this.info();
  }

  /**
   * Counts the samples of real audio at the end of the frame. A run of 32 or more exact zeros is
   * digital silence (resampled audio is never exactly 0 for that long), such as the start of a
   * stream, and does not count.
   */
  private countValid(samples: Float32Array, from: number, n: number) {
    for (let i = from; i < from + n; i++) {
      if (samples[i] === 0) {
        if (++this.zeroRun >= 32) this.valid = 0;
      } else this.zeroRun = 0;
      if (this.valid < this.view.fft) this.valid++;
    }
  }

  /** Positions of the slot boundaries on screen. */
  info(): FrameInfo {
    const boundaries = this.marks
      .map((m) => ({ utcMs: m.utcMs, y: this.rowCount - 1 - m.row }))
      .filter((b) => b.y >= 0 && b.y < this.height)
      .reverse();
    return { boundaries, newestUtcMs: this.lastRowUtc ?? 0, rowMs: this.rowMs };
  }

  private draw(rows: Row[]) {
    // Note every row, oldest first, so row numbers and boundaries stay right even when more
    // rows arrive than fit on screen.
    const crossed = rows.map((r) => this.note(r));
    for (const r of rows) this.history.push(r);
    if (this.history.length > this.height) this.history.splice(0, this.history.length - this.height);
    const k = Math.min(rows.length, this.height);
    const { ctx, width, height } = this;
    if (k < height) ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0, width, height - k, 0, k, width, height - k);
    const img = ctx.createImageData(width, k);
    // The newest row goes on top.
    for (let y = 0; y < k; y++) {
      const i = rows.length - 1 - y;
      this.paintPixels(rows[i], img.data, y);
      if (crossed[i]) this.paintLine(img.data, y);
    }
    ctx.putImageData(img, 0, 0);
    this.marks = this.marks.filter((m) => this.rowCount - 1 - m.row < this.height);
  }

  private redraw() {
    const { ctx, width, height } = this;
    this.marks = [];
    this.rowCount = 0;
    this.lastRowUtc = null;
    const img = ctx.createImageData(width, height);
    const [br, bg, bb] = this.palette.background;
    for (let i = 0; i < width * height; i++) {
      img.data[i * 4] = br;
      img.data[i * 4 + 1] = bg;
      img.data[i * 4 + 2] = bb;
      img.data[i * 4 + 3] = 255;
    }
    const rows = this.history;
    // Replay oldest to newest so boundaries are found as they were.
    for (let j = 0; j < rows.length; j++) this.note(rows[j]);
    for (let y = 0; y < Math.min(height, rows.length); y++) this.paintPixels(rows[rows.length - 1 - y], img.data, y);
    for (const m of this.marks) {
      const y = this.rowCount - 1 - m.row;
      if (y >= 0 && y < height) this.paintLine(img.data, y);
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Records the row and its slot boundary; returns true when a boundary falls in it. */
  private note(row: Row): boolean {
    let crossed = false;
    // RTTY is continuous: no slot lines.
    if (this.lastRowUtc !== null && hasSlots(this.mode)) {
      const slot = SLOT_MS[this.mode];
      const b = Math.floor(row.utcMs / slot) * slot;
      if (b > this.lastRowUtc && b <= row.utcMs) {
        this.marks.push({ utcMs: b, row: this.rowCount });
        crossed = true;
      }
    }
    this.lastRowUtc = row.utcMs;
    this.rowCount++;
    return crossed;
  }

  private paintPixels(row: Row, data: Uint8ClampedArray, y: number) {
    const lut = this.lut;
    const lv = row.levels;
    const [br, bg, bb] = this.palette.background;
    let o = y * this.width * 4;
    for (let x = 0; x < this.width; x++, o += 4) {
      if (row.blank) {
        data[o] = br;
        data[o + 1] = bg;
        data[o + 2] = bb;
      } else {
        const c = this.cols[x];
        let v: number;
        if (c.peak) {
          v = 0;
          for (let i = c.i0; i <= c.i1; i++) if (lv[i] > v) v = lv[i];
        } else v = Math.round(lv[c.i0] + (lv[c.i1] - lv[c.i0]) * c.frac);
        data[o] = lut[v * 3];
        data[o + 1] = lut[v * 3 + 1];
        data[o + 2] = lut[v * 3 + 2];
      }
      data[o + 3] = 255;
    }
  }

  private paintLine(data: Uint8ClampedArray, y: number) {
    const [lr, lg, lb, la] = this.palette.line;
    let o = y * this.width * 4;
    for (let x = 0; x < this.width; x++, o += 4) {
      data[o] = Math.round(data[o] + (lr - data[o]) * la);
      data[o + 1] = Math.round(data[o + 1] + (lg - data[o + 1]) * la);
      data[o + 2] = Math.round(data[o + 2] + (lb - data[o + 2]) * la);
    }
  }
}
