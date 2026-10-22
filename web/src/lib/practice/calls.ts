// Stations for the practice band: a seeded random source, callsigns and grids by country, and
// the continent of a callsign for directed CQs (CQ DX, CQ NA).

/** Seeded PRNG (mulberry32), uniform in [0, 1). The same seed gives the same band. */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Whole number in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }

  /** A new generator drawn from this one, for a station's own decisions. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

export type Continent = 'AF' | 'AS' | 'EU' | 'NA' | 'OC' | 'SA';

interface Country {
  /** The DXCC entity, as the country file names it. */
  entity: string;
  /** Prefixes as issued; one is drawn for each callsign. */
  prefixes: readonly string[];
  /** The prefix carries its own digit (9M2, KH6). */
  digit: boolean;
  continent: Continent;
  /** Grid fields stations of this country sit in. */
  fields: readonly string[];
  /** Relative share of stations on the band. */
  weight: number;
  /**
   * Callsigns the country file gives to another DXCC entity, drawn again: VK9 is Norfolk Island
   * and its neighbours, LU1ZA Antarctica, UA9 Asiatic Russia.
   */
  avoid?: RegExp;
}

const COUNTRIES: readonly Country[] = [
  { entity: 'United States', prefixes: ['K', 'W', 'N', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AJ', 'AK'], digit: false, continent: 'NA', fields: ['FN', 'EN', 'EM', 'DM', 'CN', 'DN', 'EL'], weight: 14 },
  { entity: 'Canada', prefixes: ['VE', 'VA'], digit: false, continent: 'NA', fields: ['FN', 'EN', 'DO', 'CN'], weight: 3 },
  { entity: 'Mexico', prefixes: ['XE'], digit: false, continent: 'NA', fields: ['EK', 'DL'], weight: 1, avoid: /^XE4/ },
  { entity: 'Japan', prefixes: ['JA', 'JH', 'JR', 'JE', 'JF', 'JG', 'JI'], digit: false, continent: 'AS', fields: ['PM', 'QM'], weight: 10 },
  { entity: 'Taiwan', prefixes: ['BV'], digit: false, continent: 'AS', fields: ['PL'], weight: 1, avoid: /^BV9/ },
  { entity: 'Republic of Korea', prefixes: ['HL', 'DS'], digit: false, continent: 'AS', fields: ['PM'], weight: 2 },
  { entity: 'West Malaysia', prefixes: ['9M2'], digit: true, continent: 'AS', fields: ['OJ', 'NJ'], weight: 1 },
  { entity: 'Thailand', prefixes: ['HS'], digit: false, continent: 'AS', fields: ['OK', 'NK'], weight: 1 },
  { entity: 'India', prefixes: ['VU'], digit: false, continent: 'AS', fields: ['MK', 'ML'], weight: 2, avoid: /^VU[47]/ },
  { entity: 'Fed. Rep. of Germany', prefixes: ['DL', 'DK', 'DJ', 'DO'], digit: false, continent: 'EU', fields: ['JO', 'JN'], weight: 8 },
  { entity: 'England', prefixes: ['G', 'M'], digit: false, continent: 'EU', fields: ['IO'], weight: 4 },
  { entity: 'France', prefixes: ['F'], digit: false, continent: 'EU', fields: ['JN', 'IN'], weight: 3 },
  { entity: 'Italy', prefixes: ['I', 'IZ', 'IK'], digit: false, continent: 'EU', fields: ['JN'], weight: 3 },
  { entity: 'Spain', prefixes: ['EA'], digit: false, continent: 'EU', fields: ['IN', 'IM'], weight: 3, avoid: /^EA[689]/ },
  { entity: 'Poland', prefixes: ['SP', 'SQ'], digit: false, continent: 'EU', fields: ['JO', 'KO'], weight: 3 },
  { entity: 'European Russia', prefixes: ['UA', 'RA', 'R'], digit: false, continent: 'EU', fields: ['KO', 'LO'], weight: 4, avoid: /^(UA|RA|R)[0289]/ },
  { entity: 'Finland', prefixes: ['OH'], digit: false, continent: 'EU', fields: ['KP'], weight: 1, avoid: /^OH0/ },
  { entity: 'Sweden', prefixes: ['SM'], digit: false, continent: 'EU', fields: ['JO', 'JP'], weight: 1 },
  { entity: 'Czech Republic', prefixes: ['OK'], digit: false, continent: 'EU', fields: ['JN', 'JO'], weight: 2 },
  { entity: 'Netherlands', prefixes: ['PA', 'PD'], digit: false, continent: 'EU', fields: ['JO'], weight: 2 },
  { entity: 'Romania', prefixes: ['YO'], digit: false, continent: 'EU', fields: ['KN'], weight: 1 },
  { entity: 'Brazil', prefixes: ['PY'], digit: false, continent: 'SA', fields: ['GG', 'GH'], weight: 3, avoid: /^PY0/ },
  { entity: 'Argentina', prefixes: ['LU'], digit: false, continent: 'SA', fields: ['GF', 'FF'], weight: 2, avoid: /^LU\dZ/ },
  { entity: 'Chile', prefixes: ['CE'], digit: false, continent: 'SA', fields: ['FF'], weight: 1, avoid: /^CE[09]/ },
  { entity: 'South Africa', prefixes: ['ZS'], digit: false, continent: 'AF', fields: ['KG', 'JF'], weight: 1, avoid: /^ZS[78]/ },
  { entity: 'Tanzania', prefixes: ['5H'], digit: false, continent: 'AF', fields: ['KI'], weight: 1 },
  { entity: 'Australia', prefixes: ['VK'], digit: false, continent: 'OC', fields: ['QF', 'PF', 'QG'], weight: 4, avoid: /^VK[09]/ },
  { entity: 'New Zealand', prefixes: ['ZL'], digit: false, continent: 'OC', fields: ['RF', 'RE'], weight: 1, avoid: /^ZL[5789]/ },
  { entity: 'Philippines', prefixes: ['DU'], digit: false, continent: 'OC', fields: ['PK'], weight: 1 },
  { entity: 'Indonesia', prefixes: ['YB'], digit: false, continent: 'OC', fields: ['OI', 'NI'], weight: 1 },
];

/**
 * Entities the band leaves out, for the New ones scenario: CQs from DXCC entities, zones and
 * grids the practice log does not hold.
 */
const RARE: readonly Country[] = [
  { entity: 'Iceland', prefixes: ['TF'], digit: false, continent: 'EU', fields: ['HP', 'IP'], weight: 1 },
  { entity: 'Faroe Islands', prefixes: ['OY'], digit: false, continent: 'EU', fields: ['IP'], weight: 1 },
  { entity: 'Malta', prefixes: ['9H'], digit: false, continent: 'EU', fields: ['JM'], weight: 1 },
  { entity: 'Cyprus', prefixes: ['5B'], digit: false, continent: 'AS', fields: ['KM'], weight: 1 },
  { entity: 'Mongolia', prefixes: ['JT'], digit: false, continent: 'AS', fields: ['ON', 'OO'], weight: 1 },
  { entity: 'Nepal', prefixes: ['9N'], digit: false, continent: 'AS', fields: ['NL'], weight: 1 },
  { entity: 'Sri Lanka', prefixes: ['4S'], digit: false, continent: 'AS', fields: ['MJ'], weight: 1 },
  { entity: 'Kenya', prefixes: ['5Z'], digit: false, continent: 'AF', fields: ['KJ'], weight: 1 },
  { entity: 'Madagascar', prefixes: ['5R'], digit: false, continent: 'AF', fields: ['LH'], weight: 1 },
  { entity: 'Namibia', prefixes: ['V5'], digit: false, continent: 'AF', fields: ['JG'], weight: 1 },
  { entity: 'Tonga', prefixes: ['A3'], digit: false, continent: 'OC', fields: ['AG'], weight: 1 },
  { entity: 'Bolivia', prefixes: ['CP'], digit: false, continent: 'SA', fields: ['FH'], weight: 1 },
  { entity: 'Greenland', prefixes: ['OX'], digit: false, continent: 'NA', fields: ['GP', 'HP'], weight: 1 },
  { entity: 'Jamaica', prefixes: ['6Y'], digit: false, continent: 'NA', fields: ['FK'], weight: 1 },
];

/** Prefixes not issued to practice stations, for reading the operator's continent. */
const OTHER_PREFIXES: readonly [string, Continent][] = [
  ['9V', 'AS'],
  ['VR', 'AS'],
  ['BY', 'AS'],
  ['KH6', 'OC'],
  ['KL7', 'NA'],
  ['EI', 'EU'],
  ['ON', 'EU'],
  ['HA', 'EU'],
  ['LZ', 'EU'],
  ['9A', 'EU'],
  ['S5', 'EU'],
  ['UR', 'EU'],
  ['4X', 'AS'],
  ['A6', 'AS'],
  ['CX', 'SA'],
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface Callsign {
  call: string;
  grid: string;
  continent: Continent;
  /** The DXCC entity, as the country file names it: "Australia". */
  entity: string;
}

function weightedCountry(rng: Rng, only: (c: Continent) => boolean): Country {
  const pool = COUNTRIES.filter((c) => only(c.continent));
  const list = pool.length ? pool : COUNTRIES;
  let r = rng.next() * list.reduce((a, c) => a + c.weight, 0);
  for (const c of list) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return list[list.length - 1];
}

/** The call area and suffix after a prefix: "2LAW" after VK. */
function areaAndSuffix(rng: Rng, c: Country, prefix: string): string {
  const digit = c.digit ? '' : String(rng.int(0, 9));
  const n = prefix.length === 1 ? 3 : rng.int(2, 3);
  let suffix = '';
  for (let i = 0; i < n; i++) suffix += LETTERS[rng.int(0, 25)];
  return `${digit}${suffix}`;
}

/** FNV-1a hash of the text, as a seed. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A new station's callsign and grid: "JA1KXM PM95". `only` limits the continents, for the
 * callers of a directed CQ; `taken` holds callsigns already on the band.
 */
export function newCallsign(rng: Rng, taken: ReadonlySet<string>, only: (c: Continent) => boolean = () => true): Callsign {
  for (;;) {
    const c = weightedCountry(rng, only);
    const prefix = rng.pick(c.prefixes);
    let call = `${prefix}${areaAndSuffix(rng, c, prefix)}`;
    // A callsign of another entity is drawn again from a generator of its own, so the stations
    // after it are the ones the seed has always given.
    for (const again = new Rng(hash(call)); c.avoid?.test(call); ) call = `${prefix}${areaAndSuffix(again, c, prefix)}`;
    if (taken.has(call)) continue;
    return { call, grid: `${rng.pick(c.fields)}${rng.int(0, 9)}${rng.int(0, 9)}`, continent: c.continent, entity: c.entity };
  }
}

/** The entities the band draws its stations from, as the country file names them. */
export const BAND_ENTITIES: readonly string[] = COUNTRIES.map((c) => c.entity);

/** The entities of the New ones scenario, which the band otherwise leaves out. */
export const RARE_ENTITIES: readonly string[] = RARE.map((c) => c.entity);

function callOf(rng: Rng, c: Country, taken: ReadonlySet<string>): Callsign {
  for (;;) {
    const prefix = rng.pick(c.prefixes);
    let call = `${prefix}${areaAndSuffix(rng, c, prefix)}`;
    for (const again = new Rng(hash(call)); c.avoid?.test(call); ) call = `${prefix}${areaAndSuffix(again, c, prefix)}`;
    if (taken.has(call)) continue;
    return { call, grid: `${rng.pick(c.fields)}${rng.int(0, 9)}${rng.int(0, 9)}`, continent: c.continent, entity: c.entity };
  }
}

/** A station in the entity `entity` of the band's countries or the New ones list. */
export function callsignIn(rng: Rng, entity: string, taken: ReadonlySet<string>): Callsign {
  const c = [...COUNTRIES, ...RARE].find((k) => k.entity === entity) ?? COUNTRIES[0];
  return callOf(rng, c, taken);
}

/** A station from an entity of the New ones list that `skip` does not hold. */
export function rareCallsign(rng: Rng, taken: ReadonlySet<string>, skip: ReadonlySet<string>): Callsign {
  const pool = RARE.filter((c) => !skip.has(c.entity));
  return callOf(rng, rng.pick(pool.length ? pool : RARE), taken);
}

/**
 * Portable prefixes a station of each continent signs from abroad: "F/G4XYZ". Each is the prefix
 * of an entity on the same continent, so directed CQs treat the station as before.
 */
const ABROAD: Record<Continent, readonly string[]> = {
  EU: ['F', 'DL', 'EA', 'I', 'OH', 'SM', 'OK', 'PA'],
  NA: ['VE3', 'VE7', 'XE2'],
  AS: ['HL', 'JA'],
  OC: ['ZL', 'VK2'],
  SA: ['PY', 'LU'],
  AF: ['ZS'],
};

/**
 * A compound form of a station's callsign: /P or /M after it, or a portable prefix before it.
 * /P packs as a standard callsign; /M and a prefix do not, so those stations call CQ without a
 * grid and send their reports with their callsign hashed.
 */
export function compoundOf(rng: Rng, c: Callsign): string {
  const x = rng.next();
  if (x < 0.4) return `${c.call}/P`;
  if (x < 0.6) return `${c.call}/M`;
  const abroad = ABROAD[c.continent].filter((p) => !c.call.startsWith(p));
  return abroad.length ? `${rng.pick(abroad)}/${c.call}` : `${c.call}/P`;
}

/** True for a callsign the standard messages cannot carry in full: a portable prefix, /M. /P and /R pack as standard. */
export function nonstandard(call: string): boolean {
  const c = call.replace(/[<>]/g, '');
  return c.includes('/') && !/^[A-Z0-9]+\/[PR]$/.test(c);
}

/** ARRL and RAC sections by US call area digit, and by Canadian prefix. */
const US_SECTIONS: Record<string, readonly string[]> = {
  '1': ['CT', 'EMA', 'ME', 'NH', 'RI', 'VT', 'WMA'],
  '2': ['ENY', 'NLI', 'NNJ', 'NNY', 'SNJ', 'WNY'],
  '3': ['DE', 'EPA', 'MDC', 'WPA'],
  '4': ['AL', 'GA', 'KY', 'NC', 'NFL', 'SC', 'SFL', 'TN', 'VA', 'WCF'],
  '5': ['AR', 'LA', 'MS', 'NM', 'NTX', 'OK', 'STX', 'WTX'],
  '6': ['EB', 'LAX', 'ORG', 'PAC', 'SB', 'SCV', 'SDG', 'SF', 'SJV', 'SV'],
  '7': ['AZ', 'EWA', 'ID', 'MT', 'NV', 'OR', 'UT', 'WWA', 'WY'],
  '8': ['MI', 'OH', 'WV'],
  '9': ['IL', 'IN', 'WI'],
  '0': ['CO', 'IA', 'KS', 'MN', 'MO', 'ND', 'NE', 'SD'],
};
const US_STATES: Record<string, readonly string[]> = {
  '1': ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'],
  '2': ['NJ', 'NY'],
  '3': ['DE', 'MD', 'PA'],
  '4': ['AL', 'FL', 'GA', 'KY', 'NC', 'SC', 'TN', 'VA'],
  '5': ['AR', 'LA', 'MS', 'NM', 'OK', 'TX'],
  '6': ['CA'],
  '7': ['AZ', 'ID', 'MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  '8': ['MI', 'OH', 'WV'],
  '9': ['IL', 'IN', 'WI'],
  '0': ['CO', 'IA', 'KS', 'MN', 'MO', 'ND', 'NE', 'SD'],
};
const VE: Record<string, { sections: readonly string[]; states: readonly string[] }> = {
  '1': { sections: ['NB', 'NS', 'PE'], states: ['NB', 'NS'] },
  '2': { sections: ['QC'], states: ['QC'] },
  '3': { sections: ['GH', 'ONE', 'ONN', 'ONS'], states: ['ON'] },
  '4': { sections: ['MB'], states: ['MB'] },
  '5': { sections: ['SK'], states: ['SK'] },
  '6': { sections: ['AB'], states: ['AB'] },
  '7': { sections: ['BC'], states: ['BC'] },
};

/**
 * Where a station in the US or Canada is, as the contest exchanges send it: its ARRL or RAC
 * section and its state or province, from the call area. Null for other stations, which send DX
 * as their section and a serial number in place of a state.
 */
export function contestPlace(rng: Rng, call: string): { section: string; state: string } | null {
  const m = /^(VE|VA)(\d)/.exec(call);
  if (m) {
    const v = VE[m[2]] ?? VE['3'];
    return { section: rng.pick(v.sections), state: rng.pick(v.states) };
  }
  const us = /^([KWN][A-Z]?|A[A-L])(\d)/.exec(call);
  if (!us) return null;
  return { section: rng.pick(US_SECTIONS[us[2]]), state: rng.pick(US_STATES[us[2]]) };
}

/** The continent of a callsign from its prefix, or null when RR73 does not know it. */
export function continentOf(call: string): Continent | null {
  const c = call.toUpperCase().split('/').sort((a, b) => b.length - a.length)[0] ?? '';
  // United States calls: K, W, N, or AA to AL, then a digit.
  if (/^([KWN][A-Z]?|A[A-L])\d/.test(c) && !/^KH6|^KL7/.test(c)) return 'NA';
  // A prefix matches when the call goes on with a digit, or when the prefix ends in one (KH6).
  const matches = (p: string) => c.startsWith(p) && (/\d$/.test(p) || /^\d/.test(c.slice(p.length)));
  const all: [string, Continent][] = [...[...COUNTRIES, ...RARE].flatMap((k) => k.prefixes.map((p): [string, Continent] => [p, k.continent])), ...OTHER_PREFIXES];
  const best = all.filter(([p]) => matches(p)).sort((a, b) => b[0].length - a[0].length)[0];
  return best?.[1] ?? null;
}
