import { describe, expect, it } from 'vitest';
import { FINE_ACCURACY_M, gridFromPosition, locateGrid } from './locate';

/** A Geolocation that answers getCurrentPosition once with `answer`, and records the options. */
function fakeGeo(answer: { coords: Partial<GeolocationCoordinates> } | { code: number }) {
  const calls: (PositionOptions | undefined)[] = [];
  const geo = {
    getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, options?: PositionOptions) {
      calls.push(options);
      if ('code' in answer) fail?.({ code: answer.code, message: '' } as GeolocationPositionError);
      else ok({ coords: answer.coords, timestamp: 0 } as GeolocationPosition);
    },
  } as unknown as Geolocation;
  return { geo, calls };
}

// Singapore, OJ11vi.
const SG = { latitude: 1.3521, longitude: 103.8198 };

describe('gridFromPosition', () => {
  it('gives the 6-character grid for a fine fix', () => {
    expect(gridFromPosition({ ...SG, accuracy: 30 }, 6)).toEqual({ ok: true, grid: 'OJ11vi', accuracyM: 30, note: '' });
  });

  it('gives the 4-character square and says why when the fix is coarse', () => {
    const r = gridFromPosition({ ...SG, accuracy: 3200 }, 6);
    expect(r).toMatchObject({ ok: true, grid: 'OJ11' });
    expect(r.ok && r.note).toBe('Position accurate to 3.2 km, so the grid has 4 characters. For 6, try again in the open.');
  });

  it('treats the accuracy limit itself as fine and an unknown accuracy as coarse', () => {
    expect(gridFromPosition({ ...SG, accuracy: FINE_ACCURACY_M }, 6)).toMatchObject({ grid: 'OJ11vi', note: '' });
    expect(gridFromPosition({ ...SG, accuracy: Number.NaN }, 6)).toMatchObject({ grid: 'OJ11' });
  });

  it('never shortens a 4-character request', () => {
    expect(gridFromPosition({ ...SG, accuracy: 50_000 }, 4)).toMatchObject({ grid: 'OJ11', note: '' });
  });
});

describe('locateGrid', () => {
  it('asks for one high-accuracy fix with a 20 s timeout and fixes up to 60 s old', async () => {
    const { geo, calls } = fakeGeo({ coords: { ...SG, accuracy: 12 } });
    await expect(locateGrid(6, geo)).resolves.toMatchObject({ ok: true, grid: 'OJ11vi' });
    expect(calls).toEqual([{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 }]);
  });

  it('says what to do when location is refused, slow or unavailable', async () => {
    await expect(locateGrid(6, fakeGeo({ code: 1 }).geo)).resolves.toEqual({ ok: false, message: 'Location is off for RR73. Allow it in iOS Settings › Privacy, or type the grid.' });
    await expect(locateGrid(6, fakeGeo({ code: 3 }).geo)).resolves.toEqual({ ok: false, message: 'No position within 20 s. Type the grid, or try again in the open.' });
    await expect(locateGrid(6, fakeGeo({ code: 2 }).geo)).resolves.toEqual({ ok: false, message: 'The phone could not find its position. Type the grid.' });
  });

  it('says so when the browser has no geolocation', async () => {
    await expect(locateGrid(6, undefined)).resolves.toEqual({ ok: false, message: 'This browser gives RR73 no location. Type the grid.' });
  });
});
