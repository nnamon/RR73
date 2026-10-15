/**
 * The dial shift that keeps FT8 and FT4 transmit audio in the middle of the IC-705's transmit
 * passband (docs/design/cat.md, Passband shift). Pure arithmetic; the app decides when it applies
 * (lib/state/radio.svelte.ts) and the radio link sets the dial (lib/cat/radio.ts).
 *
 * In USB-D the IC-705 transmits 300 to 2700 Hz of audio by default (Basic Manual p. 4-8; SET >
 * Tone Control/TBW > TX > SSB-D > TBW, p. 8-2). The setting's lower edge is 100, 200, 300 or 500 Hz
 * and its upper edge 2500, 2700, 2800 or 2900 Hz (CI-V guide p. 20, item 0022 on p. 5), so audio
 * between TX_WINDOW_LOW_HZ and TX_WINDOW_HIGH_HZ, with an FT4 signal's 83 Hz above it, sits inside
 * every setting, at least 500 Hz from either edge. A tone at 1500 Hz or above has its second
 * harmonic at 3000 Hz or above, outside the widest upper edge.
 *
 * Audio outside the window moves into it by whole TX_SHIFT_STEP_HZ steps, and the dial moves the
 * other way by the same amount: Tx dial = receive dial + shift, Tx audio = audio − shift, so the
 * RF frequency (dial + audio in USB) stays where the operator put it.
 */

/** The lowest tone of a transmission sits at or above this audio frequency after a shift, Hz. */
export const TX_WINDOW_LOW_HZ = 1500;
/** The lowest tone of a transmission sits below this audio frequency after a shift, Hz. */
export const TX_WINDOW_HIGH_HZ = 2000;
/** The dial moves in whole steps of this size, Hz: the window's width, so every audio frequency has one shift. */
export const TX_SHIFT_STEP_HZ = TX_WINDOW_HIGH_HZ - TX_WINDOW_LOW_HZ;

/**
 * The dial shift for a transmission whose lowest tone is at audio `hz`, Hz: 0 inside the window,
 * else the whole number of steps that brings the audio into it. Positive moves the dial up.
 */
export function txDialShiftHz(hz: number): number {
  if (hz >= TX_WINDOW_LOW_HZ && hz < TX_WINDOW_HIGH_HZ) return 0;
  return Math.floor((hz - TX_WINDOW_LOW_HZ) / TX_SHIFT_STEP_HZ) * TX_SHIFT_STEP_HZ;
}
