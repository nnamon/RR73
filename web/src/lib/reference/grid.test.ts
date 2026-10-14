import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  distanceKm,
  distanceToBoundsKm,
  gridBounds,
  gridCentre,
  gridFromLatLon,
  gridPath,
  isGrid,
  normaliseGrid,
  type GridBounds,
  type LatLon,
} from './grid';

/** Deterministic pseudo-random numbers in [0, 1): mulberry32. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('locators', () => {
  it('validates 4, 6 and 8 characters in either case', () => {
    for (const g of ['QF22', 'qf22lb', 'QF22LB37', 'AA00aa', 'RR99xx99']) expect(isGrid(g), g).toBe(true);
    for (const g of ['QF2', 'ZZ22', 'QF22LZ', 'QF22lb3', 'QF22 lb', '', 'Q F22']) expect(isGrid(g), g).toBe(false);
  });

  it('writes field and square upper case, subsquare lower case', () => {
    expect(normaliseGrid(' qf22LB ')).toBe('QF22lb');
    expect(normaliseGrid('fn31pr37')).toBe('FN31pr37');
    expect(normaliseGrid('QF2')).toBe('');
  });

  it('gives bounds and centres for 4, 6 and 8 characters', () => {
    expect(gridBounds('OJ11')).toEqual({ south: 1, west: 102, north: 2, east: 104 });
    expect(gridCentre('OJ11')).toEqual({ lat: 1.5, lon: 103 });
    expect(gridCentre('PM95')).toEqual({ lat: 35.5, lon: 139 });
    expect(gridCentre('QF22')).toEqual({ lat: -37.5, lon: 145 });
    const xi = gridCentre('OJ11xi');
    expect(xi?.lat).toBeCloseTo(1.354167, 6);
    expect(xi?.lon).toBeCloseTo(103.958333, 6);
    // FN31pr37: lon -80 + 6 + 15 x 5' + 3 x 30" + 15", lat 40 + 1 + 17 x 2.5' + 7 x 15" + 7.5".
    const ext = gridCentre('FN31pr37');
    expect(ext?.lon).toBeCloseTo(-72.7208333, 6);
    expect(ext?.lat).toBeCloseTo(41.7395833, 6);
    expect(gridCentre('nonsense')).toBeNull();
  });

  it('finds the locator of a position', () => {
    // W1AW, Newington, Connecticut, 41.7148 N 72.7272 W.
    expect(gridFromLatLon(41.7148, -72.7272)).toBe('FN31pr');
    expect(gridFromLatLon(41.7148, -72.7272, 4)).toBe('FN31');
    expect(gridFromLatLon(41.7148, -72.7272, 2)).toBe('FN');
    expect(gridFromLatLon(1.4484, 103.779)).toBe('OJ11vk');
    expect(gridFromLatLon(90, 180, 8)).toBe('RR99xx99');
    expect(gridFromLatLon(-90, -180, 8)).toBe('AA00aa00');
  });

  it('round-trips the centre of every kind of locator', () => {
    const rnd = random(7);
    const L = (n: number, base: number) => String.fromCharCode(base + Math.floor(rnd() * n));
    const D = () => String(Math.floor(rnd() * 10));
    for (let i = 0; i < 2000; i++) {
      const g = L(18, 65) + L(18, 65) + D() + D() + L(24, 97) + L(24, 97) + D() + D();
      for (const n of [4, 6, 8] as const) {
        const c = gridCentre(g.slice(0, n));
        expect(c && gridFromLatLon(c.lat, c.lon, n)).toBe(g.slice(0, n).slice(0, 4).toUpperCase() + g.slice(4, n));
      }
    }
  });
});

// Reference values, computed outside this code on 13 October 2026 for the centres of each pair:
// - sphere: the Vincenty formula on a sphere of radius 6371 km (an independent formula from the
//   haversine used here), distance and initial bearing;
// - WGS84: GeographicLib 2.0 for Python, Geodesic.WGS84.Inverse (C. F. F. Karney, "Algorithms
//   for geodesics", J. Geodesy 87, 43-55, 2013), distance s12 and azimuth azi1.
const PATHS: [from: string, to: string, sphereKm: number, sphereDeg: number, wgs84Km: number, wgs84Deg: number][] = [
  ['OJ11', 'PM95', 5298.861, 40.35, 5291.101, 40.514],
  ['OJ11', 'QF22', 6116.791, 139.61, 6108.136, 139.449],
  ['PM95', 'QF22', 8140.788, 175.031, 8105.8, 175.005],
  ['FN31', 'OJ11', 15216.692, 5.852, 15225.027, 5.812],
  ['QF22', 'BL11', 8931.805, 53.17, 8915.646, 53.347],
  ['JO01', 'FN31', 5523.931, 289.216, 5539.067, 289.252],
  ['OJ11xi', 'QF22lb', 6061.475, 140.545, 6052.431, 140.384],
  ['IO91', 'RE78', 18862.214, 16.876, 18852.233, 16.489],
];

describe('great-circle paths', () => {
  it.each(PATHS)('%s to %s', (from, to, sphereKm, sphereDeg, wgs84Km, wgs84Deg) => {
    const path = gridPath(from, to);
    expect(path).not.toBeNull();
    expect(Math.abs(path!.km - sphereKm)).toBeLessThan(0.01);
    expect(Math.abs(path!.bearingDeg - sphereDeg)).toBeLessThan(0.01);
    expect(Math.abs(path!.km - wgs84Km) / wgs84Km).toBeLessThan(0.005);
    expect(Math.abs(path!.bearingDeg - wgs84Deg)).toBeLessThan(0.5);
  });

  it('handles the same point, the poles and bad locators', () => {
    const p = { lat: 10, lon: 20 };
    expect(distanceKm(p, p)).toBe(0);
    expect(bearingDeg(p, p)).toBe(0);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBe(0);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBe(180);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 9);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371, 6);
    expect(gridPath('OJ11', 'XX99')).toBeNull();
  });
});

describe('distance to a box', () => {
  /** A Maidenhead field, 20° by 10°: the largest box the search could meet. */
  const fieldBox = (f: string): GridBounds => {
    const west = (f.charCodeAt(0) - 65) * 20 - 180;
    const south = (f.charCodeAt(1) - 65) * 10 - 90;
    return { south, west, north: south + 10, east: west + 20 };
  };

  /** Smallest distance to a dense sample of the box's points. */
  function sampled(p: LatLon, b: GridBounds, n = 160): number {
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const q = { lat: b.south + ((b.north - b.south) * i) / n, lon: b.west + ((b.east - b.west) * j) / n };
        best = Math.min(best, distanceKm(p, q));
      }
    }
    return best;
  }

  it('is 0 inside and the meridian distance within the longitudes', () => {
    const fn = fieldBox('FN');
    expect(distanceToBoundsKm({ lat: 45, lon: -70 }, fn)).toBe(0);
    expect(distanceToBoundsKm({ lat: 55, lon: -70 }, fn)).toBeCloseTo((5 * Math.PI * 6371) / 180, 6);
  });

  it('matches a dense sample of each box for random points, fields and squares', () => {
    const rnd = random(42);
    for (let i = 0; i < 400; i++) {
      const field = String.fromCharCode(65 + Math.floor(rnd() * 18), 65 + Math.floor(rnd() * 18));
      const square = field + Math.floor(rnd() * 10) + Math.floor(rnd() * 10);
      const b = i % 2 ? fieldBox(field) : gridBounds(square)!;
      const p = i % 4 === 0 ? { lat: b.south + (rnd() - 0.5) * 8, lon: b.west + (rnd() - 0.5) * 8 } : { lat: rnd() * 180 - 90, lon: rnd() * 360 - 180 };
      p.lat = Math.max(-90, Math.min(90, p.lat));
      const exact = distanceToBoundsKm(p, b);
      const s = sampled(p, b);
      // Never above the sample (the search's lower bound must hold), and within the sample's spacing.
      expect(exact, `${i % 2 ? field : square} from ${p.lat},${p.lon}`).toBeLessThanOrEqual(s + 1e-6);
      expect(s - exact, `${i % 2 ? field : square} from ${p.lat},${p.lon}`).toBeLessThan(20);
    }
  });
});
