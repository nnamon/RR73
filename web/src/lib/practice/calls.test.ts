import { describe, expect, it } from 'vitest';
import { DxccIndex, type DxccMatch } from '../reference';
import { bigCtyFixture } from '../reference/testing';
import { newCallsign, Rng } from './calls';

const countries = DxccIndex.fromJson(bigCtyFixture());

describe('practice callsigns', () => {
  it('fall in the DXCC entity of their country', () => {
    // Drawn from the prefixes alone, VK9 calls fall on Norfolk Island, UA9 in Asiatic Russia,
    // LU1ZA in Antarctica and EA8 on the Canary Islands. An exact callsign from the country file
    // keeps its listed entity, as a real station would.
    const rng = new Rng(73);
    const wrong: string[] = [];
    let n = 0;
    for (let i = 0; i < 20_000; i++) {
      const c = newCallsign(rng, new Set());
      const r = countries.lookup(c.call);
      expect(r.found, c.call).toBe(true);
      const m = r as DxccMatch;
      if (m.via.rule === 'exact') continue;
      n++;
      if (m.dxccEntity !== c.entity) wrong.push(`${c.call} ${m.dxccEntity}, meant ${c.entity}`);
    }
    expect(n).toBeGreaterThan(19_900);
    expect(wrong).toEqual([]);
  });
});
