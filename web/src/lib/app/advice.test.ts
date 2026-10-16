import { describe, expect, it } from 'vitest';
import { adviceFor } from './advice';

describe('adviceFor', () => {
  it('keeps the iOS words on iOS', () => {
    const a = adviceFor('ios');
    expect(a.hidden).toBe('RR73 left the screen, and iOS stops the microphone in the background.');
    expect(a.unsupported).toBe('This browser cannot capture audio. Open RR73 in Safari.');
    expect(a.denied).toBe('RR73 has no microphone access. Allow the microphone for this site in Safari settings, then start audio again.');
    expect(a.allowPrompt).toBe('Allow the microphone if Safari asks.');
    expect(a.screen).toBe('Follows Auto-Lock. Set it to Never.');
    expect(a.checklist).toEqual([
      { key: 'focus', title: 'Focus mode on', sub: 'Stops iOS sounds keying the radio' },
      { key: 'clicks', title: 'Keyboard clicks off' },
      { key: 'volume', title: 'Phone volume at maximum' },
    ]);
    expect(a.clockFix).toBe('Turn on Set Automatically in the phone’s Settings › General › Date & Time. It needs a network.');
    expect(a.copyRefused).toBe('The phone refused to copy. Select the report below and copy it.');
    expect(a.httpRefuser).toBe('Safari');
    expect(a.locationOff).toBe('Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.');
    expect(a.storageRefuser).toBe('This phone');
    expect(a.offline).toBe('No phone signal');
  });

  it('names Chrome, Edge and Windows Settings on Windows, and never iOS or Safari', () => {
    const a = adviceFor('windows');
    expect(a.unsupported).toBe('This browser cannot capture audio. Open RR73 in Chrome or Edge.');
    expect(a.denied).toContain('turn on Let desktop apps access your microphone in Windows Settings › Privacy & security › Microphone');
    expect(a.clockFix).toBe('In Windows Settings › Time & language › Date & time, turn on Set time automatically and select Sync now. It needs a network.');
    expect(a.checklist.map((c) => c.key)).toEqual(['sounds', 'output', 'power']);
    expect(a.checklist.map((c) => c.title)).toEqual(['System sounds off', 'Radio not the default output', 'Sleep set to Never']);
    expect(a.locationOff).toContain('Windows Settings › Privacy & security › Location');
    for (const p of ['windows', 'android', 'other'] as const) {
      const text = JSON.stringify(adviceFor(p));
      expect(text, p).not.toMatch(/iOS|Safari|Auto-Lock|Focus mode/);
    }
  });
});
