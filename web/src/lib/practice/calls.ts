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
  /** Prefixes as issued; one is drawn for each callsign. */
  prefixes: readonly string[];
  /** The prefix carries its own digit (9M2, KH6). */
  digit: boolean;
  continent: Continent;
  /** Grid fields stations of this country sit in. */
  fields: readonly string[];
  /** Relative share of stations on the band. */
  weight: number;
}

const COUNTRIES: readonly Country[] = [
  { prefixes: ['K', 'W', 'N', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AJ', 'AK'], digit: false, continent: 'NA', fields: ['FN', 'EN', 'EM', 'DM', 'CN', 'DN', 'EL'], weight: 14 },
  { prefixes: ['VE', 'VA'], digit: false, continent: 'NA', fields: ['FN', 'EN', 'DO', 'CN'], weight: 3 },
  { prefixes: ['XE'], digit: false, continent: 'NA', fields: ['EK', 'DL'], weight: 1 },
  { prefixes: ['JA', 'JH', 'JR', 'JE', 'JF', 'JG', 'JI'], digit: false, continent: 'AS', fields: ['PM', 'QM'], weight: 10 },
  { prefixes: ['BV'], digit: false, continent: 'AS', fields: ['PL'], weight: 1 },
  { prefixes: ['HL', 'DS'], digit: false, continent: 'AS', fields: ['PM'], weight: 2 },
  { prefixes: ['9M2'], digit: true, continent: 'AS', fields: ['OJ', 'NJ'], weight: 1 },
  { prefixes: ['HS'], digit: false, continent: 'AS', fields: ['OK', 'NK'], weight: 1 },
  { prefixes: ['VU'], digit: false, continent: 'AS', fields: ['MK', 'ML'], weight: 2 },
  { prefixes: ['DL', 'DK', 'DJ', 'DO'], digit: false, continent: 'EU', fields: ['JO', 'JN'], weight: 8 },
  { prefixes: ['G', 'M'], digit: false, continent: 'EU', fields: ['IO'], weight: 4 },
  { prefixes: ['F'], digit: false, continent: 'EU', fields: ['JN', 'IN'], weight: 3 },
  { prefixes: ['I', 'IZ', 'IK'], digit: false, continent: 'EU', fields: ['JN'], weight: 3 },
  { prefixes: ['EA'], digit: false, continent: 'EU', fields: ['IN', 'IM'], weight: 3 },
  { prefixes: ['SP', 'SQ'], digit: false, continent: 'EU', fields: ['JO', 'KO'], weight: 3 },
  { prefixes: ['UA', 'RA', 'R'], digit: false, continent: 'EU', fields: ['KO', 'LO'], weight: 4 },
  { prefixes: ['OH'], digit: false, continent: 'EU', fields: ['KP'], weight: 1 },
  { prefixes: ['SM'], digit: false, continent: 'EU', fields: ['JO', 'JP'], weight: 1 },
  { prefixes: ['OK'], digit: false, continent: 'EU', fields: ['JN', 'JO'], weight: 2 },
  { prefixes: ['PA', 'PD'], digit: false, continent: 'EU', fields: ['JO'], weight: 2 },
  { prefixes: ['YO'], digit: false, continent: 'EU', fields: ['KN'], weight: 1 },
  { prefixes: ['PY'], digit: false, continent: 'SA', fields: ['GG', 'GH'], weight: 3 },
  { prefixes: ['LU'], digit: false, continent: 'SA', fields: ['GF', 'FF'], weight: 2 },
  { prefixes: ['CE'], digit: false, continent: 'SA', fields: ['FF'], weight: 1 },
  { prefixes: ['ZS'], digit: false, continent: 'AF', fields: ['KG', 'JF'], weight: 1 },
  { prefixes: ['5H'], digit: false, continent: 'AF', fields: ['KI'], weight: 1 },
  { prefixes: ['VK'], digit: false, continent: 'OC', fields: ['QF', 'PF', 'QG'], weight: 4 },
  { prefixes: ['ZL'], digit: false, continent: 'OC', fields: ['RF', 'RE'], weight: 1 },
  { prefixes: ['DU'], digit: false, continent: 'OC', fields: ['PK'], weight: 1 },
  { prefixes: ['YB'], digit: false, continent: 'OC', fields: ['OI', 'NI'], weight: 1 },
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

/**
 * A new station's callsign and grid: "JA1KXM PM95". `only` limits the continents, for the
 * callers of a directed CQ; `taken` holds callsigns already on the band.
 */
export function newCallsign(rng: Rng, taken: ReadonlySet<string>, only: (c: Continent) => boolean = () => true): Callsign {
  for (;;) {
    const c = weightedCountry(rng, only);
    const prefix = rng.pick(c.prefixes);
    const digit = c.digit ? '' : String(rng.int(0, 9));
    const n = prefix.length === 1 ? 3 : rng.int(2, 3);
    let suffix = '';
    for (let i = 0; i < n; i++) suffix += LETTERS[rng.int(0, 25)];
    const call = `${prefix}${digit}${suffix}`;
    if (taken.has(call)) continue;
    return { call, grid: `${rng.pick(c.fields)}${rng.int(0, 9)}${rng.int(0, 9)}`, continent: c.continent };
  }
}

/** The continent of a callsign from its prefix, or null when RR73 does not know it. */
export function continentOf(call: string): Continent | null {
  const c = call.toUpperCase().split('/').sort((a, b) => b.length - a.length)[0] ?? '';
  // United States calls: K, W, N, or AA to AL, then a digit.
  if (/^([KWN][A-Z]?|A[A-L])\d/.test(c) && !/^KH6|^KL7/.test(c)) return 'NA';
  // A prefix matches when the call goes on with a digit, or when the prefix ends in one (KH6).
  const matches = (p: string) => c.startsWith(p) && (/\d$/.test(p) || /^\d/.test(c.slice(p.length)));
  const all: [string, Continent][] = [...COUNTRIES.flatMap((k) => k.prefixes.map((p): [string, Continent] => [p, k.continent])), ...OTHER_PREFIXES];
  const best = all.filter(([p]) => matches(p)).sort((a, b) => b[0].length - a[0].length)[0];
  return best?.[1] ?? null;
}
