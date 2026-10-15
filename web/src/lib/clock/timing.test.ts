import { describe, expect, it } from 'vitest';
import { TimingLog, findOwnDecode, timingReport, type TimingSnapshot } from './timing';

const T0 = Date.UTC(2026, 9, 13, 13, 51, 0);

describe('TimingLog', () => {
  it('keeps the smallest capture lag over the last 64 chunks', () => {
    const log = new TimingLog();
    expect(log.captureLagMs).toBeNull();
    // A main-thread stall delivers a burst late; the smallest lag still shows the stamp delay.
    [0.8, 0.85, 0.81, 1.9, 0.803].forEach((s) => log.lag(s));
    expect(log.captureLagMs).toBeCloseTo(800, 6);
    for (let i = 0; i < 64; i++) log.lag(0.004);
    expect(log.captureLagMs).toBeCloseTo(4, 6);
    log.restart();
    expect(log.captureLagMs).toBeNull();
  });

  it('pairs each stop with the mapping once settled after the resume', () => {
    const log = new TimingLog();
    log.settled(T0, 30); // the first start has no stop before it
    expect(log.resumes).toEqual([]);
    log.stopped(T0 + 1000, 30.2);
    log.settled(T0 + 9000, 31.1);
    log.settled(T0 + 9500, 99); // only the first settle after a stop counts
    expect(log.resumes).toEqual([{ stoppedAtUtcMs: T0 + 1000, beforeMs: 30.2, resumedAtUtcMs: T0 + 9000, afterMs: 31.1 }]);
    for (let i = 0; i < 6; i++) log.stopped(T0 + 20000 + i, null);
    expect(log.resumes).toHaveLength(5);
  });
});

describe('findOwnDecode', () => {
  const sent = { text: 'CQ N0CALL EM12', f0Hz: 1200 };
  it('finds the transmission by its text', () => {
    const d = findOwnDecode(sent, [
      { text: 'K1ABC W9XYZ -05', freq_hz: 1201, dt_s: 0.1, snr_db: 30 },
      { text: 'CQ  n0call EM12', freq_hz: 1200, dt_s: -0.7, snr_db: 20 },
    ]);
    expect(d?.dt_s).toBe(-0.7);
  });

  it('falls back to the strongest decode within 10 Hz of the Tx frequency', () => {
    const d = findOwnDecode({ text: 'CQ EA5/N0CALL', f0Hz: 1200 }, [
      { text: 'CQ <EA5/N0CALL>', freq_hz: 1206, dt_s: 0.1, snr_db: 22 },
      { text: 'CQ K1ABC FN42', freq_hz: 1500, dt_s: 0.0, snr_db: 25 },
    ]);
    expect(d?.text).toBe('CQ <EA5/N0CALL>');
    expect(findOwnDecode(sent, [{ text: 'CQ K1ABC FN42', freq_hz: 1500, dt_s: 0, snr_db: 25 }])).toBeNull();
  });
});

describe('timingReport', () => {
  it('carries every value and the raw clock readings', () => {
    const snap: TimingSnapshot = {
      atUtcMs: T0,
      appVersion: '0.7.3',
      audio: 'running',
      source: 'output',
      offsetMs: 31.25,
      driftPpm: 412.4,
      captureLagMs: 3.5,
      gaps: 12,
      gapMs: 820,
      inputOffsetS: 0.08,
      medianDtS: -0.8,
      clockS: 0.88,
      strongDecodes: 23,
      heardBack: [
        { slotStartUtcMs: T0 - 30000, text: 'CQ N0CALL EM12', dtS: -0.7, snrDb: 24 },
        { slotStartUtcMs: T0 - 60000, text: 'CQ N0CALL EM12', dtS: null, snrDb: null },
      ],
      resumes: [{ stoppedAtUtcMs: T0 - 120000, beforeMs: 30.5, resumedAtUtcMs: T0 - 100000, afterMs: 31 }],
      readings: [{ contextTime: 12.5, performanceTime: 13030.5, perfNow: 13001.25, dateNow: T0, currentTime: 12.53 }],
      observations: [1791899429.5, 1791899430],
    };
    expect(timingReport(snap)).toBe(
      [
        'RR73 0.7.3 timing report, 2026-10-13T13:51:00Z',
        'Audio: running',
        'Clock source: output timestamps',
        'Mapping offset: 31.3 ms',
        'Clock drift: 412 ppm',
        'Capture lag: 3.5 ms',
        'Audio gaps bridged: 12, 820.0 ms',
        'Input offset: 0.080 s',
        'Median DT: −0.800 s from 23 decodes at -10 dB or stronger',
        'Phone clock by the decodes: 0.880 s slow',
        'Your Tx, heard back:',
        '  13:50:30 CQ N0CALL EM12: DT −0.70 s, SNR 24 dB',
        '  13:50:00 CQ N0CALL EM12: not heard',
        'Stops and resumes (mapping offset before, after):',
        '  13:49:00 to 13:49:20: 30.5 ms, 31.0 ms',
        'Mapper observations (UTC ms minus audio-clock ms): 1791899429.5 1791899430.0',
        'Clock readings (contextTime s, performanceTime ms, perfNow ms, dateNow ms, currentTime s):',
        `  12.500000 13030.500 13001.250 ${T0} 12.530000`,
      ].join('\n'),
    );
  });
});
