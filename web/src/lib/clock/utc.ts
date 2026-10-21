/**
 * UTC for slot timing and transmit scheduling: the system time plus a correction.
 *
 * In a browser the correction is 0 and `utcNow()` is `Date.now()`. The desktop app measures the
 * system clock against an NTP server (desktop/src/lib.rs) and sets the correction to the
 * measured offset, so slots, the audio clock's mapping and every transmission follow the
 * server's time while the computer's clock is off (lib/state/desktop.svelte.ts).
 */

let correctionMs = 0;

/** UTC now, ms since 1970: the system time plus the correction. */
export function utcNow(): number {
  return Date.now() + correctionMs;
}

/** The correction in use, ms: server time minus system time. */
export function utcCorrectionMs(): number {
  return correctionMs;
}

/** Sets the correction, ms. Non-finite values set 0. */
export function setUtcCorrection(ms: number) {
  correctionMs = Number.isFinite(ms) ? ms : 0;
}

/** One NTP measurement of the system clock. */
export interface NtpSample {
  /** Server time minus system time, ms. */
  offsetMs: number;
  /** Round-trip delay of the exchange, ms: the offset is good to half of it. */
  delayMs: number;
  stratum: number;
}

/** A measurement whose round trip is longer than this is not used, ms: its error could reach 0.25 s. */
export const NTP_MAX_DELAY_MS = 500;

/** True when `s` may set the correction. */
export function usableSample(s: NtpSample | null | undefined): s is NtpSample {
  return !!s && Number.isFinite(s.offsetMs) && Number.isFinite(s.delayMs) && s.delayMs >= 0 && s.delayMs <= NTP_MAX_DELAY_MS;
}

/**
 * The system clock against the server, as Settings › Radio and audio › Timing shows it: "1.234 s
 * slow, ±12 ms". A positive offset means the server is ahead, so the system clock is slow.
 */
export function ntpText(s: NtpSample): string {
  const err = `±${Math.max(1, Math.round(s.delayMs / 2))} ms`;
  if (Math.abs(s.offsetMs) < 0.5) return `On time, ${err}`;
  return `${(Math.abs(s.offsetMs) / 1000).toFixed(3)} s ${s.offsetMs > 0 ? 'slow' : 'fast'}, ${err}`;
}
