/** What the browser applied to the microphone, read back from the track. */

import type { ChannelUse } from './channels';

/** Constraints RR73 asks for: no voice processing, one channel. */
export function captureConstraints(deviceId: string | null): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  };
}

/** On, off, or null when the browser does not say. */
export type Applied = boolean | null;

export interface CaptureReport {
  /** Input label from the browser, or "Microphone". */
  inputLabel: string;
  deviceId: string | null;
  /** AudioContext rate, Hz: the rate the worklet runs at. */
  contextRate: number;
  /** Track sample rate the browser reports, Hz. */
  trackRate: number | null;
  /** Track channel count the browser reports. */
  trackChannels: number | null;
  /** Channels that arrive at the worklet. */
  arrivingChannels: number | null;
  /** The channel in use. */
  channelUsed: ChannelUse | null;
  /** Audio-clock rate measured against the system clock, Hz. */
  measuredRate: number | null;
  echoCancellation: Applied;
  noiseSuppression: Applied;
  autoGainControl: Applied;
  /** Audio session type in force, or null where the API is missing. */
  audioSession: string | null;
}

const flag = (v: unknown): Applied => (typeof v === 'boolean' ? v : null);

/** The report from a track's settings and the context; the worklet fills in the channel fields. */
export function readReport(track: Pick<MediaStreamTrack, 'label' | 'getSettings'>, contextRate: number, audioSession: string | null): CaptureReport {
  const s = track.getSettings() as MediaTrackSettings & { channelCount?: number; sampleRate?: number };
  return {
    inputLabel: track.label || 'Microphone',
    deviceId: s.deviceId ?? null,
    contextRate,
    trackRate: typeof s.sampleRate === 'number' && s.sampleRate > 0 ? s.sampleRate : null,
    trackChannels: typeof s.channelCount === 'number' && s.channelCount > 0 ? s.channelCount : null,
    arrivingChannels: null,
    channelUsed: null,
    measuredRate: null,
    echoCancellation: flag(s.echoCancellation),
    noiseSuppression: flag(s.noiseSuppression),
    autoGainControl: flag(s.autoGainControl),
    audioSession,
  };
}

/**
 * Measures the audio clock against the system clock from chunk arrivals. Arrival jitter of
 * tens of ms averages out: after 30 s the estimate is within about 0.1 %.
 */
export class RateMeter {
  private first: { wallMs: number; contextTime: number } | null = null;
  private last: { wallMs: number; contextTime: number } | null = null;

  reset() {
    this.first = null;
    this.last = null;
  }

  add(wallMs: number, contextTime: number) {
    if (!this.first) this.first = { wallMs, contextTime };
    this.last = { wallMs, contextTime };
  }

  /** Measured rate, Hz, once `minSeconds` have passed; null before. */
  rate(contextRate: number, minSeconds = 5): number | null {
    if (!this.first || !this.last) return null;
    const wall = (this.last.wallMs - this.first.wallMs) / 1000;
    if (wall < minSeconds) return null;
    return (contextRate * (this.last.contextTime - this.first.contextTime)) / wall;
  }
}
