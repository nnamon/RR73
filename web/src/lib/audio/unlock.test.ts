import { describe, expect, it, vi } from 'vitest';
import { CLIP_RATE, START_TONE, playClip, silentClipUri, startToneSamples, wavDataUri } from './unlock';

function decode(uri: string): DataView {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new DataView(bytes.buffer);
}

describe('wavDataUri', () => {
  it('writes a 16-bit mono PCM WAV of the samples', () => {
    const v = decode(wavDataUri(new Float32Array([0, 0.5, -1, 1]), 8000));
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 16384, -32767, 32767]);
  });

  it('gives a silent clip of digital zeros', () => {
    const v = decode(silentClipUri());
    for (let i = 44; i < v.byteLength; i++) expect(v.getUint8(i)).toBe(0);
  });
});

describe('startToneSamples', () => {
  const s = startToneSamples(0.5);
  const lead = Math.round(START_TONE.leadS * CLIP_RATE);
  const tone = Math.round(START_TONE.toneS * CLIP_RATE);

  /** Amplitude at `hz` over [from, from + n) samples of the clip (Hann-windowed single-bin DFT). */
  function at(hz: number, from: number, n: number): number {
    let re = 0;
    let im = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
      const a = (2 * Math.PI * hz * i) / CLIP_RATE;
      re += h * s[from + i] * Math.cos(a);
      im -= h * s[from + i] * Math.sin(a);
      w += h;
    }
    return (2 * Math.hypot(re, im)) / w;
  }

  it('is silent for the lead so the microphone can open first', () => {
    expect(s.subarray(0, lead).every((x) => x === 0)).toBe(true);
  });

  it('peaks at the output level and is silent after the chime', () => {
    const peak = s.subarray(lead, lead + tone).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeCloseTo(0.5, 6);
    expect(s.subarray(lead + tone).every((x) => x === 0)).toBe(true);
  });

  it('rises from E5 to A5', () => {
    const n = Math.round(0.1 * CLIP_RATE);
    const first = lead + Math.round(0.02 * CLIP_RATE);
    const second = lead + Math.round(0.24 * CLIP_RATE);
    expect(at(659.25, first, n)).toBeGreaterThan(5 * at(880, first, n));
    expect(at(880, second, n)).toBeGreaterThan(5 * at(659.25, second, n));
  });

  it('fades in and out without a step', () => {
    expect(Math.abs(s[lead])).toBeLessThan(0.01);
    expect(Math.abs(s[lead + tone - 1])).toBeLessThan(0.01);
    let jump = 0;
    for (let i = lead + 1; i < lead + tone; i++) jump = Math.max(jump, Math.abs(s[i] - s[i - 1]));
    // A 880 Hz sine at 0.5 peak moves at most 0.23 per sample at 12 kHz; a click would be larger.
    expect(jump).toBeLessThan(0.25);
  });
});

describe('playClip', () => {
  function fakeDoc(play: () => Promise<void>) {
    const el = {
      src: '',
      attrs: new Set<string>(),
      setAttribute(n: string) {
        this.attrs.add(n);
      },
      play: vi.fn(play),
    };
    return { el, doc: { createElement: vi.fn(() => el) } as unknown as Document };
  }

  it('plays the clip inline through a media element and returns the call time', () => {
    const { el, doc } = fakeDoc(async () => undefined);
    const at = playClip('data:audio/wav;base64,AAAA', doc, () => 1234);
    expect(at).toBe(1234);
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.src).toBe('data:audio/wav;base64,AAAA');
    expect(el.attrs.has('playsinline')).toBe(true);
  });

  it('ignores browsers that refuse to play', () => {
    const { doc } = fakeDoc(() => Promise.reject(new Error('NotAllowedError')));
    expect(() => playClip(silentClipUri(), doc)).not.toThrow();
  });
});
