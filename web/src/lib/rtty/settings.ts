/**
 * RTTY's settings (Settings › RTTY, docs/design/rtty.md) and their mapping onto rr73-rtty's
 * DecoderConfig and TxConfig. The radio is in USB with the pair centred on 1500 Hz by default:
 * mark 1585 Hz, space 1415 Hz. Mark is the higher tone; Rev swaps them.
 */

import type { BandId } from '../radio/bands';
import { isBand } from '../radio/bands';

export type Figures = 'us' | 'ita2';
export type Idle = 'diddle' | 'mark';

export interface RttySettings {
  /** Signalling rate, baud: 20 to 150. */
  baud: number;
  /** Mark to space, Hz: 50 to 1000. */
  shiftHz: number;
  /** Stop bits sent: 1, 1.5 or 2. The receiver takes any. */
  stopBits: number;
  /** Reversed polarity: mark is the lower tone (a station sending reversed, or the radio in LSB). */
  reverse: boolean;
  /** The receiver follows the signal's frequency. */
  afc: boolean;
  /** Squelch, dB SNR in 3000 Hz: -30 to 0; null is Off. */
  squelchDb: number | null;
  /** Unshift on space, receive and transmit. */
  usos: boolean;
  figures: Figures;
  /** LTRS sent before the text, s: 0 to 5. */
  preambleS: number;
  idle: Idle;
  /** LTRS sent after the text: 0 to 10. */
  tailChars: number;
  /** CR LF after the preamble, so the other station's text starts on a fresh line. */
  newLineFirst: boolean;
  /** A transmission that sends only the idle signal this long ends, s; 0 is Off. */
  idleStopS: number;
  /** Tx goes off after this long with no key press, macro tap or Log QSO, min; 0 is Off. */
  watchdogMin: number;
  /** Repeat CQ listens this long between CQs, s: 1 to 60. */
  repeatGapS: number;
  /** Mark tone of the pair, Hz. Tx uses the Rx pair. */
  markHz: number;
  /** The radio's dial in RTTY, Hz, by band, where the operator changed it. */
  dialHz: Partial<Record<BandId, number>>;
}

export const RTTY_DEFAULTS: Readonly<RttySettings> = {
  baud: 45.45,
  shiftHz: 170,
  stopBits: 1.5,
  reverse: false,
  afc: true,
  squelchDb: -14,
  usos: true,
  figures: 'us',
  preambleS: 0.5,
  idle: 'diddle',
  tailChars: 1,
  newLineFirst: true,
  idleStopS: 60,
  watchdogMin: 10,
  repeatGapS: 3,
  markHz: 1585,
  dialHz: {},
};

export const BAUDS = [45.45, 50, 75] as const;
export const SHIFTS = [170, 200, 425, 850] as const;
export const STOP_BITS = [1, 1.5, 2] as const;
/** Speed and shift presets in Operate's tuning row. */
export const PRESETS: readonly { baud: number; shiftHz: number }[] = [
  { baud: 45.45, shiftHz: 170 },
  { baud: 50, shiftHz: 170 },
  { baud: 75, shiftHz: 170 },
  { baud: 45.45, shiftHz: 425 },
  { baud: 50, shiftHz: 850 },
];
/** Squelch levels in Operate's menu, dB; Settings takes any whole dB from -30 to 0. */
export const SQUELCH_MENU: readonly (number | null)[] = [null, -20, -18, -16, -14, -12, -10, -8, -6];
export const IDLE_STOPS_S: readonly number[] = [10, 30, 60, 120, 300, 0];

/** The lowest and highest audio tone of a pair, Hz: inside an SSB filter and the waterfall. */
export const TONE_LIMITS = { minHz: 200, maxHz: 2900 } as const;

/** "45.45 · 170". */
export function presetLabel(baud: number, shiftHz: number): string {
  return `${baud} · ${shiftHz}`;
}

/** Space tone for a mark, Hz. */
export function spaceHz(s: Pick<RttySettings, 'shiftHz' | 'reverse'>, markHz: number): number {
  return s.reverse ? markHz + s.shiftHz : markHz - s.shiftHz;
}

/** Centre of the pair, Hz. */
export function centreHz(s: Pick<RttySettings, 'shiftHz' | 'reverse'>, markHz: number): number {
  return (markHz + spaceHz(s, markHz)) / 2;
}

/** The mark of the pair centred on `hz`, Hz. */
export function markForCentre(s: Pick<RttySettings, 'shiftHz' | 'reverse'>, hz: number): number {
  return s.reverse ? hz - s.shiftHz / 2 : hz + s.shiftHz / 2;
}

/** A mark tone that keeps both tones inside TONE_LIMITS, rounded to 1 Hz. */
export function clampMark(s: Pick<RttySettings, 'shiftHz' | 'reverse'>, markHz: number): number {
  const half = s.shiftHz / 2;
  const lo = TONE_LIMITS.minHz + half;
  const hi = TONE_LIMITS.maxHz - half;
  const c = Math.min(hi, Math.max(lo, centreHz(s, markHz)));
  return Math.round(markForCentre(s, c));
}

/** Length of one character on the air, s: start bit, 5 data bits and the stop bits. */
export function charSeconds(s: Pick<RttySettings, 'baud' | 'stopBits'>): number {
  return (6 + s.stopBits) / s.baud;
}

/** "1 min", "30 s", "2 min", "Off". */
export function secondsText(s: number): string {
  if (s <= 0) return 'Off';
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Stored values over the defaults, each kept only when it is of the right type and in range. */
export function validateRtty(raw: unknown): RttySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s: RttySettings = { ...RTTY_DEFAULTS, dialHz: {} };
  s.baud = num(r.baud, 20, 150) ?? s.baud;
  s.shiftHz = num(r.shiftHz, 50, 1000) ?? s.shiftHz;
  if ((STOP_BITS as readonly unknown[]).includes(r.stopBits)) s.stopBits = r.stopBits as number;
  for (const k of ['reverse', 'afc', 'usos', 'newLineFirst'] as const) if (typeof r[k] === 'boolean') s[k] = r[k];
  if (r.squelchDb === null) s.squelchDb = null;
  else s.squelchDb = num(r.squelchDb, -30, 0) ?? s.squelchDb;
  if (r.figures === 'us' || r.figures === 'ita2') s.figures = r.figures;
  s.preambleS = num(r.preambleS, 0, 5) ?? s.preambleS;
  if (r.idle === 'diddle' || r.idle === 'mark') s.idle = r.idle;
  const tail = num(r.tailChars, 0, 10);
  if (tail !== null) s.tailChars = Math.round(tail);
  const stop = num(r.idleStopS, 0, 86_400);
  if (stop !== null && (stop === 0 || stop >= 10)) s.idleStopS = Math.round(stop);
  s.watchdogMin = num(r.watchdogMin, 0, 9999) ?? s.watchdogMin;
  s.repeatGapS = num(r.repeatGapS, 1, 60) ?? s.repeatGapS;
  const mark = num(r.markHz, 100, 5000);
  if (mark !== null) s.markHz = clampMark(s, mark);
  const dials = r.dialHz as Record<string, unknown> | undefined;
  if (dials && typeof dials === 'object') for (const [b, hz] of Object.entries(dials)) if (isBand(b) && typeof hz === 'number' && Number.isFinite(hz) && hz > 0) s.dialHz[b] = Math.round(hz);
  return s;
}

/** rr73-rtty's RttyParams for these settings, as JSON. */
function params(s: RttySettings) {
  return {
    baud: s.baud,
    shift_hz: s.shiftHz,
    stop_bits: s.stopBits,
    polarity: s.reverse ? 'reverse' : 'normal',
    figures: s.figures,
    unshift_on_space: s.usos,
  };
}

/** The receiver's DecoderConfig at mark `markHz`, as JSON. */
export function decoderConfig(s: RttySettings, markHz = s.markHz): Record<string, unknown> {
  return {
    params: params(s),
    mark_hz: markHz,
    afc: { track: s.afc },
    squelch_db: s.squelchDb,
  };
}

/** The transmitter's TxConfig at the output rate (Hz) and level (0 to 1), as JSON. */
export function txConfig(s: RttySettings, sampleRate: number, level: number, markHz = s.markHz): Record<string, unknown> {
  return {
    params: params(s),
    mark_hz: markHz,
    sample_rate: sampleRate,
    preamble_chars: Math.max(0, Math.round(s.preambleS / charSeconds(s))),
    postamble_chars: s.tailChars,
    idle: s.idle,
    amplitude: Math.max(0, Math.min(1, level)),
  };
}
