// The wall clock for the UTC display and the slot ring, ticking 5 times a second. In the desktop
// app it runs on the NTP-corrected time (lib/clock/utc.ts).

import { utcNow } from '../clock/utc';

export const clock = $state({ ms: utcNow() });

let timer: ReturnType<typeof setInterval> | null = null;

export function startClock() {
  if (timer) return;
  timer = setInterval(() => (clock.ms = utcNow()), 200);
}
