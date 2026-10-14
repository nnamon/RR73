import { describe, expect, it } from 'vitest';
import { sizeClassOf, uprightOf } from './layout.svelte';

describe('size classes', () => {
  it('gives windows under 700 pt wide the phone layout, whatever their height', () => {
    // iPhone SE, iPhone 15, iPad Slide Over, iPad Split View up to half, iPhone SE on its side.
    for (const [w, h] of [
      [375, 667],
      [393, 852],
      [320, 1180],
      [507, 1180],
      [694, 1024],
      [699, 1200],
      [667, 375],
    ]) {
      expect(sizeClassOf(w, h), `${w} x ${h}`).toBe('compact');
    }
  });

  it('gives a window 700 pt wide or more and under 500 pt tall compact height', () => {
    // iPhone 15 and iPhone Pro Max on their side, a short desktop window.
    for (const [w, h] of [
      [852, 393],
      [932, 430],
      [700, 499],
      [1440, 480],
    ]) {
      expect(sizeClassOf(w, h), `${w} x ${h}`).toBe('compact-height');
    }
  });

  it('gives the rest regular width', () => {
    for (const [w, h] of [
      [700, 500],
      [820, 1180],
      [1180, 820],
      [1440, 900],
      [1920, 1080],
    ]) {
      expect(sizeClassOf(w, h), `${w} x ${h}`).toBe('regular');
    }
  });

  it('keeps the bottom bar in regular width when the window is taller than wide', () => {
    expect(uprightOf(820, 1180)).toBe(true);
    expect(uprightOf(744, 1133)).toBe(true);
    expect(uprightOf(1180, 820)).toBe(false);
    expect(uprightOf(1440, 900)).toBe(false);
    // Not regular: no transmit panel either way.
    expect(uprightOf(393, 852)).toBe(false);
    expect(uprightOf(852, 393)).toBe(false);
  });
});
