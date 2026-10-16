import { describe, expect, it } from 'vitest';
import { alcAdvice } from './alc';

describe('alcAdvice', () => {
  it('words the ALC level from the connected radio’s manual, and gives both without one', () => {
    expect(alcAdvice('kx2')).toBe('Set the level for 4 to 5 ALC bars during Tune, no more.');
    expect(alcAdvice('ic705')).toBe('Set the level so the ALC meter stays within the ALC zone during Tune.');
    expect(alcAdvice(null)).toBe('Set the level during Tune as the radio’s manual gives for data: 4 to 5 ALC bars on a KX2, within the ALC zone on an IC-705.');
  });
});
