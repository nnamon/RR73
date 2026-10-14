import { describe, expect, it } from 'vitest';
import { ReferenceFormatError } from './format';
import { LotwIndex, daysSince } from './lotw';

const JSON_LIST = {
  format: 1,
  latest: '2026-10-11',
  count: 5,
  byDate: { '2014-02-08': '1A0KM', '2026-10-07': 'W1AW W1AW/4', '2026-10-11': '9V1NE', '2020-04-19': '2E0CCD/NHS' },
};

describe('LotwIndex', () => {
  const lotw = LotwIndex.fromJson(JSON_LIST);

  it('finds callsigns as given', () => {
    expect([lotw.latest, lotw.count]).toEqual(['2026-10-11', 5]);
    expect(lotw.lookup('9V1NE')).toEqual({ call: '9V1NE', lastUpload: '2026-10-11', via: 'exact' });
    expect(lotw.lookup('w1aw/4')).toEqual({ call: 'W1AW/4', lastUpload: '2026-10-07', via: 'exact' });
    expect(lotw.lookup('1A0KM')?.lastUpload).toBe('2014-02-08');
  });

  it('falls back to the home call of a portable callsign', () => {
    expect(lotw.lookup('VK3/9V1NE/P')).toEqual({ call: '9V1NE', lastUpload: '2026-10-11', via: 'home' });
    expect(lotw.lookup('2E0CCD/NHS')?.via).toBe('exact');
  });

  it('returns null for callsigns not in the list and for text that is not a callsign', () => {
    expect(lotw.lookup('K1ABC')).toBeNull();
    expect(lotw.lookup('K1#ABC')).toBeNull();
  });

  it('refuses malformed data', () => {
    expect(() => LotwIndex.fromJson({ ...JSON_LIST, format: 2 })).toThrow(ReferenceFormatError);
    expect(() => LotwIndex.fromJson({ ...JSON_LIST, byDate: { yesterday: 'K1ABC' } })).toThrow(/not a date/);
  });
});

describe('daysSince', () => {
  it('counts whole UTC days', () => {
    expect(daysSince('2026-10-11', new Date('2026-10-13T23:59:00Z'))).toBe(2);
    expect(daysSince('2026-10-13', new Date('2026-10-13T00:00:00Z'))).toBe(0);
    expect(daysSince('2025-10-13', new Date('2026-10-13T12:00:00Z'))).toBe(365);
  });
});
