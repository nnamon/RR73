import { describe, expect, it } from 'vitest';
import { SlotRecorder, slotFiles } from './recorder';
import { decodeWav16 } from './wav';
import type { AssembledSlot } from './assembler';

const T = Date.UTC(2026, 9, 13, 13, 14, 15);

function slot(startUtcMs: number, fill = 0.25): AssembledSlot {
  return { mode: 'FT8', startUtcMs, samples: new Float32Array(180000).fill(fill), filled: 180000, lateStart: false, gap: false };
}

const META = { dialHz: 14074000, input: 'Headset Microphone', captureRateHz: 48000, appVersion: '0.1.0', offsetS: 0 };

describe('SlotRecorder', () => {
  it('keeps the newest slots up to its capacity, newest first', () => {
    const r = new SlotRecorder(3);
    for (let i = 0; i < 5; i++) r.add(slot(T + i * 15000));
    expect(r.list().map((s) => s.startUtcMs)).toEqual([T + 60000, T + 45000, T + 30000]);
    expect(r.get(T)).toBeUndefined();
    expect(r.get(T + 45000)?.startUtcMs).toBe(T + 45000);
  });

  it('replaces a slot with the same start', () => {
    const r = new SlotRecorder();
    r.add(slot(T, 0.1));
    r.add(slot(T, 0.2));
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0].samples[0]).toBeCloseTo(0.2, 6);
    r.clear();
    expect(r.list()).toEqual([]);
  });
});

describe('slotFiles', () => {
  it('writes a 12 kHz 16-bit mono WAV of exactly one FT8 slot', () => {
    const f = slotFiles(slot(T), META);
    expect(f.stem).toBe('261013_131415');
    const w = decodeWav16(f.wav);
    expect(w).toMatchObject({ sampleRate: 12000, channels: 1, bitsPerSample: 16, frames: 180000 });
  });

  it('writes the sidecar in the corpus format', () => {
    const s = { ...slot(T), filled: 93000, lateStart: true, gap: false };
    const json = JSON.parse(slotFiles(s, { ...META, offsetS: -0.25 }).json);
    expect(json).toEqual({
      format: 'rr73-slot/1',
      mode: 'FT8',
      start_utc: '2026-10-13T13:14:15Z',
      sample_rate: 12000,
      dial_hz: 14074000,
      source: { kind: 'kx2', input: 'Headset Microphone', capture_rate_hz: 48000, app: 'rr73-web 0.1.0' },
      timing: { reference: 'phone', offset_s: -0.25 },
      noise_only: false,
      truth: null,
      reference: {},
      capture: { filled_samples: 93000, late_start: true, gap: false },
    });
  });
});

describe('SlotRecorder with WSPR slots', () => {
  it('keeps 2 WSPR slots beside the FT8 ones', () => {
    const r = new SlotRecorder(8, { WSPR: 2 });
    const wspr = (start: number): AssembledSlot => ({ mode: 'WSPR', startUtcMs: start, samples: new Float32Array(10), filled: 10, lateStart: false, gap: false });
    r.add(slot(T));
    for (let i = 0; i < 4; i++) r.add(wspr(T + 120_000 * (i + 1)));
    expect(r.list().map((s) => [s.mode, (s.startUtcMs - T) / 1000])).toEqual([
      ['WSPR', 480],
      ['WSPR', 360],
      ['FT8', 0],
    ]);
  });
});

