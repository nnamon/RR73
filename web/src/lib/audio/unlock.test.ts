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

  it('is silent for the lead so the microphone can open first', () => {
    expect(s.subarray(0, lead).every((x) => x === 0)).toBe(true);
  });

  it('plays the tone at the output level for its length, then stops', () => {
    const body = s.subarray(lead, lead + tone);
    const peak = body.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.49);
    expect(peak).toBeLessThanOrEqual(0.5);
    expect(s.subarray(lead + tone).every((x) => x === 0)).toBe(true);
  });

  it('is a 1500 Hz tone', () => {
    const body = s.subarray(lead + 200, lead + tone - 200);
    let crossings = 0;
    for (let i = 1; i < body.length; i++) if (body[i - 1] < 0 && body[i] >= 0) crossings++;
    expect((crossings / body.length) * CLIP_RATE).toBeCloseTo(START_TONE.hz, -1);
  });

  it('ramps in and out without a step', () => {
    expect(Math.abs(s[lead])).toBeLessThan(0.01);
    expect(Math.abs(s[lead + tone - 1])).toBeLessThan(0.01);
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
