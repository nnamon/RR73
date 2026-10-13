import { describe, expect, it } from 'vitest';
import { bandOfHz, parseFrequencyHz } from './frequency';

describe('bandOfHz', () => {
  it('names the ADIF band, edges included', () => {
    expect(bandOfHz(14_000_000)).toBe('20m');
    expect(bandOfHz(14_074_000)).toBe('20m');
    expect(bandOfHz(14_350_000)).toBe('20m');
    expect(bandOfHz(14_350_001)).toBeNull();
    expect(bandOfHz(1_840_000)).toBe('160m');
    expect(bandOfHz(5_357_000)).toBe('60m');
    expect(bandOfHz(7_010_500)).toBe('40m');
    expect(bandOfHz(50_313_000)).toBe('6m');
    expect(bandOfHz(144_300_000)).toBe('2m');
    expect(bandOfHz(1_296_200_000)).toBe('23cm');
    expect(bandOfHz(10_368_100_000)).toBe('3cm');
    expect(bandOfHz(136_000)).toBe('2190m');
    expect(bandOfHz(475_000)).toBe('630m');
  });

  it('gives null between bands', () => {
    expect(bandOfHz(12_000_000)).toBeNull();
    expect(bandOfHz(27_555_000)).toBeNull();
    expect(bandOfHz(0)).toBeNull();
  });
});

describe('parseFrequencyHz from a kHz source (POTA)', () => {
  it('reads kHz as text and as a number', () => {
    expect(parseFrequencyHz('14074', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('7010.5', 'kHz')).toBe(7_010_500);
    expect(parseFrequencyHz(' 28074 ', 'kHz')).toBe(28_074_000);
    expect(parseFrequencyHz(7074, 'kHz')).toBe(7_074_000);
    expect(parseFrequencyHz('50313', 'kHz')).toBe(50_313_000);
    expect(parseFrequencyHz('144300', 'kHz')).toBe(144_300_000);
    expect(parseFrequencyHz('1296200', 'kHz')).toBe(1_296_200_000);
    expect(parseFrequencyHz('10368100', 'kHz')).toBe(10_368_100_000);
  });

  it('reads MHz and Hz typed into the kHz field', () => {
    expect(parseFrequencyHz('14.074', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('7.0475', 'kHz')).toBe(7_047_500);
    expect(parseFrequencyHz('147.52', 'kHz')).toBe(147_520_000);
    expect(parseFrequencyHz('14074000', 'kHz')).toBe(14_074_000);
  });

  it('keeps LF and MF spots in kHz', () => {
    expect(parseFrequencyHz('136', 'kHz')).toBe(136_000);
    expect(parseFrequencyHz('475', 'kHz')).toBe(475_000);
  });

  it('honours a written unit', () => {
    expect(parseFrequencyHz('14.074 MHz', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('14.074MHz', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('14074 kHz', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('7074000 Hz', 'kHz')).toBe(7_074_000);
    expect(parseFrequencyHz('10.368 GHz', 'kHz')).toBe(10_368_000_000);
    expect(parseFrequencyHz('14074 khz', 'kHz')).toBe(14_074_000);
  });

  it('reads commas as decimals or as thousands', () => {
    expect(parseFrequencyHz('14,074', 'kHz')).toBe(14_074_000);
    expect(parseFrequencyHz('14,074.5', 'kHz')).toBe(14_074_500);
    expect(parseFrequencyHz('1,296,200', 'kHz')).toBe(1_296_200_000);
  });

  it('keeps a number outside every band in the source unit', () => {
    expect(parseFrequencyHz('1407', 'kHz')).toBe(1_407_000);
    expect(parseFrequencyHz('27555', 'kHz')).toBe(27_555_000);
  });

  it('gives null for anything without a positive number', () => {
    for (const v of ['', '   ', 'abc', 'QRT', '0', '-14074', '14.07.4', '14074 W', null, undefined, {}, [], NaN, -7074, 0, Infinity]) {
      expect(parseFrequencyHz(v, 'kHz'), String(v)).toBeNull();
    }
  });
});

describe('parseFrequencyHz from a MHz source', () => {
  it('reads MHz, and kHz typed into the MHz field', () => {
    expect(parseFrequencyHz('14.062', 'MHz')).toBe(14_062_000);
    expect(parseFrequencyHz('432.1', 'MHz')).toBe(432_100_000);
    expect(parseFrequencyHz('14062', 'MHz')).toBe(14_062_000);
    expect(parseFrequencyHz('7032', 'MHz')).toBe(7_032_000);
  });

  it('keeps microwave spots in MHz', () => {
    expect(parseFrequencyHz('5760', 'MHz')).toBe(5_760_000_000);
    expect(parseFrequencyHz('10368.1', 'MHz')).toBe(10_368_100_000);
  });
});
