// Writes the WAV the fake microphone plays: four tones in the FT8 passband, a strong 13 kHz tone
// that would alias to 1000 Hz without the anti-alias filter, and faint noise. 48 kHz, 20 s, looped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeWav16 } from '../src/lib/slots/wav';

export const RATE = 48000;
export const TONES_HZ = [700, 1300, 1900, 2600];
export const ALIAS_PROBE_HZ = 13000;
/** Where the probe would land after resampling to 12 kHz without filtering. */
export const ALIAS_AT_HZ = ALIAS_PROBE_HZ - 12000;

export default function setup() {
  const n = 20 * RATE;
  const x = new Float32Array(n);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    let v = 0.003 * rand();
    for (const f of TONES_HZ) v += 0.05 * Math.sin((2 * Math.PI * f * i) / RATE);
    v += 0.3 * Math.sin((2 * Math.PI * ALIAS_PROBE_HZ * i) / RATE);
    x[i] = v;
  }
  mkdirSync(new URL('./.fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./.fixtures/tones.wav', import.meta.url), encodeWav16(x, RATE));
}
