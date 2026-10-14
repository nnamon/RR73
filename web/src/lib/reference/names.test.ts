import { describe, expect, it } from 'vitest';
import { DISPLAY_NAMES, LONG_NAMES, SHORT_NAME_MAX, displayName } from './names';
import { bigCtyFixture } from './testing';

const names = bigCtyFixture().entities.map((e) => e.name);

describe('display names for the country file', () => {
  it('gives every entity a name of at most 14 characters, or one listed as kept long', () => {
    const tooLong = names.map(displayName).filter((n) => n.length > SHORT_NAME_MAX && !LONG_NAMES.has(n));
    expect(tooLong).toEqual([]);
    for (const n of LONG_NAMES) {
      expect(n.length, n).toBeGreaterThan(SHORT_NAME_MAX);
      expect(names.map(displayName), n).toContain(n);
    }
  });

  it('keeps every entity apart: no two share a display name', () => {
    const shown = new Map<string, string>();
    for (const n of new Set(names)) {
      const d = displayName(n);
      expect(shown.get(d), `${n} and ${shown.get(d)} both show as ${d}`).toBeUndefined();
      shown.set(d, n);
    }
  });

  it('names only entities the country file has', () => {
    expect(Object.keys(DISPLAY_NAMES).filter((k) => !names.includes(k))).toEqual([]);
  });

  it('uses the names operators say', () => {
    expect(['Fed. Rep. of Germany', 'Asiatic Turkey', 'Republic of Korea', 'DPR of Korea', 'Dem. Rep. of the Congo', 'Australia'].map(displayName)).toEqual(['Germany', 'Turkey', 'South Korea', 'North Korea', 'DR Congo', 'Australia']);
    expect([displayName('European Russia'), displayName('Asiatic Russia')]).toEqual(['European Russia', 'Asiatic Russia']);
  });
});
