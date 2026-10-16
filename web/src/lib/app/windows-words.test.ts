// The app's words on a Windows computer: the device is a computer, and the advice names the
// browser and Windows Settings. Every other unit test runs as on an iPhone (src/test-setup.ts).
import { describe, expect, it, vi } from 'vitest';

vi.mock('./platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('./platform')>();
  return { ...real, platform: 'windows', device: 'computer', Device: 'Computer' };
});

import { STATUS } from '../qso/status';
import { checkAddress, say } from '../log/wavelog';
import { locateGrid } from '../location/locate';
import { timingReport, type TimingSnapshot } from '../clock/timing';

describe('on Windows', () => {
  it('names the computer, the browser and Windows Settings', async () => {
    expect(STATUS.clock('1.2 s slow')).toBe('Computer clock 1.2 s slow');
    expect(checkAddress('http://log.example.com')).toEqual({ ok: false, message: 'Use the https address of your Wavelog. The browser does not let RR73 use plain http.' });
    expect(say.unreachable('log.example.com', false)).toBe('Could not reach Wavelog at log.example.com. Check the address and that this computer is online.');
    const refused = { getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code: 1, message: '' } as GeolocationPositionError) } as Geolocation;
    await expect(locateGrid(6, refused)).resolves.toEqual({
      ok: false,
      message: 'Location is off for RR73. Allow it for this site in the browser’s site settings and in Windows Settings › Privacy & security › Location, or type the grid.',
    });
    const snap = { atUtcMs: 0, appVersion: '0.0.0 (local)', audio: 'off', source: null, offsetMs: null, driftPpm: null, captureLagMs: null, gaps: 0, gapMs: 0, inputOffsetS: 0, medianDtS: null, clockS: 1.2, strongDecodes: 0, heardBack: [], resumes: [], readings: [], observations: [] } as unknown as TimingSnapshot;
    expect(timingReport(snap)).toContain('Computer clock by the decodes: 1.200 s slow');
  });
});
