import { describe, expect, it } from 'vitest';
import { bracket, ticks } from './axis';

describe('frequency axis', () => {
  it('has 100 Hz minor and 500 Hz major ticks, labelled at the majors', () => {
    const t = ticks();
    expect(t).toHaveLength(29);
    expect(t[0]).toEqual({ hz: 100, x: 100 / 3000, major: false, label: null });
    expect(t.filter((x) => x.major).map((x) => x.label)).toEqual(['500', '1000', '1500', '2000', '2500']);
  });

  it('brackets a 50 Hz wide signal from its lowest tone', () => {
    expect(bracket(1500)).toEqual({ x0: 0.5, x1: 1550 / 3000 });
    expect(bracket(2990).x1).toBe(1);
  });
});
