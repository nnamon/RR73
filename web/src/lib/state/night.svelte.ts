/**
 * The night display over Operate (ui/NightDisplay.svelte): on from Night display in •••, or by
 * itself after Settings › Appearance › Night display minutes without a touch or a key while
 * Operate shows FT8, FT4 or WSPR. A tap or a key wakes Operate.
 */

import { route } from '../app/router.svelte';
import { isKeyboard } from '../clock/slots';
import { settings } from './settings.svelte';

export const night = $state({ on: false });

let lastActivity = Date.now();

/** Turns the night display on. */
export function showNight() {
  night.on = true;
}

/** Back to Operate. */
export function wakeNight() {
  night.on = false;
  lastActivity = Date.now();
}

/** True when the night display should come on by itself at `nowMs`; `shown` while Operate shows a mode that has one. */
export function nightDue(nowMs: number, lastMs: number, afterMin: number, shown: boolean): boolean {
  return afterMin > 0 && shown && nowMs - lastMs >= afterMin * 60_000;
}

/** Watches touches and keys, and turns the night display on after the idle time. Returns the function that stops it. */
export function startNightTimer(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const touched = () => {
    lastActivity = Date.now();
  };
  // A key wakes the display and still reaches the app, so Escape halts as ever.
  const key = () => {
    if (night.on) wakeNight();
    else touched();
  };
  window.addEventListener('pointerdown', touched, { capture: true, passive: true });
  window.addEventListener('keydown', key, { capture: true });
  const timer = setInterval(() => {
    const shown = (route.path[0] ?? 'operate') === 'operate' && !isKeyboard(settings.mode);
    if (!night.on && nightDue(Date.now(), lastActivity, settings.nightAfterMin, shown)) night.on = true;
  }, 5_000);
  return () => {
    window.removeEventListener('pointerdown', touched, { capture: true });
    window.removeEventListener('keydown', key, { capture: true });
    clearInterval(timer);
  };
}
