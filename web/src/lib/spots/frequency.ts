// Spot frequencies: reading what spotters type, and the band each frequency falls in.

/** ADIF 3.1 Band enumeration: name and edges, Hz. */
const BANDS: readonly (readonly [string, number, number])[] = [
  ['2190m', 135_700, 137_800],
  ['630m', 472_000, 479_000],
  ['560m', 501_000, 504_000],
  ['160m', 1_800_000, 2_000_000],
  ['80m', 3_500_000, 4_000_000],
  ['60m', 5_060_000, 5_450_000],
  ['40m', 7_000_000, 7_300_000],
  ['30m', 10_100_000, 10_150_000],
  ['20m', 14_000_000, 14_350_000],
  ['17m', 18_068_000, 18_168_000],
  ['15m', 21_000_000, 21_450_000],
  ['12m', 24_890_000, 24_990_000],
  ['10m', 28_000_000, 29_700_000],
  ['8m', 40_000_000, 45_000_000],
  ['6m', 50_000_000, 54_000_000],
  ['5m', 54_000_001, 69_900_000],
  ['4m', 70_000_000, 71_000_000],
  ['2m', 144_000_000, 148_000_000],
  ['1.25m', 222_000_000, 225_000_000],
  ['70cm', 420_000_000, 450_000_000],
  ['33cm', 902_000_000, 928_000_000],
  ['23cm', 1_240_000_000, 1_300_000_000],
  ['13cm', 2_300_000_000, 2_450_000_000],
  ['9cm', 3_300_000_000, 3_500_000_000],
  ['6cm', 5_650_000_000, 5_925_000_000],
  ['3cm', 10_000_000_000, 10_500_000_000],
  ['1.25cm', 24_000_000_000, 24_250_000_000],
  ['6mm', 47_000_000_000, 47_200_000_000],
  ['4mm', 75_500_000_000, 81_000_000_000],
  ['2.5mm', 119_980_000_000, 123_000_000_000],
  ['2mm', 134_000_000_000, 149_000_000_000],
  ['1mm', 241_000_000_000, 250_000_000_000],
];

/** The ADIF band for a frequency in Hz, such as 20m, or null outside every band. */
export function bandOfHz(hz: number): string | null {
  for (const [name, lo, hi] of BANDS) if (hz >= lo && hz <= hi) return name;
  return null;
}

export type FreqUnit = 'Hz' | 'kHz' | 'MHz' | 'GHz';

const FACTOR: Record<FreqUnit, number> = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 };

/** Units tried, in order, after the source's own when a number lands outside every band in it. */
const FALLBACK: readonly FreqUnit[] = ['MHz', 'kHz', 'Hz'];

/**
 * Reads a spotted frequency, Hz. `unit` is the unit the source documents (POTA kHz, SOTA MHz).
 * A unit written after the number wins. Without one, a number that falls outside every amateur
 * band in the source's unit is tried in MHz, kHz and Hz, and the first that lands in a band is
 * kept: spotters type 14.074 into a kHz field and 14074 into a MHz one. A number that lands in no
 * band in any unit is kept in the source's unit. Returns null for text without a positive number.
 *
 * A single comma is a decimal separator ("14,074" is 14.074). Commas group thousands when the
 * text also has a full stop ("14,074.5") or more than one comma ("1,296,200"). Both readings of
 * "14,074" give one frequency after the unit fallback.
 */
export function parseFrequencyHz(raw: unknown, unit: Exclude<FreqUnit, 'Hz' | 'GHz'>): number | null {
  let value: number;
  let written: FreqUnit | null = null;
  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string') {
    const m = /^\s*([0-9][0-9.,]*)\s*([kMG]?Hz)?\s*$/i.exec(raw);
    if (!m) return null;
    const commas = (m[1].match(/,/g) ?? []).length;
    const digits = m[1].includes('.') || commas > 1 ? m[1].replace(/,/g, '') : m[1].replace(',', '.');
    if ((digits.match(/\./g) ?? []).length > 1) return null;
    value = Number(digits);
    if (m[2]) written = (['Hz', 'kHz', 'MHz', 'GHz'] as const).find((u) => u.toLowerCase() === m[2].toLowerCase()) ?? null;
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  if (written) return Math.round(value * FACTOR[written]);
  for (const u of [unit, ...FALLBACK.filter((f) => f !== unit)]) {
    const hz = Math.round(value * FACTOR[u]);
    if (bandOfHz(hz) !== null) return hz;
  }
  return Math.round(value * FACTOR[unit]);
}
