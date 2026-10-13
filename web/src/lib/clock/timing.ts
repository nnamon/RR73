/**
 * Timing measurements for Settings › Radio and audio and the timing report: the raw clock
 * readings behind the mapping, how far capture stamps trail the audio clock, and the mapping just
 * before each stop and just after each resume.
 */

import { isoUtc, signed, utcTime } from './format';

/** One reading the engine takes with each chunk: everything the mapping is built from. */
export interface ClockReading {
  /** Output timestamp: audio-clock time, s; 0 when the browser gave none. */
  contextTime: number;
  /** Output timestamp: performance.now() time at which that audio-clock time is heard, ms; 0 when none. */
  performanceTime: number;
  /** performance.now() at the reading, ms. */
  perfNow: number;
  /** Date.now() at the reading, ms. */
  dateNow: number;
  /** AudioContext.currentTime at the reading, s. */
  currentTime: number;
}

/** What the mapping is built from now: the browser's output timestamps, or currentTime paired with now. */
export type ClockSource = 'output' | 'current-time';

/** The mapping around one stop and resume. */
export interface ResumeRecord {
  /** When capture stopped, UTC ms. */
  stoppedAtUtcMs: number;
  /** Mapping offset just before the stop, ms; null without a mapping. */
  beforeMs: number | null;
  /** When the mapping settled after the resume, UTC ms; null until then. */
  resumedAtUtcMs: number | null;
  /** Mapping offset once settled after the resume, ms. */
  afterMs: number | null;
}

/** A transmission and the decode of it from the receive audio of its slot. */
export interface HeardBack {
  /** Slot start, UTC ms. */
  slotStartUtcMs: number;
  /** Message as transmitted. */
  text: string;
  /** DT of the decode, s; null when the slot did not decode it. */
  dtS: number | null;
  snrDb: number | null;
}

/** Readings kept for the report: about 2.7 s of chunks. */
const READINGS = 64;
/** Capture lags the minimum is taken over: about 2.7 s of chunks. */
const LAGS = 64;
/** Stops and resumes kept. */
const RESUMES = 5;

/**
 * Collects the engine's timing measurements. The mapping offset is the UTC the mapping gives the
 * audio clock now minus Date.now(): the output latency on output timestamps (tens of ms), about 0
 * on currentTime. A resume that changes it by more than a few ms moved the mapping.
 */
export class TimingLog {
  private readingsBuf: ClockReading[] = [];
  private lagsBuf: number[] = [];
  private resumesBuf: ResumeRecord[] = [];

  /** Notes one clock reading. */
  reading(r: ClockReading) {
    this.readingsBuf.push(r);
    if (this.readingsBuf.length > READINGS) this.readingsBuf.shift();
  }

  /**
   * Notes how far a chunk's end trails the audio clock when it arrives, s. Arrival adds a few ms;
   * a stamp that counts samples the browser never delivered trails by the time missing.
   */
  lag(seconds: number) {
    this.lagsBuf.push(seconds);
    if (this.lagsBuf.length > LAGS) this.lagsBuf.shift();
  }

  /** Smallest capture lag over the last 64 chunks, ms; null before any. */
  get captureLagMs(): number | null {
    return this.lagsBuf.length ? Math.min(...this.lagsBuf) * 1000 : null;
  }

  /** Notes a stop with the mapping offset just before it. */
  stopped(atUtcMs: number, offsetMs: number | null) {
    this.resumesBuf.push({ stoppedAtUtcMs: atUtcMs, beforeMs: offsetMs, resumedAtUtcMs: null, afterMs: null });
    if (this.resumesBuf.length > RESUMES) this.resumesBuf.shift();
  }

  /** Notes the mapping offset once settled after a resume. Only the latest stop takes it. */
  settled(atUtcMs: number, offsetMs: number) {
    const last = this.resumesBuf[this.resumesBuf.length - 1];
    if (last && last.resumedAtUtcMs === null) {
      last.resumedAtUtcMs = atUtcMs;
      last.afterMs = offsetMs;
    }
  }

  /** Forgets the lags, for a new capture. */
  restart() {
    this.lagsBuf = [];
  }

  get readings(): ClockReading[] {
    return [...this.readingsBuf];
  }

  get resumes(): ResumeRecord[] {
    return this.resumesBuf.map((r) => ({ ...r }));
  }
}

/** Everything the Timing section shows and the report carries. */
export interface TimingSnapshot {
  atUtcMs: number;
  appVersion: string;
  /** Audio status: running, stopped and so on. */
  audio: string;
  source: ClockSource | null;
  /** Mapping offset now, ms. */
  offsetMs: number | null;
  driftPpm: number | null;
  captureLagMs: number | null;
  /** Receive calibration applied to captured audio, s. */
  inputOffsetS: number;
  /** Median DT of the strong decodes the calibration holds, s, as measured. */
  medianDtS: number | null;
  strongDecodes: number;
  heardBack: HeardBack[];
  resumes: ResumeRecord[];
  readings: ClockReading[];
  /** The mapper's observations, UTC ms minus audio-clock ms, oldest first. */
  observations: number[];
}

const ms = (v: number | null, digits = 1) => (v === null ? 'none' : `${v.toFixed(digits)} ms`);

/** Plain-text timing report for the operator to paste into a message. */
export function timingReport(s: TimingSnapshot): string {
  const lines = [
    `RR73 ${s.appVersion} timing report, ${isoUtc(s.atUtcMs)}`,
    `Audio: ${s.audio}`,
    `Clock source: ${s.source === 'output' ? 'output timestamps' : s.source === 'current-time' ? 'currentTime' : 'none'}`,
    `Mapping offset: ${ms(s.offsetMs)}`,
    `Clock drift: ${s.driftPpm === null ? 'not measured yet' : `${s.driftPpm.toFixed(0)} ppm`}`,
    `Capture lag: ${ms(s.captureLagMs)}`,
    `Input offset: ${signed(s.inputOffsetS, 3)} s`,
    `Median DT: ${s.medianDtS === null ? 'none' : `${signed(s.medianDtS, 3)} s`} from ${s.strongDecodes} decodes at -10 dB or stronger`,
    'Your Tx, heard back:',
    ...(s.heardBack.length ? s.heardBack.map((h) => `  ${utcTime(h.slotStartUtcMs)} ${h.text}: ${h.dtS === null ? 'not heard' : `DT ${signed(h.dtS, 2)} s, SNR ${signed(h.snrDb ?? 0)} dB`}`) : ['  no transmissions']),
    'Stops and resumes (mapping offset before, after):',
    ...(s.resumes.length
      ? s.resumes.map((r) => `  ${utcTime(r.stoppedAtUtcMs)} to ${r.resumedAtUtcMs === null ? 'not resumed' : utcTime(r.resumedAtUtcMs)}: ${ms(r.beforeMs)}, ${ms(r.afterMs)}`)
      : ['  none']),
    `Mapper observations (UTC ms minus audio-clock ms): ${s.observations.map((v) => v.toFixed(1)).join(' ')}`,
    'Clock readings (contextTime s, performanceTime ms, perfNow ms, dateNow ms, currentTime s):',
    ...s.readings.map((r) => `  ${r.contextTime.toFixed(6)} ${r.performanceTime.toFixed(3)} ${r.perfNow.toFixed(3)} ${r.dateNow} ${r.currentTime.toFixed(6)}`),
  ];
  return lines.join('\n');
}

/** What RR73 sent in a slot. */
export interface SentTx {
  text: string;
  /** Tx audio frequency, Hz. */
  f0Hz: number;
}

/**
 * Finds RR73's own transmission among the decodes of its slot: the same text, or else the
 * strongest decode within 10 Hz of the Tx frequency (a message with a hashed callsign decodes
 * with the callsign in angle brackets). The receiver is muted while the radio transmits, so
 * nothing else decodes there.
 */
export function findOwnDecode(sent: SentTx, decodes: readonly { text: string; freq_hz: number; dt_s: number; snr_db: number }[]) {
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase();
  const exact = decodes.find((d) => norm(d.text) === norm(sent.text));
  if (exact) return exact;
  const near = decodes.filter((d) => Math.abs(d.freq_hz - sent.f0Hz) <= 10).sort((a, b) => b.snr_db - a.snr_db);
  return near[0] ?? null;
}
