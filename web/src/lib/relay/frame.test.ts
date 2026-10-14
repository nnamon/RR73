import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_GAP, decodeFrame } from './frame';

/** The frames crates/rr73-qsp writes into fixtures/qsp: 512 samples of 1000 Hz at 8000. */
function fixture(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`../../../../fixtures/qsp/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// `+ 0` makes −0 zero: QSP's `as i16` has no −0.
const tone = Array.from({ length: 512 }, (_, i) => (Math.trunc(8000 * Math.sin((2 * Math.PI * 1000 * i) / 12000)) + 0) / 32768);

describe('QSP frames', () => {
  it('reads a PCM frame as QSP wrote it: header and every sample', () => {
    const f = decodeFrame(fixture('frame-pcm16.bin'));
    expect(f).not.toBeNull();
    expect(f!.seq).toBe(3);
    expect(f!.flags & FLAG_GAP).toBe(FLAG_GAP);
    expect(f!.utcMs).toBeCloseTo(1_792_000_000_123.456, 3);
    expect(Array.from(f!.samples)).toEqual(tone);
  });

  it('reads an ADPCM frame within 1% of the signal’s power once settled', () => {
    const f = decodeFrame(fixture('frame-adpcm.bin'))!;
    expect(f.samples).toHaveLength(512);
    let err = 0;
    let sig = 0;
    for (let i = 128; i < 512; i++) {
      err += (f.samples[i] - tone[i]) ** 2;
      sig += tone[i] ** 2;
    }
    expect(err / sig).toBeLessThan(0.01);
  });

  it('refuses short frames, other versions and unknown encodings', () => {
    expect(decodeFrame(new ArrayBuffer(10))).toBeNull();
    const b = fixture('frame-pcm16.bin');
    new DataView(b).setUint8(0, 2);
    expect(decodeFrame(b)).toBeNull();
    const c = fixture('frame-pcm16.bin');
    new DataView(c).setUint8(1, 9);
    expect(decodeFrame(c)).toBeNull();
    expect(decodeFrame(fixture('frame-pcm16.bin').slice(0, 100))).toBeNull();
  });
});
