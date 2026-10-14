import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseCtyCsvCodes, parseCtyDat, toCtyJson } from './cty';
import { DxccIndex, type DxccMatch } from './dxcc';

// Big CTY of 15 September 2026, pinned in fixtures/reference/bigcty-20260915: cty.dat as
// released, and cty.csv without its alias column (it carries the ADIF DXCC codes). The index is
// built through cty.json, the path the app takes.
const dir = new URL('../../../../fixtures/reference/bigcty-20260915/', import.meta.url);
const dat = gunzipSync(readFileSync(new URL('cty.dat.gz', dir))).toString('latin1');
const csv = gunzipSync(readFileSync(new URL('cty-columns.csv.gz', dir))).toString('latin1');
const json = toCtyJson(parseCtyDat(dat), parseCtyCsvCodes(csv), { version: '2026-09-15', source: 'fixture', notice: 'MIT' });
const cty = DxccIndex.fromJson(JSON.parse(JSON.stringify(json)));

type Expect = [call: string, entity: string, dxcc: number, cq?: number, itu?: number];

// Expected entities and ADIF DXCC codes come from the ADIF DXCC entity list; README.TXT and
// HISTORY.TXT of this release give the cases marked "Big CTY". Zones are given where the case is
// about them.
const TABLE: Expect[] = [
  // Prefixes and the longest match
  ['K1ABC', 'United States', 291, 5, 8],
  ['K6ABC', 'United States', 291, 3, 6],
  ['VE3ABC', 'Canada', 1, 4, 4],
  ['KH6XX', 'Hawaii', 110, 31, 61],
  ['KL7XX', 'Alaska', 6, 1, 1],
  ['KP4ABC', 'Puerto Rico', 202],
  ['VP2EAA', 'Anguilla', 12, 8, 11],
  ['VP2MAA', 'Montserrat', 96, 8, 11],
  ['VP2VAA', 'British Virgin Islands', 65, 8, 11],
  ['3D2KJ', 'Fiji', 176, 32, 56],
  ['1A0KM', 'Sov Mil Order of Malta', 246, 15, 28],
  ['9V1NE', 'Singapore', 381, 28, 54],
  ['9M2AB', 'West Malaysia', 299, 28, 54],
  ['9M6XRO', 'East Malaysia', 46, 28, 54],
  ['9M8YY', 'East Malaysia', 46],
  ['9M0SEA', 'West Malaysia', 299],
  ['BV2AA', 'Taiwan', 386, 24, 44],
  ['BV9PXX', 'Pratas Island', 505],
  ['BX9ABC', 'Taiwan', 386],
  ['JA1ABC', 'Japan', 339, 25, 45],
  ['JD1BLC', 'Ogasawara', 192, 27, 45],
  ['CE0YAA', 'Easter Island', 47, 12, 63],
  ['CE0ZIS', 'Juan Fernandez Islands', 125, 12, 14],
  ['CE0XAA', 'San Felix & San Ambrosio', 217],
  ['ZL1ABC', 'New Zealand', 170],
  ['ZL7DK', 'Chatham Islands', 34, 32, 60],
  ['ZL8X', 'Kermadec Islands', 133],
  ['EA8AA', 'Canary Islands', 29, 33, 36],
  ['GM4ABC', 'Scotland', 279],
  ['DL1ABC', 'Fed. Rep. of Germany', 230],
  ['VU2ABC', 'India', 324],
  ['VU4AN', 'Andaman & Nicobar Is.', 11],
  ['PY1ABC', 'Brazil', 108],
  ['LU1ABC', 'Argentina', 100],
  ['ZS1ABC', 'South Africa', 462],
  ['ZS8ABC', 'Pr. Edward & Marion Is.', 201],
  ['UA3ABC', 'European Russia', 54],
  ['UA9ABC', 'Asiatic Russia', 15],
  ['UA2ABC', 'Kaliningrad', 126],
  ['TA2AA', 'Asiatic Turkey', 390],
  // Exact callsigns
  ['AA2TT', 'Hawaii', 110],
  ['AL7KN', 'United States', 291, 3, 6], // Big CTY: AL7KN is in CQ zone 3, ITU zone 6
  ['KH8K', 'Guam', 103], // Big CTY
  ['3D2AG/P', 'Rotuma Island', 460, 32, 56],
  ['3D2C', 'Conway Reef', 489],
  ['JD1/JA6GXK', 'Minami Torishima', 177, 27, 90],
  ['4U1UN', 'United Nations HQ', 289, 5, 8],
  ['4U1ITU', 'ITU HQ', 117, 14, 28],
  ['OR4TN', 'Antarctica', 13, 38, 67], // Big CTY: Antarctica, not Belgium
  ['MR6TMS', 'Scotland', 279], // Big CTY: Scotland, not England
  ['LW7DQQ/Y', 'Argentina', 100, 13, 16], // Big CTY: Argentina in ITU zone 16
  ['UI9XA', 'European Russia', 54], // Big CTY: European Russia, not Asiatic
  ['ZS85SARL', 'South Africa', 462], // Big CTY: not Marion Island
  ['EA8LU/7', 'Spain', 281], // Big CTY
  ['SV1ELW/9', 'Crete', 40], // Big CTY
  ['SV2ASP/A', 'Mount Athos', 180],
  ['VERSION', 'Rotuma Island', 460], // Big CTY: the version entity of this release
  // Portable forms
  ['VK3/9V1NE', 'Australia', 150, 30, 59],
  ['VK6/9V1NE', 'Australia', 150, 29, 58],
  ['9V1NE/VK3', 'Australia', 150, 30, 59],
  ['9V1NE/P', 'Singapore', 381, 28, 54],
  ['3D2RR/P', 'Rotuma Island', 460],
  ['K1ABC/KL7', 'Alaska', 6],
  ['W1AW/KH6', 'Hawaii', 110],
  ['KH6/W1AW', 'Hawaii', 110],
  ['VP2E/W1AW', 'Anguilla', 12],
  ['F/G3ABC', 'France', 227],
  ['G3ABC/F', 'England', 223],
  ['LU1ABC/D', 'Argentina', 100],
  ['K1ABC/6', 'United States', 291, 3, 6],
  ['EA8ZZZ/7', 'Spain', 281],
  ['EA5ZZZ/9', 'Ceuta & Melilla', 32],
  ['9M6/PA9ZZZ/2', 'West Malaysia', 299],
  ['JA1ABC/JD1', 'Ogasawara', 192],
  ['2E0CCD/NHS', 'England', 223],
  ['<9V1NE>', 'Singapore', 381],
  ['9v1ne', 'Singapore', 381],
];

describe('callsign lookups against Big CTY 15 September 2026', () => {
  it('has the pinned release', () => {
    expect(cty.entities).toHaveLength(346);
    expect(cty.entities.every((e) => e.dxcc !== null)).toBe(true);
  });

  it.each(TABLE)('%s is %s (DXCC %i)', (call, entity, dxcc, cq, itu) => {
    const r = cty.lookup(call);
    expect(r.found, JSON.stringify(r)).toBe(true);
    const m = r as DxccMatch;
    expect([m.entity, m.dxcc]).toEqual([entity, dxcc]);
    if (cq !== undefined) expect([m.cqZone, m.ituZone]).toEqual([cq, itu]);
  });

  it('names the WAE entity and its DXCC entity', () => {
    const sicily = cty.lookup('IT9ABC') as DxccMatch;
    expect([sicily.entity, sicily.wae, sicily.dxcc, sicily.dxccEntity, sicily.cqZone, sicily.ituZone]).toEqual(['Sicily', true, 248, 'Italy', 15, 28]);
    const vic = cty.lookup('4U1VIC') as DxccMatch;
    expect([vic.entity, vic.wae, vic.dxcc, vic.dxccEntity]).toEqual(['Vienna Intl Ctr', true, 206, 'Austria']);
    const tr = cty.lookup('TA1AA') as DxccMatch;
    expect([tr.entity, tr.wae, tr.dxcc, tr.dxccEntity, tr.continent]).toEqual(['European Turkey', true, 390, 'Asiatic Turkey', 'EU']);
    const hi = cty.lookup('KH6XX') as DxccMatch;
    expect([hi.wae, hi.dxccEntity]).toEqual([false, 'Hawaii']);
  });

  it('keeps the first entity for a callsign listed twice', () => {
    // =4U0IARU is listed under Vienna Intl Ctr and again under Austria, which comes later.
    expect(dat.indexOf('=4U0IARU')).toBeLessThan(dat.lastIndexOf('=4U0IARU'));
    expect((cty.lookup('4U0IARU') as DxccMatch).entity).toBe('Vienna Intl Ctr');
  });

  it('reports how each match was made', () => {
    expect((cty.lookup('VK3/9V1NE') as DxccMatch).via).toEqual({ rule: 'prefix', alias: 'VK', lookedUp: 'VK3' });
    expect((cty.lookup('3D2RR/P') as DxccMatch).via).toEqual({ rule: 'exact', alias: '3D2RR', lookedUp: '3D2RR' });
    expect((cty.lookup('K1ABC/6') as DxccMatch).via).toEqual({ rule: 'prefix', alias: 'K6', lookedUp: 'K6ABC' });
    expect((cty.lookup('9M6/PA9ZZZ/2') as DxccMatch).via.lookedUp).toBe('9M2');
  });

  it('gives positions east positive and local time east of UTC', () => {
    const fiji = cty.lookup('3D2KJ') as DxccMatch;
    expect([fiji.lat, fiji.lon, fiji.utcOffsetH, fiji.continent]).toEqual([-17.78, 177.92, 12, 'OC']);
    const us = cty.lookup('K1ABC') as DxccMatch;
    expect([us.lon, us.utcOffsetH]).toEqual([-91.87, -5]);
  });

  it('has no entity for maritime and aeronautical mobile, invalid text or unknown prefixes', () => {
    expect(cty.lookup('9V1NE/MM')).toEqual({ found: false, call: '9V1NE/MM', reason: 'maritime-mobile' });
    expect(cty.lookup('K1ABC/AM')).toEqual({ found: false, call: 'K1ABC/AM', reason: 'aeronautical-mobile' });
    // Big CTY lists some /MM callsigns whole; those keep their entity.
    expect((cty.lookup('YL3IZ/MM') as DxccMatch).found).toBe(true);
    expect(cty.lookup('K1 ABC!')).toMatchObject({ found: false, reason: 'invalid' });
    expect(cty.lookup('')).toMatchObject({ found: false, reason: 'invalid' });
    expect(cty.lookup('Q1ABC')).toEqual({ found: false, call: 'Q1ABC', reason: 'unknown' });
  });
});
