// Time and number formats from the style guide: 13:14:30 UTC, 14.074 MHz, 1500 Hz, −15 dB.

/** The minus sign (U+2212) for negative numbers on screen. */
export const MINUS = '−';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "13:14:52" for a UTC time in ms. */
export function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** "13:14" for a UTC time in ms. */
export function utcHm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "2026-10-13T13:14:15Z" (whole seconds) for a UTC time in ms. */
export function isoUtc(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/** WSJT-X style file stem, "261013_131415", for a slot start in UTC ms. */
export function slotStem(ms: number): string {
  const d = new Date(ms);
  return (
    pad(d.getUTCFullYear() % 100) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    '_' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/** A signed number with the minus sign, "−15" or "3". */
export function signed(n: number, digits = 0): string {
  const s = Math.abs(n).toFixed(digits);
  return n < 0 && Number(s) !== 0 ? MINUS + s : s;
}

/** Decode SNR as WSJT-X shows it: "−09", "+03". */
export function snr(db: number): string {
  const v = Math.round(db);
  const a = Math.abs(v);
  return (v < 0 ? MINUS : '+') + (a < 10 ? '0' : '') + a;
}

/** Decode DT to one decimal: "0.2", "−0.4". */
export function dt(s: number): string {
  return signed(s, 1);
}

/** "14.074 MHz" for a dial frequency in Hz, with more decimals only where needed: "7.0475 MHz". */
export function mhz(hz: number): string {
  const text = (hz / 1e6).toFixed(6).replace(/0{1,3}$/, '');
  return `${text} MHz`;
}
