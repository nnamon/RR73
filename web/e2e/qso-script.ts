// The other station in the QSO simulation: one slot of each step, with our slots left silent
// (receive is muted while we transmit). Written as 90 s of 12 kHz audio for the fake microphone.
import type { Wasm } from './wasm';

export const DX = { call: 'JA1KXM', grid: 'PM95', hz: 1418, dtS: 0.1, snrDb: -8 };

/** Their message in each slot of the 6-slot script; null where we transmit. */
export const SCRIPT: (string | null)[] = [`CQ ${DX.call} ${DX.grid}`, null, `9V1NE ${DX.call} -12`, null, `9V1NE ${DX.call} RR73`, null];

export const RATE = 12000;
const SLOT = 15 * RATE;
/** White noise, RMS 0.02, the channel simulator's reference level. */
const SIGMA = 0.02;

/** 90 s of audio: the script's transmissions at DX.snrDb in noise. */
export function renderScript(wasm: Wasm): Float32Array {
  const out = new Float32Array(SCRIPT.length * SLOT);
  let seed = 2026;
  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 1) / 4294967297;
  };
  for (let i = 0; i < out.length; i += 2) {
    // Box-Muller: two Gaussian samples per pair of uniforms.
    const r = Math.sqrt(-2 * Math.log(uniform()));
    const t = 2 * Math.PI * uniform();
    out[i] = SIGMA * r * Math.cos(t);
    if (i + 1 < out.length) out[i + 1] = SIGMA * r * Math.sin(t);
  }
  // SNR in 2500 Hz: signal power A²/2 against noise power σ² × 2500 / 6000.
  const amp = Math.sqrt(2 * 10 ** (DX.snrDb / 10) * SIGMA ** 2 * (2500 / 6000));
  SCRIPT.forEach((text, k) => {
    if (!text) return;
    const tx = wasm.synthesize(text, 'FT8', DX.hz, RATE);
    const at = k * SLOT + Math.round((0.5 + DX.dtS) * RATE);
    for (let i = 0; i < tx.length; i++) out[at + i] += amp * tx[i];
  });
  return out;
}
