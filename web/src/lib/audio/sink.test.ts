import { describe, expect, it, vi } from 'vitest';
import { applySink, inputChoices, matchInput, matchOutput, outputChange, outputChoices, outputChoiceSupported } from './sink';

const device = (kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo => ({ kind, deviceId, label, groupId: '', toJSON: () => ({}) });

describe('output choice', () => {
  it('is supported where AudioContext has setSinkId', () => {
    expect(outputChoiceSupported({ setSinkId() {} })).toBe(true);
    expect(outputChoiceSupported({})).toBe(false);
    expect(outputChoiceSupported(undefined)).toBe(false);
  });

  it('switches the context and says why it could not', async () => {
    const ok = { setSinkId: vi.fn(async () => undefined) };
    expect(await applySink(ok, 'codec-1')).toBeNull();
    expect(ok.setSinkId).toHaveBeenLastCalledWith('codec-1');
    expect(await applySink(ok, null)).toBeNull();
    expect(ok.setSinkId).toHaveBeenLastCalledWith('');
    const gone = { setSinkId: async () => Promise.reject(new DOMException('gone', 'NotFoundError')) };
    expect(await applySink(gone, 'codec-1')).toBe('missing');
    const refused = { setSinkId: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) };
    expect(await applySink(refused, 'codec-1')).toBe('failed');
    // Safari: no setSinkId. The default needs no switch.
    expect(await applySink({}, 'codec-1')).toBe('unsupported');
    expect(await applySink({}, null)).toBeNull();
  });

  it('lists the outputs without the browser’s default entry or unnamed devices', () => {
    const list = [device('audioinput', 'mic'), device('audiooutput', 'default', 'Default'), device('audiooutput', ''), device('audiooutput', 'codec-1', 'USB Audio')];
    expect(outputChoices(list).map((d) => d.deviceId)).toEqual(['codec-1']);
  });

  it('tells when the chosen output goes and comes back', () => {
    const withCodec = [device('audiooutput', 'speakers'), device('audiooutput', 'codec-1')];
    const without = [device('audiooutput', 'speakers')];
    expect(outputChange('codec-1', true, without, null)).toBe('gone');
    expect(outputChange('codec-1', false, withCodec, null)).toBe('back');
    // Missing when the context switched, listed now.
    expect(outputChange('codec-1', true, withCodec, 'missing')).toBe('back');
    expect(outputChange('codec-1', true, withCodec, null)).toBeNull();
    expect(outputChange('codec-1', false, without, 'missing')).toBeNull();
    // Refused by the browser, as before the microphone was allowed: any change tries it again.
    expect(outputChange('codec-1', true, withCodec, 'failed')).toBe('back');
    expect(outputChange('codec-1', true, without, 'failed')).toBe('gone');
    // The system default has nothing to lose.
    expect(outputChange(null, true, without, null)).toBeNull();
    // Without microphone permission the list has no IDs and tells nothing.
    expect(outputChange('codec-1', true, [device('audiooutput', '')], null)).toBeNull();
  });

  it('finds the chosen output again by its name when its ID changed', () => {
    const list = [device('audiooutput', 'speakers', 'Speakers'), device('audiooutput', 'new-id', 'USB Audio CODEC')];
    expect(matchOutput(list, 'new-id', 'USB Audio CODEC')).toBe('new-id');
    expect(matchOutput(list, 'old-id', 'USB Audio CODEC')).toBe('new-id');
    // Not listed under either: keep the saved ID, which reports missing.
    expect(matchOutput(list, 'old-id', 'Headphones')).toBe('old-id');
    expect(matchOutput(list, 'old-id', '')).toBe('old-id');
    // Two devices of that name: no guess.
    const two = [...list, device('audiooutput', 'other-id', 'USB Audio CODEC')];
    expect(matchOutput(two, 'old-id', 'USB Audio CODEC')).toBe('old-id');
  });

  it('finds the chosen input again by its name when its ID changed, among inputs only', () => {
    const list = [
      device('audioinput', 'default', 'Default - Microphone (USB Audio CODEC)'),
      device('audioinput', 'communications', 'Communications - Microphone (USB Audio CODEC)'),
      device('audioinput', 'mic', 'Microphone Array'),
      device('audioinput', 'new-in', 'Microphone (USB Audio CODEC)'),
      device('audiooutput', 'out', 'Microphone (USB Audio CODEC)'),
    ];
    expect(inputChoices(list).map((d) => d.deviceId)).toEqual(['mic', 'new-in']);
    expect(matchInput(list, 'new-in', 'Microphone (USB Audio CODEC)')).toBe('new-in');
    expect(matchInput(list, 'old-in', 'Microphone (USB Audio CODEC)')).toBe('new-in');
    expect(matchInput(list, 'old-in', 'Line In')).toBe('old-in');
    const two = [...list, device('audioinput', 'other-in', 'Microphone (USB Audio CODEC)')];
    expect(matchInput(two, 'old-in', 'Microphone (USB Audio CODEC)')).toBe('old-in');
  });
});
