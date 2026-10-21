/**
 * The desktop app's start (docs/design/desktop.md): the NTP clock correction and the window's
 * close. main.ts loads this module only in the desktop app.
 *
 * The clock is measured at start and every NTP_INTERVAL_MS, or NTP_RETRY_MS after a failure. A
 * measurement with a round trip under NTP_MAX_DELAY_MS sets the correction utcNow() adds
 * (lib/clock/utc.ts); without one the system time stands.
 *
 * Closing the window first Halts: Tx goes off and a radio keyed over CAT gets PTT off. The app
 * then quits after CLOSE_HALT_MS; the Rust side closes it anyway after 2 s.
 */

import { desktopBridge, type DesktopBridge } from '../app/desktop';
import { setUtcCorrection, usableSample, utcNow, type NtpSample } from '../clock/utc';

/** Time between measurements, ms. */
export const NTP_INTERVAL_MS = 10 * 60_000;
/** Time to the next try after a failed or unusable measurement, ms. */
export const NTP_RETRY_MS = 60_000;
/** Time the window gives Halt's PTT off before the app quits, ms. */
export const CLOSE_HALT_MS = 600;

/** The last usable measurement and when it was made (UTC ms); `failed` when the last try gave none. */
export const ntp = $state<{ sample: NtpSample | null; atMs: number | null; failed: boolean }>({ sample: null, atMs: null, failed: false });

/** Measures the clock once; true when the measurement set the correction. */
export async function measureClock(bridge: DesktopBridge): Promise<boolean> {
  let s: NtpSample | null = null;
  try {
    s = await bridge.invoke<NtpSample>('clock_offset');
  } catch {
    s = null;
  }
  if (!usableSample(s)) {
    ntp.failed = true;
    return false;
  }
  setUtcCorrection(s.offsetMs);
  ntp.sample = s;
  ntp.atMs = utcNow();
  ntp.failed = false;
  return true;
}

interface Deps {
  bridge(): Promise<DesktopBridge>;
  halt(): void;
  later(fn: () => void, ms: number): void;
}

/** Starts the clock measurements and the close handling. */
export async function initDesktop(deps?: Partial<Deps>): Promise<void> {
  const d: Deps = {
    bridge: desktopBridge,
    halt: () => void import('./station.svelte').then((m) => m.halt()),
    later: (fn, ms) => void setTimeout(fn, ms),
    ...deps,
  };
  const bridge = await d.bridge();
  const cycle = async () => {
    const ok = await measureClock(bridge);
    d.later(() => void cycle(), ok ? NTP_INTERVAL_MS : NTP_RETRY_MS);
  };
  await bridge.listen('rr73://close', () => {
    d.halt();
    d.later(() => void bridge.invoke('app_quit').catch(() => undefined), CLOSE_HALT_MS);
  });
  void cycle();
}
