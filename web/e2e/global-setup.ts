// Writes the WAVs the fake microphone plays: tones.wav (four tones in the FT8 passband, a strong
// 13 kHz tone that would alias to 1000 Hz without the anti-alias filter, faint noise; 48 kHz, 20 s),
// qso-script.wav (the other station of the QSO simulation; see qso-script.ts) and
// ft8-loop-hole.wav (fixtures/ft8-loop.wav with 1 s of silence, for slot-record.spec.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodeWav16, encodeWav16 } from '../src/lib/slots/wav';
import { RATE as SCRIPT_RATE, renderScript } from './qso-script';
import { loadWasm } from './wasm';

export const RATE = 48000;
export const TONES_HZ = [700, 1300, 1900, 2600];
export const ALIAS_PROBE_HZ = 13000;
/** The stretch of fixtures/ft8-loop.wav that ft8-loop-hole.wav leaves silent, s. */
export const HOLE_S = [6, 7] as const;
/** Where the probe would land after resampling to 12 kHz without filtering. */
export const ALIAS_AT_HZ = ALIAS_PROBE_HZ - 12000;

export default async function setup() {
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

  const loop = decodeWav16(readFileSync(new URL('./fixtures/ft8-loop.wav', import.meta.url)));
  const holed = loop.samples.slice();
  holed.fill(0, HOLE_S[0] * loop.sampleRate, HOLE_S[1] * loop.sampleRate);
  writeFileSync(new URL('./.fixtures/ft8-loop-hole.wav', import.meta.url), encodeWav16(holed, loop.sampleRate));

  // The QSO simulation's other station, synthesised with the app's own encoder. Without the
  // wasm package the file is silence and the transmit tests skip.
  const wasm = await loadWasm();
  const script = wasm ? renderScript(wasm) : new Float32Array(SCRIPT_RATE);
  writeFileSync(new URL('./.fixtures/qso-script.wav', import.meta.url), encodeWav16(script, SCRIPT_RATE));
}
