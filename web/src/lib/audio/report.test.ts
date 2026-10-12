import { describe, expect, it } from 'vitest';
import { RateMeter, captureConstraints, readReport } from './report';

describe('captureConstraints', () => {
  it('turns off voice processing and asks for one channel', () => {
    const c = captureConstraints(null).audio as MediaTrackConstraints;
    expect(c).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
    expect(c.deviceId).toBeUndefined();
    expect((captureConstraints('abc').audio as MediaTrackConstraints).deviceId).toEqual({ exact: 'abc' });
  });
});

describe('readReport', () => {
  it('reads what the browser applied', () => {
    const r = readReport(
      { label: 'Headset Microphone', getSettings: () => ({ deviceId: 'd1', echoCancellation: false, sampleRate: 24000, channelCount: 2 }) },
      48000,
      'play-and-record',
    );
    expect(r).toMatchObject({
      inputLabel: 'Headset Microphone',
      deviceId: 'd1',
      contextRate: 48000,
      trackRate: 24000,
      trackChannels: 2,
      echoCancellation: false,
      noiseSuppression: null,
      autoGainControl: null,
      audioSession: 'play-and-record',
    });
  });

  it('names an unlabelled input and leaves missing numbers empty', () => {
    const r = readReport({ label: '', getSettings: () => ({}) }, 44100, null);
    expect(r.inputLabel).toBe('Microphone');
    expect(r.trackRate).toBeNull();
    expect(r.trackChannels).toBeNull();
  });
});

describe('RateMeter', () => {
  it('measures the audio clock against the wall clock after 5 s', () => {
    const m = new RateMeter();
    m.add(1000, 0.5);
    m.add(4000, 3.5);
    expect(m.rate(48000)).toBeNull();
    m.add(11000, 10.5 * 0.92); // a clock running at 92 %
    expect(m.rate(48000)).toBeCloseTo((48000 * (10.5 * 0.92 - 0.5)) / 10, 6);
    m.reset();
    expect(m.rate(48000)).toBeNull();
  });
});
