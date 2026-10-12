/**
 * 16-bit PCM WAV, mono, as the corpus stores slots (docs/corpus.md). Samples are clamped to
 * ±1, scaled by 32767 and rounded half away from zero, so the scale is symmetric: +1 and −1 map
 * to +32767 and −32767.
 */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // channels
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const c = x > 1 ? 1 : x < -1 ? -1 : Number.isNaN(x) ? 0 : x;
    const q = Math.round(Math.abs(c) * 32767);
    v.setInt16(44 + 2 * i, c < 0 ? -q : q, true);
  }
  return out;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Sample frames in the data chunk. */
  frames: number;
  /** Samples of the first channel, scaled to ±1. */
  samples: Float32Array;
}

/** Reads a PCM 16-bit WAV, walking the chunks. Throws on anything else. */
export function decodeWav16(bytes: Uint8Array): WavInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      if (v.getUint16(at + 8, true) !== 1) throw new Error('Not PCM.');
      fmt = { channels: v.getUint16(at + 10, true), sampleRate: v.getUint32(at + 12, true), bits: v.getUint16(at + 22, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('Not 16-bit PCM.');
      const frames = size / (2 * fmt.channels);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = v.getInt16(at + 8 + 2 * i * fmt.channels, true) / 32767;
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, frames, samples };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('No data chunk.');
}
