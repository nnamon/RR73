// The wall clock for the UTC display and the slot ring, ticking 5 times a second.

export const clock = $state({ ms: Date.now() });

let timer: ReturnType<typeof setInterval> | null = null;

export function startClock() {
  if (timer) return;
  timer = setInterval(() => (clock.ms = Date.now()), 200);
}
