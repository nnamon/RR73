import { describe, expect, it } from 'vitest';
import { detectDigital, DIALS, digitalByFrequency } from './digital';

const kHz = (k: number) => Math.round(k * 1000);

describe('the dial table', () => {
  it('matches the documented table, kHz', () => {
    expect(DIALS.map((d) => `${d.mode} ${d.hz / 1000}`)).toEqual([
      'FT8 1840',
      'FT8 3573',
      'FT4 3575',
      'FT8 5357',
      'FT8 7074',
      'FT4 7047.5',
      'FT8 10136',
      'FT4 10140',
      'FT8 14074',
      'FT4 14080',
      'FT8 18100',
      'FT4 18104',
      'FT8 21074',
      'FT4 21140',
      'FT8 24915',
      'FT4 24919',
      'FT8 28074',
      'FT4 28180',
      'FT8 50313',
      'FT4 50318',
      'FT8 144174',
    ]);
  });
});

describe('digitalByFrequency', () => {
  it.each([
    [14074, 'FT8'],
    [14073.6, 'FT8'],
    [14076.9, 'FT8'],
    [14077, 'FT8'],
    [14080, 'FT4'],
    [14082.5, 'FT4'],
    [7047.5, 'FT4'],
    [5356.5, 'FT8'],
    [1840, 'FT8'],
    [24915, 'FT8'],
    [21076.9, 'FT8'],
    [144174, 'FT8'],
    [144175.7, 'FT8'],
    // 30m: FT8 audio 2500 Hz sits nearer the FT4 dial but below it.
    [10138.5, 'FT8'],
    [10140.2, 'FT4'],
    // 80m windows overlap: the nearer dial wins.
    [3574.9, 'FT4'],
    [3574.0, 'FT8'],
  ])('%s kHz is %s', (f, mode) => {
    expect(digitalByFrequency(kHz(f))).toBe(mode);
  });

  it.each([14073.4, 14077.1, 14030, 7030, 5355.5, 5353, 10123, 18099.4, 144300, 432222])('%s kHz is neither', (f) => {
    expect(digitalByFrequency(kHz(f))).toBeNull();
  });
});

describe('detectDigital', () => {
  it('takes FT8 and FT4 from the mode in any case', () => {
    expect(detectDigital('FT8', '', null)).toBe('FT8');
    expect(detectDigital('ft4', '', null)).toBe('FT4');
    expect(detectDigital('FT-8', '', null)).toBe('FT8');
  });

  it('keeps a specific mode over the comments and the frequency', () => {
    expect(detectDigital('CW', 'FT8 later', kHz(14074))).toBeNull();
    expect(detectDigital('SSB', 'FT8', null)).toBeNull();
    expect(detectDigital('FT8', 'FT4 next', kHz(14080))).toBe('FT8');
  });

  it('reads the comments when the mode is empty or generic', () => {
    expect(detectDigital('', 'FT8', null)).toBe('FT8');
    expect(detectDigital('', 'ft8', kHz(5355.5))).toBe('FT8');
    expect(detectDigital('DATA', 'ft4 14.080 up 1500', null)).toBe('FT4');
    expect(detectDigital('MFSK', 'FT4', null)).toBe('FT4');
    expect(detectDigital('DIGI', 'calling on FT 8', null)).toBe('FT8');
    expect(detectDigital('', 'FT4/FT8', null)).toBe('FT4');
    expect(detectDigital('OTHER', 'QRP FT-8', null)).toBe('FT8');
    expect(detectDigital('', '<TR> FT8 -6 dB 813 Hz', kHz(144174))).toBe('FT8');
  });

  it('needs a whole word in the comments', () => {
    expect(detectDigital('', 'SOFT8 antenna', null)).toBeNull();
    expect(detectDigital('', 'FT88', null)).toBeNull();
  });

  it('falls back to the frequency without a mode', () => {
    expect(detectDigital('', '', kHz(7074))).toBe('FT8');
    expect(detectDigital('', 'CQ, tnx new one digi', kHz(1840))).toBe('FT8');
    expect(detectDigital('DIGI', 'IOTA OC-016', kHz(24915))).toBe('FT8');
    expect(detectDigital('', 'cq dx', kHz(14195))).toBeNull();
    expect(detectDigital('', '', null)).toBeNull();
  });

  it('lets a comment naming another mode rule out the frequency', () => {
    expect(detectDigital('', 'wspr sign -35', kHz(10138.7))).toBeNull();
    expect(detectDigital('', 'JS8 net', kHz(14078))).toBeNull();
    expect(detectDigital('', 'JT65 -12', kHz(14076))).toBeNull();
    expect(detectDigital('', 'CW 599', kHz(7074))).toBeNull();
    expect(detectDigital('', '58 usb', kHz(144174))).toBeNull();
  });
});
