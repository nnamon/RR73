/**
 * How far to set the transmit level during Tune, in each radio's manual's words:
 *
 * - KX2: "While transmitting audio data, adjust MIC gain for no more than 4 to 5 bars of ALC
 *   indication" (Elecraft KX2 Owner's Manual, revision B2, Audio Data Modes, pp. 28 to 29).
 * - IC-705: "When operating in the SSB data mode, adjust the device's output level within the
 *   ALC zone" (Icom IC-705 Advanced Manual A7560-7EX-5, Data communication, p. 2-18). The ALC
 *   zone is marked on the meter's ALC scale (Basic Manual A7560D-1EX-9, Meter display, p. 3-9).
 *
 * Without a connected radio RR73 cannot know which it is, and gives both.
 */

import type { CatRadioId } from '../state/settings.svelte';

export function alcAdvice(radio: CatRadioId | null): string {
  if (radio === 'kx2') return 'Set the level for 4 to 5 ALC bars during Tune, no more.';
  if (radio === 'ic705') return 'Set the level so the ALC meter stays within the ALC zone during Tune.';
  return 'Set the level during Tune as the radio’s manual gives for data: 4 to 5 ALC bars on a KX2, within the ALC zone on an IC-705.';
}
