import { describe, expect, it } from 'vitest';
import { decodeWav16, encodeWav16 } from './wav';

describe('encodeWav16', () => {
  it('writes a 44-byte PCM header for 12 kHz mono', () => {
    const wav = encodeWav16(new Float32Array(180000), 12000);
    const v = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(wav.length).toBe(44 + 360000);
    expect(tag(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 360000);
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(12000);
    expect(v.getUint32(28, true)).toBe(24000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(360000);
  });

  it('scales, rounds and clamps samples', () => {
    const wav = encodeWav16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -3, Number.NaN, 1 / 32767]), 12000);
    const v = new DataView(wav.buffer);
    const s = Array.from({ length: 9 }, (_, i) => v.getInt16(44 + 2 * i, true));
    expect(s).toEqual([0, 32767, -32767, 16384, -16384, 32767, -32767, 0, 1]);
  });

  it('round-trips through the reader within one step', () => {
    const x = new Float32Array(1000).map((_, i) => Math.sin(i / 7) * 0.8);
    const back = decodeWav16(encodeWav16(x, 12000));
    expect(back).toMatchObject({ sampleRate: 12000, channels: 1, bitsPerSample: 16, frames: 1000 });
    for (let i = 0; i < x.length; i++) expect(Math.abs(back.samples[i] - x[i])).toBeLessThanOrEqual(0.5 / 32767 + 1e-7);
  });

  it('rejects files that are not PCM WAV', () => {
    expect(() => decodeWav16(new Uint8Array(44))).toThrow('Not a WAV file.');
  });
});
