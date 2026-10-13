import { describe, expect, it } from 'vitest';
import { distanceKm, gridFromLatLon } from './grid';
import type { PotaRow, RefIndexJson, SotaShardJson } from './format';
import { parkList, splitReference, summitList, type Park } from './refs';
import { HttpStore, ReferenceUnavailableError } from './store';
import { MemoryCaches, ORIGIN, fakeOrigin } from './testing';

// Hand-written parks; positions follow the POTA list where a real park is named.
const PARKS: Record<string, PotaRow[]> = {
  AU: [['0001', 'Melbourne Test Park', -37.8, 145.0, 1]],
  JA: [['0001', 'Tokyo Test Park', 35.6, 139.7, 1]],
  MY: [
    ['0001', 'Taman Negara Test Park', 4.5, 102.4, 1],
    ['0023', 'Taman Rimba Ampang', null, null, 1],
  ],
  SG: [
    ['0001', 'Admiralty National Park', 1.4484, 103.779, 1],
    ['0002', 'Ang Mo Kio Town Garden East National Park', 1.3707, 103.85, 1],
    ['0099', 'Closed Test Park', 1.3, 103.8, 0],
  ],
  US: [
    ['0001', 'Acadia National Park', 44.31, -68.2034, 1],
    ['0002', 'Alagnak Wild River National Park', 59.0908, -156.463, 1],
  ],
};

/** Files for one build of a programme: index.<version>.json and <KEY>.<version>.json shards. */
function potaFiles(version: string, parks: Record<string, PotaRow[]>) {
  const files: Record<string, unknown> = {};
  const index: RefIndexJson = { format: 1, programme: 'POTA', separator: '-', count: 0, shards: [] };
  for (const key of Object.keys(parks).sort()) {
    const rows = parks[key];
    const squares = [...new Set(rows.filter((r) => r[2] !== null && r[3] !== null).map((r) => gridFromLatLon(r[2]!, r[3]!, 4)))].sort().join('');
    index.shards.push({ key, file: `${key}.${version}.json`, count: rows.length, bytes: 100 * rows.length, squares });
    index.count += rows.length;
    files[`pota/${key}.${version}.json`] = { format: 1, programme: 'POTA', key, rows };
  }
  files[`pota/index.${version}.json`] = index;
  return files;
}

function setup(files: Record<string, unknown>, entry = 'pota/index.v1.json') {
  const origin = fakeOrigin(files);
  const caches = new MemoryCaches();
  const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: caches.asStorage() });
  const state = { entry };
  const parks = parkList(store, () => Promise.resolve(state.entry));
  return { origin, store, parks, state };
}

const SINGAPORE = { lat: 1.35, lon: 103.82 };

describe('splitReference', () => {
  it('reads POTA and SOTA references', () => {
    expect(splitReference('POTA', ' sg-0001 ')).toEqual({ ref: 'SG-0001', key: 'SG', id: '0001' });
    expect(splitReference('POTA', 'US-12345')).toEqual({ ref: 'US-12345', key: 'US', id: '12345' });
    expect(splitReference('SOTA', 'w7o/cn-001')).toEqual({ ref: 'W7O/CN-001', key: 'W7O', id: 'CN-001' });
    expect(splitReference('SOTA', '3B8/MU-001')).toEqual({ ref: '3B8/MU-001', key: '3B8', id: 'MU-001' });
    for (const s of ['SG0001', 'K-TEST', 'W7O/CN-1', 'SG-0001/P']) {
      expect(splitReference('POTA', s), s).toBeNull();
      expect(splitReference('SOTA', s), s).toBeNull();
    }
  });
});

describe('parks', () => {
  it('finds a park by reference, loading only its shard', async () => {
    const { parks, origin } = setup(potaFiles('v1', PARKS));
    const park = await parks.get('sg-0001');
    expect(park).toEqual<Park>({ programme: 'POTA', ref: 'SG-0001', name: 'Admiralty National Park', lat: 1.4484, lon: 103.779, grid: 'OJ11vk', active: true });
    expect(origin.state.requests).toEqual(['pota/index.v1.json', 'pota/SG.v1.json']);
    expect(await parks.get('MY-0023')).toMatchObject({ lat: null, lon: null, grid: null });
    expect(await parks.get('SG-0003')).toBeNull();
    expect(await parks.get('XX-0001')).toBeNull();
    expect(await parks.get('not a park')).toBeNull();
    expect(await parks.count()).toBe(9);
    expect(await parks.available()).toBe(true);
  });

  it('gives the nearest active parks with distance and bearing, reading only the shards it needs', async () => {
    const { parks, origin } = setup(potaFiles('v1', PARKS));
    const near = await parks.nearest(SINGAPORE, { limit: 3 });
    expect(near.complete).toBe(true);
    expect(near.refs.map((n) => n.ref.ref)).toEqual(['SG-0002', 'SG-0001', 'MY-0001']);
    expect(near.refs[0].km).toBeCloseTo(distanceKm(SINGAPORE, { lat: 1.3707, lon: 103.85 }), 9);
    expect(near.refs[2].bearingDeg).toBeGreaterThan(270);
    expect(origin.state.requests.sort()).toEqual(['pota/MY.v1.json', 'pota/SG.v1.json', 'pota/index.v1.json']);
    const all = await parks.nearest(SINGAPORE, { limit: 3, includeInactive: true });
    expect(all.refs.map((n) => n.ref.ref)).toEqual(['SG-0002', 'SG-0099', 'SG-0001']);
    const close = await parks.nearest(SINGAPORE, { maxKm: 10 });
    expect(close.refs.map((n) => n.ref.ref)).toEqual(['SG-0002']);
  });

  it('matches a full scan for random parks and positions', async () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const many: Record<string, PotaRow[]> = {};
    for (let s = 0; s < 30; s++) {
      const key = `K${String.fromCharCode(65 + (s % 26))}${s >= 26 ? 'X' : ''}`;
      const c = { lat: rnd() * 150 - 75, lon: rnd() * 360 - 180 };
      many[key] = Array.from({ length: 40 }, (_, i): PotaRow => {
        const lat = Math.max(-89, Math.min(89, c.lat + (rnd() - 0.5) * 30));
        const lon = ((c.lon + (rnd() - 0.5) * 40 + 540) % 360) - 180;
        return [String(i).padStart(4, '0'), `Park ${key}-${i}`, Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, rnd() < 0.9 ? 1 : 0];
      });
    }
    const { parks } = setup(potaFiles('v1', many));
    const everything = Object.entries(many).flatMap(([key, rows]) => rows.filter((r) => r[4] === 1).map((r) => ({ ref: `${key}-${r[0]}`, lat: r[2]!, lon: r[3]! })));
    for (let q = 0; q < 40; q++) {
      const at = { lat: rnd() * 180 - 90, lon: rnd() * 360 - 180 };
      const expected = everything
        .map((p) => ({ ref: p.ref, km: distanceKm(at, p) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 7);
      const got = await parks.nearest(at, { limit: 7 });
      expect(got.refs.map((n) => n.km)).toEqual(expected.map((e) => e.km));
    }
  });

  it('keeps shards for offline use and reports what is on the phone', async () => {
    const { parks, origin } = setup(potaFiles('v1', PARKS));
    await parks.get('SG-0001');
    expect(await parks.offline()).toEqual({ shardsKept: 1, shardsTotal: 5, shardsCurrent: 1, refsKept: 3, refsTotal: 9, bytesKept: 300, bytesTotal: 900 });
    expect((await parks.keepNear(SINGAPORE, 1000)).shardsKept).toBe(2);
    const progress: number[] = [];
    expect((await parks.keepAll((done) => progress.push(done))).shardsKept).toBe(5);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    origin.state.offline = true;
    const { parks: again } = { parks: parkList(new HttpStore(ORIGIN, { fetch: origin.fetch, caches: null }), () => Promise.resolve('pota/index.v1.json')) };
    await expect(again.get('SG-0001')).rejects.toBeInstanceOf(ReferenceUnavailableError);
  });

  it('serves kept copies offline after an app update, and replaces them once online', async () => {
    const v2 = { ...PARKS, SG: [['0001', 'Admiralty Park (renamed)', 1.4484, 103.779, 1]] as PotaRow[] };
    const { parks, origin, store, state } = setup({ ...potaFiles('v1', PARKS), ...potaFiles('v2', v2) });
    await parks.keepAll();
    // The app updates to a build whose manifest names index v2, then the phone goes offline.
    origin.state.offline = true;
    state.entry = 'pota/index.v2.json';
    const offline = parkList(store, () => Promise.resolve(state.entry));
    expect((await offline.get('SG-0001'))?.name).toBe('Admiralty National Park');
    expect((await offline.offline()).shardsCurrent).toBe(5);
    origin.state.offline = false;
    const online = parkList(store, () => Promise.resolve(state.entry));
    expect((await online.get('SG-0001'))?.name).toBe('Admiralty Park (renamed)');
    expect(await online.offline()).toMatchObject({ shardsKept: 5, shardsCurrent: 1 });
  });

  it('asks for the current index again once an older kept one has stood in', async () => {
    const files: Record<string, unknown> = potaFiles('v1', PARKS);
    const { parks, origin, store, state } = setup(files);
    await parks.get('SG-0001');
    // A deploy replaces the v1 files with v2 ones while the phone is offline and the app updates.
    for (const k of Object.keys(files)) delete files[k];
    Object.assign(files, potaFiles('v2', PARKS));
    state.entry = 'pota/index.v2.json';
    origin.state.offline = true;
    const list = parkList(store, () => Promise.resolve(state.entry));
    expect((await list.get('SG-0001'))?.name).toBe('Admiralty National Park');
    origin.state.offline = false;
    expect((await list.get('US-0001'))?.name).toBe('Acadia National Park');
  });

  it('marks a nearest search incomplete when a shard it needs is unreachable', async () => {
    const { parks, origin } = setup(potaFiles('v1', PARKS));
    await parks.get('SG-0001');
    origin.state.offline = true;
    const near = await parks.nearest(SINGAPORE, { limit: 3 });
    expect(near.complete).toBe(false);
    expect(near.refs.map((n) => n.ref.ref)).toEqual(['SG-0002', 'SG-0001']);
  });

  it('drops shards whose key left the list, and forgets everything on request', async () => {
    const withoutUs = { ...PARKS };
    delete withoutUs.US;
    const { parks, store, state } = setup({ ...potaFiles('v1', PARKS), ...potaFiles('v2', withoutUs) });
    await parks.keepAll();
    state.entry = 'pota/index.v2.json';
    const next = parkList(store, () => Promise.resolve(state.entry));
    await next.count();
    await new Promise((r) => setTimeout(r, 0));
    expect([...(await store.keptFiles('pota/')).keys()]).not.toContain('pota/US.json');
    await next.forget();
    expect(await store.keptFiles('pota/')).toEqual(new Map());
  });

  it('is unavailable when the build has no park list', async () => {
    const { parks } = setup({}, '');
    expect(await parks.available()).toBe(false);
    await expect(parks.get('SG-0001')).rejects.toMatchObject({ problem: 'missing' });
  });
});

describe('summits', () => {
  const shard: SotaShardJson = {
    format: 1,
    programme: 'SOTA',
    key: 'XA',
    association: 'Sample Association',
    regions: { AA: 'Alpha Hills', BB: 'Bravo Range' },
    rows: [
      ['AA-001', 'Alpha Peak', 50, 10, 1200, 8, 20100101, 0],
      ['AA-003', 'Retired Knoll', 50.02, 10.05, 420, 1, 20100101, 20201231],
      ['BB-001', 'Future Fell', 50.5, 11, 900, 6, 20300101, 0],
      ['BB-003', 'Last Day Hill', 50.1, 10.2, 500, 2, 20100101, 20261013],
    ],
  };
  const index: RefIndexJson = { format: 1, programme: 'SOTA', separator: '/', count: 4, shards: [{ key: 'XA', file: 'XA.v1.json', count: 4, bytes: 400, squares: 'JO50', name: 'Sample Association' }] };

  function summits() {
    const origin = fakeOrigin({ 'sota/index.v1.json': index, 'sota/XA.v1.json': shard });
    const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: new MemoryCaches().asStorage() });
    return summitList(store, () => Promise.resolve('sota/index.v1.json'), () => new Date('2026-10-13T12:00:00Z'));
  }

  it('reads a summit with its association, region, height, points and validity', async () => {
    expect(await summits().get('xa/aa-001')).toEqual({
      programme: 'SOTA',
      ref: 'XA/AA-001',
      name: 'Alpha Peak',
      lat: 50,
      lon: 10,
      grid: 'JO50aa',
      active: true,
      association: 'Sample Association',
      region: 'Alpha Hills',
      altM: 1200,
      points: 8,
      validFrom: '2010-01-01',
      validTo: null,
    });
  });

  it('counts a summit only between its valid-from and valid-to dates', async () => {
    const list = summits();
    expect(await list.get('XA/AA-003')).toMatchObject({ active: false, validTo: '2020-12-31' });
    expect(await list.get('XA/BB-001')).toMatchObject({ active: false, validFrom: '2030-01-01' });
    expect(await list.get('XA/BB-003')).toMatchObject({ active: true, validTo: '2026-10-13' });
    const near = await list.nearest({ lat: 50, lon: 10 });
    expect(near.refs.map((n) => n.ref.ref)).toEqual(['XA/AA-001', 'XA/BB-003']);
    const all = await list.nearest({ lat: 50, lon: 10 }, { includeInactive: true });
    expect(all.refs.map((n) => n.ref.ref)).toEqual(['XA/AA-001', 'XA/AA-003', 'XA/BB-003', 'XA/BB-001']);
  });
});
