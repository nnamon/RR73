import { describe, expect, it } from 'vitest';
import { HOLD_MS, TouchFreeze } from './freeze';

describe('TouchFreeze', () => {
  it('is free until touched', () => {
    const f = new TouchFreeze();
    expect(f.frozen(1000)).toBe(false);
    expect(f.wait(1000)).toBe(0);
  });

  it('freezes while touched and for 0.5 s after the finger lifts', () => {
    const f = new TouchFreeze();
    f.down(1000);
    expect(f.frozen(5000)).toBe(true);
    expect(f.wait(5000)).toBe(Infinity);
    f.up(5000);
    expect(HOLD_MS).toBe(500);
    expect(f.frozen(5499)).toBe(true);
    expect(f.wait(5200)).toBe(300);
    expect(f.frozen(5500)).toBe(false);
  });

  it('stays frozen until the last of several fingers lifts', () => {
    const f = new TouchFreeze();
    f.down(0);
    f.down(10);
    f.up(20);
    expect(f.frozen(2000)).toBe(true);
    f.up(2000);
    expect(f.frozen(2400)).toBe(true);
    expect(f.frozen(2500)).toBe(false);
  });

  it('extends the freeze while the list scrolls on after the finger lifts', () => {
    const f = new TouchFreeze();
    f.down(0);
    f.up(100);
    f.activity(450);
    f.activity(800);
    expect(f.frozen(1200)).toBe(true);
    expect(f.frozen(1300)).toBe(false);
  });

  it('ignores a lift without a touch', () => {
    const f = new TouchFreeze();
    f.up(0);
    f.down(10);
    expect(f.frozen(10_000)).toBe(true);
  });
});
