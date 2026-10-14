import { describe, expect, it } from 'vitest';
import { normaliseCallsign, parsePortable, withArea } from './callsign';

describe('normaliseCallsign', () => {
  it('upper-cases and drops spaces and the angle brackets of hashed calls', () => {
    expect(normaliseCallsign(' vk3/9v1ne ')).toBe('VK3/9V1NE');
    expect(normaliseCallsign('<PJ4/K1ABC>')).toBe('PJ4/K1ABC');
    expect(normaliseCallsign('/K1ABC/')).toBe('K1ABC');
  });

  it('refuses anything but letters, digits and single slashes', () => {
    for (const s of ['', '/', 'K1#ABC', 'K1ABC//P', 'K1ABC-P']) expect(normaliseCallsign(s), s).toBe('');
  });
});

describe('parsePortable', () => {
  const p = (s: string) => parsePortable(s);

  it('finds the home call and a location prefix before it', () => {
    expect(p('VK3/9V1NE/P')).toEqual({ call: 'VK3/9V1NE/P', home: '9V1NE', location: 'VK3', area: null, mobile: null, ignored: ['P'] });
    expect(p('F/G3ABC')).toMatchObject({ home: 'G3ABC', location: 'F' });
    expect(p('KH6/W1AW')).toMatchObject({ home: 'W1AW', location: 'KH6' });
  });

  it('prefers the part with more letters after its digit as the home call', () => {
    expect(p('VP2E/W1AW')).toMatchObject({ home: 'W1AW', location: 'VP2E' });
    expect(p('W1AW/VP2E')).toMatchObject({ home: 'W1AW', location: 'VP2E' });
    expect(p('VK9X/K1ABC')).toMatchObject({ home: 'K1ABC', location: 'VK9X' });
  });

  it('reads parts after the home call as location, call area, mobile or designator', () => {
    expect(p('9V1NE/VK3')).toMatchObject({ location: 'VK3', ignored: [] });
    expect(p('DL1ABC/OE')).toMatchObject({ location: 'OE' });
    expect(p('K1ABC/6')).toMatchObject({ home: 'K1ABC', location: null, area: '6' });
    expect(p('9M6/PA0RRS/2')).toMatchObject({ home: 'PA0RRS', location: '9M6', area: '2' });
    expect(p('G4ABC/MM')).toMatchObject({ mobile: 'maritime', location: null });
    expect(p('K1ABC/AM')).toMatchObject({ mobile: 'aeronautical' });
    for (const [call, ignored] of [
      ['G3ABC/F', ['F']],
      ['LU1ABC/D', ['D']],
      ['K1ABC/LH', ['LH']],
      ['K1ABC/AE', ['AE']],
      ['K1ABC/QRP', ['QRP']],
      ['3V8CB/YOTA', ['YOTA']],
      ['2E0CCD/NHS', ['NHS']],
      ['K1ABC/P/QRP', ['P', 'QRP']],
    ] as const) {
      expect(p(call), call).toMatchObject({ location: null, ignored });
    }
  });

  it('keeps the first location when there are two', () => {
    expect(p('OH/DL1ABC/OH0')).toMatchObject({ home: 'DL1ABC', location: 'OH' });
  });

  it('handles calls without a digit and refuses non-callsigns', () => {
    expect(p('VERSION')).toMatchObject({ home: 'VERSION', location: null });
    expect(p('K1#ABC')).toBeNull();
    expect(p('')).toBeNull();
  });
});

describe('withArea', () => {
  it('replaces the call-area digit', () => {
    expect(withArea('K1ABC', '6')).toBe('K6ABC');
    expect(withArea('2E0ABC', '1')).toBe('2E1ABC');
    expect(withArea('EA8LU', '7')).toBe('EA7LU');
    expect(withArea('9M6', '2')).toBe('9M2');
    expect(withArea('F', '5')).toBe('F');
  });
});
