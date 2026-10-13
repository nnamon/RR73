import { describe, expect, it } from 'vitest';
import { toYou } from './focus';

describe('toYou', () => {
  it('is true when the operator is the addressee, by base call', () => {
    expect(toYou('9V1NE JA1KXM PM95', '9V1NE')).toBe(true);
    expect(toYou('9V1NE JA1KXM RR73', '9v1ne')).toBe(true);
    // Portable forms on either side.
    expect(toYou('9V1NE JA1KXM -09', 'VK3/9V1NE')).toBe(true);
    expect(toYou('9V1NE/P JA1KXM -09', '9V1NE')).toBe(true);
    expect(toYou('VK3/9V1NE JA1KXM R-09', '9V1NE/P')).toBe(true);
    // A hashed call, and free text that starts with the call.
    expect(toYou('<9V1NE> JA1KXM RR73', '9V1NE')).toBe(true);
    expect(toYou('9V1NE TNX 73 GL', '9V1NE')).toBe(true);
  });

  it('reads both halves of a DXpedition message', () => {
    expect(toYou('K1ABC RR73; 9V1NE <KH1/KH7Z> -08', '9V1NE')).toBe(true);
    expect(toYou('9V1NE RR73; K1ABC <KH1/KH7Z> -08', '9V1NE')).toBe(true);
    expect(toYou('K1ABC RR73; W9XYZ <KH1/KH7Z> -08', '9V1NE')).toBe(false);
  });

  it('is false for CQ, for messages from the operator and for other stations', () => {
    expect(toYou('CQ 9V1NE OJ11', '9V1NE')).toBe(false);
    expect(toYou('JA1KXM 9V1NE R-14', '9V1NE')).toBe(false);
    expect(toYou('JA1KXM K1ABC -10', '9V1NE')).toBe(false);
    // Another call that shares the base call's letters is a different station.
    expect(toYou('9V1NEX JA1KXM -10', '9V1NE')).toBe(false);
    expect(toYou('9V1NE JA1KXM PM95', '')).toBe(false);
    expect(toYou('9V1NE JA1KXM PM95', '  ')).toBe(false);
  });
});
