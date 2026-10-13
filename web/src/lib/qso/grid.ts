/** Maidenhead grid squares: centre position, distance and bearing. */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Centre of a 4- or 6-character grid square, degrees; null for anything else. */
export function gridCentre(grid: string): LatLon | null {
  const g = grid.trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += ((g.charCodeAt(4) - 65) * 5) / 60 + 2.5 / 60;
    lat += ((g.charCodeAt(5) - 65) * 2.5) / 60 + 1.25 / 60;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

const RAD = Math.PI / 180;
const EARTH_KM = 6371;

/** Great-circle distance, km, and initial bearing, degrees from north, between two grids. */
export function pathBetween(from: string, to: string): { km: number; bearing: number } | null {
  const a = gridCentre(from);
  const b = gridCentre(to);
  if (!a || !b) return null;
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δφ = (b.lat - a.lat) * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = ((Math.atan2(y, x) / RAD) + 360) % 360;
  return { km, bearing };
}
