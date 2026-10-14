/**
 * WSPR's reported power: 0 to 60 dBm in values ending in 0, 3 or 7, as the codec accepts them
 * (crates/rr73-wspr). Each value is shown with its power in watts, rounded as WSPR operators
 * write it: 37 dBm is 5 W.
 */

/** The power values a WSPR message can carry, dBm, lowest first. */
export const POWERS_DBM: readonly number[] = Array.from({ length: 61 }, (_, i) => i).filter((p) => [0, 3, 7].includes(p % 10));

export const DEFAULT_POWER_DBM = 37;

export function isPowerDbm(v: unknown): v is number {
  return typeof v === 'number' && POWERS_DBM.includes(v);
}

/** "5 W", "200 mW", "1 kW": 1, 2 or 5 times a power of ten, from the dBm value. */
export function wattsText(dbm: number): string {
  const decade = Math.floor(dbm / 10);
  const step = [1, 2, 5][[0, 3, 7].indexOf(dbm % 10)] ?? 10 ** ((dbm % 10) / 10);
  const mw = step * 10 ** decade;
  if (mw >= 1e6) return `${mw / 1e6} kW`;
  if (mw >= 1e3) return `${mw / 1e3} W`;
  return `${mw} mW`;
}

/** "37 dBm · 5 W". */
export function powerText(dbm: number): string {
  return `${dbm} dBm · ${wattsText(dbm)}`;
}
