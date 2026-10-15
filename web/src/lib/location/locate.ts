/**
 * The phone's position as a Maidenhead grid, for Settings and the activation form. Callers get the
 * grid, the fix's accuracy and the position; RR73 stores the grid only. The activation form uses the
 * position once, to find the parks and summits nearby.
 *
 * A 6-character subsquare is 5' of longitude by 2.5' of latitude, about 4.6 km north to south. A
 * fix less accurate than `FINE_ACCURACY_M` can land in the wrong subsquare, so it gives the
 * 4-character square and says why.
 */

import { gridFromLatLon } from '../log/activation';

/** Worst accuracy, m, for which a 6- or 8-character grid is given. */
export const FINE_ACCURACY_M = 1000;

/** How long to wait for a fix, ms. */
export const LOCATE_TIMEOUT_MS = 20_000;

/** Oldest cached fix accepted, ms: a tap after moving to a new site gets a new fix. */
export const LOCATE_MAX_AGE_MS = 60_000;

export type LocateResult =
  | { ok: true; grid: string; accuracyM: number; note: string; at: { lat: number; lon: number } }
  | { ok: false; message: string };

// GeolocationPositionError codes; the constants are missing outside browsers.
const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

function accuracyText(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Turns one position into a grid of `chars` characters, or 4 when the fix is too coarse. */
export function gridFromPosition(coords: Pick<GeolocationCoordinates, 'latitude' | 'longitude' | 'accuracy'>, chars: 4 | 6 | 8): LocateResult {
  const coarse = chars > 4 && !(coords.accuracy <= FINE_ACCURACY_M);
  const grid = gridFromLatLon(coords.latitude, coords.longitude, coarse ? 4 : chars);
  const note = coarse
    ? `Position accurate to ${Number.isFinite(coords.accuracy) ? accuracyText(coords.accuracy) : 'an unknown distance'}, so the grid has 4 characters. For ${chars}, try again in the open.`
    : '';
  return { ok: true, grid, accuracyM: coords.accuracy, note, at: { lat: coords.latitude, lon: coords.longitude } };
}

/**
 * Asks for one fix and returns the grid. Call from a tap: iOS shows its permission prompt on the
 * first request. Never rejects; failures come back as `{ ok: false, message }` in the style guide's
 * voice.
 */
export function locateGrid(
  chars: 4 | 6 | 8 = 6,
  geo: Geolocation | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
): Promise<LocateResult> {
  if (!geo) return Promise.resolve({ ok: false, message: 'This browser gives RR73 no location. Type the grid.' });
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (p) => resolve(gridFromPosition(p.coords, chars)),
      (err) =>
        resolve({
          ok: false,
          message:
            err.code === PERMISSION_DENIED
              ? 'Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.'
              : err.code === TIMEOUT
                ? 'No position within 20 s. Type the grid, or try again in the open.'
                : 'The phone could not find its position. Type the grid.',
        }),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: LOCATE_MAX_AGE_MS },
    );
  });
}
