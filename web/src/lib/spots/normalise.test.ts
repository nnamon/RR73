import { describe, expect, it } from 'vitest';
import { baseCall, callsign, isSkimmer, mode, parseUtc, saysQrt, skimmerSnr, spotterCall, text } from './normalise';

describe('parseUtc', () => {
  const T = Date.UTC(2026, 9, 13, 5, 21, 25);

  it('reads a time without a zone as UTC, as POTA writes it', () => {
    expect(parseUtc('2026-10-13T05:21:25')).toBe(T);
    expect(parseUtc('2026-10-13 05:21:25')).toBe(T);
    expect(parseUtc(' 2026-10-13T05:21:25 ')).toBe(T);
  });

  it('honours Z and offsets', () => {
    expect(parseUtc('2026-10-13T05:21:25Z')).toBe(T);
    expect(parseUtc('2026-10-13T05:21:25z')).toBe(T);
    expect(parseUtc('2026-10-13T07:21:25+02:00')).toBe(T);
    expect(parseUtc('2026-10-13T07:21:25+0200')).toBe(T);
    expect(parseUtc('2026-10-12T19:21:25-10:00')).toBe(T);
  });

  it('reads fractions and times without seconds', () => {
    expect(parseUtc('2026-10-13T05:21:25.500')).toBe(T + 500);
    expect(parseUtc('2026-10-13T05:21')).toBe(T - 25_000);
  });

  it('reads epoch seconds and milliseconds', () => {
    expect(parseUtc(T / 1000)).toBe(T);
    expect(parseUtc(T)).toBe(T);
  });

  it('gives null for other text and impossible dates', () => {
    for (const v of ['', '13/10/2026 05:21', '2026-10-13', 'yesterday', '2026-13-45T00:00:00', null, undefined, {}, NaN, 0, -5]) {
      expect(parseUtc(v), String(v)).toBeNull();
    }
  });
});

describe('callsign', () => {
  it('upper-cases and keeps portable suffixes', () => {
    expect(callsign('w7qrp/p')).toBe('W7QRP/P');
    expect(callsign(' 9W2EZV ')).toBe('9W2EZV');
    expect(callsign('VK3/9V1NE')).toBe('VK3/9V1NE');
  });

  it('refuses text that cannot be a callsign', () => {
    for (const v of ['', 'DEPRECATED', 'K-TEST', 'AB', '1234', 'W1 AW', null, 7, undefined]) expect(callsign(v), String(v)).toBe('');
  });
});

describe('baseCall', () => {
  it('drops portable suffixes only', () => {
    expect(baseCall('W7QRP/P')).toBe('W7QRP');
    expect(baseCall('JA4RQO/9')).toBe('JA4RQO');
    expect(baseCall('G4ABC/M')).toBe('G4ABC');
    expect(baseCall('G4ABC/MM')).toBe('G4ABC');
    expect(baseCall('K1ABC/QRP')).toBe('K1ABC');
    expect(baseCall('VK3/9V1NE')).toBe('VK3/9V1NE');
    expect(baseCall('ZL1KS')).toBe('ZL1KS');
  });
});

describe('spotters', () => {
  it('drops the skimmer suffix', () => {
    expect(spotterCall('JI1HFJ-#')).toBe('JI1HFJ');
    expect(spotterCall('k9imm-#')).toBe('K9IMM');
    expect(spotterCall('VK2ESN')).toBe('VK2ESN');
    expect(spotterCall(null)).toBe('');
  });

  it('recognises skimmer spots by spotter or comments', () => {
    expect(isSkimmer('JI1HFJ-#', '')).toBe(true);
    expect(isSkimmer('X', 'RBN -10 dB via K9IMM-#')).toBe(true);
    expect(isSkimmer('X', '[RBNHole] at W6')).toBe(true);
    expect(isSkimmer('JE1QEV', 'FT8')).toBe(false);
  });
});

describe('skimmerSnr', () => {
  it('reads the SNR in RBN comments', () => {
    expect(skimmerSnr('RBN -15 dB via JI1HFJ-#')).toBe(-15);
    expect(skimmerSnr('RBN 19 dB 22 WPM via JA1CCA-#')).toBe(19);
    expect(skimmerSnr('RBN +5 dB via X')).toBe(5);
    expect(skimmerSnr('RBN −12 dB via X')).toBe(-12);
  });

  it('gives null without a dB figure', () => {
    expect(skimmerSnr('FT8 Sent: -14 Rcvd: +00')).toBeNull();
    expect(skimmerSnr('')).toBeNull();
    expect(skimmerSnr('RBN 140 dB')).toBeNull();
  });
});

describe('text fields', () => {
  it('collapses white space and ignores non-strings', () => {
    expect(text('  FT8  Sent: -14  Rcvd: +00 ')).toBe('FT8 Sent: -14 Rcvd: +00');
    expect(text(null)).toBe('');
    expect(text(5)).toBe('');
    expect(mode(' ssb ')).toBe('SSB');
  });

  it('spots QRT in comments', () => {
    expect(saysQrt('QRT,next JP-1498')).toBe(true);
    expect(saysQrt('qrt tnx')).toBe(true);
    expect(saysQrt('QRT.  SRI TRST')).toBe(true);
    expect(saysQrt('QRTX')).toBe(false);
    expect(saysQrt('Cq')).toBe(false);
  });
});
