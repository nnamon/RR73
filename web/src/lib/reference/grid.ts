/**
 * Maidenhead locators and great-circle paths.
 *
 * A locator is a field (2 letters A to R: 20° of longitude by 10° of latitude), a square (2
 * digits: 2° by 1°), a subsquare (2 letters A to X: 5' by 2.5') and an extended square (2
 * digits: 30" by 15"). Longitude comes first in each pair, counted east from 180° W; latitude
 * north from 90° S.
 *
 * Distances use a sphere of radius 6371 km (the IUGG mean Earth radius, rounded). Against the
 * WGS84 ellipsoid the error stays under 0.5 %: 8 km on the 5291 km path from OJ11 to PM95.
 */

export interface LatLon {
  /** Degrees, north positive. */
  lat: number;
  /** Degrees, east positive. */
  lon: number;
}

export interface GridBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6371;

const GRID = /^[A-R]{2}[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?$/i;
const RAD = Math.PI / 180;

/** True for a 4, 6 or 8 character locator, in either case: QF22, qf22lb, QF22LB37. */
export function isGrid(s: string): boolean {
  return GRID.test(s.trim());
}

/** Field and square upper case, subsquare lower case, as WSJT-X writes them: "qf22LB" gives "QF22lb". "" when not a locator. */
export function normaliseGrid(s: string): string {
  const t = s.trim();
  if (!GRID.test(t)) return '';
  return t.slice(0, 4).toUpperCase() + t.slice(4, 6).toLowerCase() + t.slice(6);
}

/** The area a locator covers, degrees. Null when not a locator. */
export function gridBounds(grid: string): GridBounds | null {
  const g = grid.trim().toUpperCase();
  if (!GRID.test(g)) return null;
  const A = 65;
  let west = (g.charCodeAt(0) - A) * 20 - 180 + Number(g[2]) * 2;
  let south = (g.charCodeAt(1) - A) * 10 - 90 + Number(g[3]);
  let w = 2;
  let h = 1;
  if (g.length >= 6) {
    w /= 24;
    h /= 24;
    west += (g.charCodeAt(4) - A) * w;
    south += (g.charCodeAt(5) - A) * h;
  }
  if (g.length === 8) {
    w /= 10;
    h /= 10;
    west += Number(g[6]) * w;
    south += Number(g[7]) * h;
  }
  return { south, west, north: south + h, east: west + w };
}

/** Centre of a locator, degrees. Null when not a locator. */
export function gridCentre(grid: string): LatLon | null {
  const b = gridBounds(grid);
  return b && { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

/** The locator holding a position: 6 characters by default (QF22lb), or 2 (the field), 4 or 8. */
export function gridFromLatLon(lat: number, lon: number, chars: 2 | 4 | 6 | 8 = 6): string {
  // Positions on the 180° meridian and the North Pole belong to the last field.
  const x = Math.min(Math.max(lon + 180, 0), 360 - 1e-9);
  const y = Math.min(Math.max(lat + 90, 0), 180 - 1e-9);
  const letter = (n: number, base: number) => String.fromCharCode(base + Math.floor(n));
  let g = letter(x / 20, 65) + letter(y / 10, 65);
  if (chars === 2) return g;
  g += String(Math.floor((x % 20) / 2)) + String(Math.floor(y % 10));
  if (chars === 4) return g;
  const sx = ((x % 2) / 2) * 24;
  const sy = (y % 1) * 24;
  g += letter(sx, 97) + letter(sy, 97);
  if (chars === 6) return g;
  return g + String(Math.floor((sx % 1) * 10)) + String(Math.floor((sy % 1) * 10));
}

const hav = (x: number) => (1 - Math.cos(x)) / 2;

/** Great-circle distance, km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const h = hav((b.lat - a.lat) * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * hav((b.lon - a.lon) * RAD);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, degrees clockwise from true north, 0 to 360. 0 for the same point. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) return 0;
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

/** Distance (km) and initial bearing (degrees) between the centres of two locators, as from the operator's grid. Null when either is not a locator. */
export function gridPath(from: string, to: string): { km: number; bearingDeg: number } | null {
  const a = gridCentre(from);
  const b = gridCentre(to);
  if (!a || !b) return null;
  return { km: distanceKm(a, b), bearingDeg: bearingDeg(a, b) };
}

/**
 * Shortest great-circle distance from a point to any point of a latitude and longitude box, km;
 * 0 inside it. The box must not cross the 180° meridian.
 *
 * Inside the box's longitudes the nearest point lies on the same meridian. Outside them it lies on
 * the nearer edge meridian: at an end of the edge, or at the foot of the perpendicular from the
 * point to that meridian's great circle when the foot falls on the edge.
 */
export function distanceToBoundsKm(p: LatLon, b: GridBounds): number {
  const clampLat = Math.min(Math.max(p.lat, b.south), b.north);
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  if (wrap(p.lon - b.west) >= 0 && wrap(b.east - p.lon) >= 0 && b.east - b.west < 360) {
    return EARTH_RADIUS_KM * Math.abs(p.lat - clampLat) * RAD;
  }
  const edge = Math.abs(wrap(p.lon - b.west)) <= Math.abs(wrap(p.lon - b.east)) ? b.west : b.east;
  const candidates = [b.south, b.north];
  // The meridian's half circle at `edge`: the point's component along it and along the axis.
  const along = Math.cos(p.lat * RAD) * Math.cos((p.lon - edge) * RAD);
  const foot = Math.atan2(Math.sin(p.lat * RAD), along) / RAD;
  if (along >= 0 && foot >= b.south && foot <= b.north) candidates.push(foot);
  return Math.min(...candidates.map((lat) => distanceKm(p, { lat, lon: edge })));
}
