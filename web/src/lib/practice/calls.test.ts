import { describe, expect, it } from 'vitest';
import { DxccIndex, type DxccMatch } from '../reference';
import { bigCtyFixture } from '../reference/testing';
import { SECTIONS, STATES } from '../qso/exchange';
import { RARE_ENTITIES, callsignIn, compoundOf, contestPlace, newCallsign, nonstandard, rareCallsign, Rng } from './calls';

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

  it('give the New ones entities and the entities asked for, by the country file', () => {
    const rng = new Rng(74);
    for (let i = 0; i < 2000; i++) {
      const c = rareCallsign(rng, new Set(), new Set());
      const m = countries.lookup(c.call) as DxccMatch;
      if (m.via.rule !== 'exact') expect(m.dxccEntity, c.call).toBe(c.entity);
      expect(RARE_ENTITIES).toContain(c.entity);
    }
    for (const entity of [...RARE_ENTITIES, 'Japan', 'Australia']) expect((countries.lookup(callsignIn(rng, entity, new Set()).call) as DxccMatch).dxccEntity).toBe(entity);
    // Entities already worked are left out.
    const skip = new Set(RARE_ENTITIES.slice(1));
    expect(rareCallsign(rng, new Set(), skip).entity).toBe(RARE_ENTITIES[0]);
  });

  it('make compound callsigns that keep their continent, and tell the ones standard messages cannot carry', () => {
    const rng = new Rng(75);
    const forms = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = newCallsign(rng, new Set());
      const x = compoundOf(rng, c);
      expect(x).toContain(c.call);
      forms.add(x.endsWith('/P') ? 'P' : x.endsWith('/M') ? 'M' : 'prefix');
      expect(nonstandard(x)).toBe(!x.endsWith('/P'));
      expect(nonstandard(c.call)).toBe(false);
    }
    expect([...forms].sort()).toEqual(['M', 'P', 'prefix']);
  });

  it('give US and Canadian stations a section and a state the codec packs, from the call area', () => {
    const rng = new Rng(76);
    expect(contestPlace(rng, 'JA1ABC')).toBeNull();
    for (const call of ['K1ABC', 'W2XYZ', 'N3AB', 'AA4XX', 'K5ZZ', 'W6ABC', 'K7AB', 'N8ZZ', 'W9AB', 'K0AB', 'VE1AB', 'VE2AB', 'VA3AB', 'VE4AB', 'VE5AB', 'VE6AB', 'VE7AB']) {
      for (let i = 0; i < 20; i++) {
        const p = contestPlace(rng, call)!;
        expect(SECTIONS, call).toContain(p.section);
        expect(STATES, call).toContain(p.state);
      }
    }
    expect(contestPlace(rng, 'W6ABC')!.state).toBe('CA');
  });
});
