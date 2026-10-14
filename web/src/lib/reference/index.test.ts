import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManifestJson, ManifestSource } from './format';
import { createReferenceData, HttpStore, ReferenceUnavailableError } from './index';
import { MemoryCaches, ORIGIN, fakeOrigin } from './testing';

const CTY = {
  format: 1,
  version: '2026-09-15',
  source: 'test',
  notice: 'MIT',
  entities: [
    { name: 'Singapore', prefix: '9V', wae: false, dxcc: 381, cq: 28, itu: 54, cont: 'AS', lat: 1.37, lon: 103.78, utc: 8, aliases: '9V S6' },
    { name: 'Australia', prefix: 'VK', wae: false, dxcc: 150, cq: 30, itu: 59, cont: 'OC', lat: -23.7, lon: 132.33, utc: 10, aliases: 'VK VK6(29)[58]' },
  ],
};
const LOTW = { format: 1, latest: '2026-10-11', count: 1, byDate: { '2026-10-11': '9V1NE' } };

function source(entry: string | null): ManifestSource {
  return {
    title: 't',
    status: entry ? 'ok' : 'missing',
    url: 'u',
    publisher: 'p',
    terms: 't',
    fetchedAt: null,
    checkedAt: null,
    dataDate: null,
    rawBytes: null,
    records: null,
    entry,
    files: entry ? 1 : 0,
    bytes: 0,
    gzipBytes: 0,
  };
}

const MANIFEST: ManifestJson = {
  format: 1,
  generatedAt: '2026-10-13T00:00:00Z',
  sources: { cty: source('cty.json'), lotw: source('lotw.abc.json'), pota: source('pota/index.abc.json'), sota: source(null) },
};

function setup(files: Record<string, unknown> = { 'manifest.json': MANIFEST, 'cty.json': CTY, 'lotw.abc.json': LOTW }) {
  const origin = fakeOrigin(files);
  const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: new MemoryCaches().asStorage() });
  return { origin, store, ref: createReferenceData(store) };
}

afterEach(() => vi.useRealTimers());

describe('reference data', () => {
  it('makes no request until asked, and none for features that are off', async () => {
    const { origin, ref } = setup();
    expect(ref.parks(false)).toBeNull();
    expect(ref.summits(false)).toBeNull();
    expect(await ref.lotw(false)).toBeNull();
    expect(ref.loadedLotw(false)).toBeNull();
    expect(ref.parks(true)).not.toBeNull();
    expect(ref.parks(true)).toBe(ref.parks(true));
    expect(origin.state.requests).toEqual([]);
  });

  it('loads the country file once and offers it synchronously afterwards', async () => {
    const { origin, ref } = setup();
    expect(ref.loadedCountries()).toBeNull();
    const cty = await ref.countries();
    expect(cty.lookup('VK6/9V1NE')).toMatchObject({ found: true, entity: 'Australia', cqZone: 29, ituZone: 58 });
    expect(ref.loadedCountries()).toBe(cty);
    await ref.countries();
    expect(origin.state.requests).toEqual(['cty.json']);
  });

  it('loads the LoTW list named in the manifest when the feature is on', async () => {
    const { origin, ref, store } = setup();
    const lotw = await ref.lotw(true);
    expect(lotw?.lookup('VK3/9V1NE/P')).toEqual({ call: '9V1NE', lastUpload: '2026-10-11', via: 'home' });
    expect(ref.loadedLotw(true)).toBe(lotw);
    expect(ref.loadedLotw(false)).toBeNull();
    expect(origin.state.requests).toEqual(['manifest.json', 'lotw.abc.json']);
    expect(await store.keptFiles('lotw')).toEqual(new Map([['lotw.json', 'lotw.abc.json']]));
    await ref.forget('lotw');
    expect(await store.keptFiles('lotw')).toEqual(new Map());
    expect(ref.loadedLotw(true)).toBeNull();
  });

  it('reports sources the build lacks as unavailable', async () => {
    const { ref } = setup({ 'manifest.json': MANIFEST, 'cty.json': CTY });
    expect(await ref.summits(true)?.available()).toBe(false);
    const bare = setup({}).ref;
    expect(await bare.manifest()).toBeNull();
    await expect(bare.lotw(true)).rejects.toMatchObject({ problem: 'missing' });
    await expect(bare.countries()).rejects.toBeInstanceOf(ReferenceUnavailableError);
  });

  it('retries a failed load on the next call', async () => {
    const { origin, ref } = setup();
    origin.state.offline = true;
    await expect(ref.countries()).rejects.toMatchObject({ problem: 'unreachable' });
    origin.state.offline = false;
    expect((await ref.countries()).entities).toHaveLength(2);
  });

  it('warms the country file, and the LoTW list only when its feature is on', async () => {
    vi.useFakeTimers();
    const { origin, ref } = setup();
    const warmed = ref.warm({ lotwUsers: false });
    expect(origin.state.requests).toEqual([]);
    expect(ref.loadedCountries()).toBeNull();
    await vi.runAllTimersAsync();
    await warmed;
    expect(origin.state.requests).toEqual(['cty.json']);
    expect(ref.loadedCountries()?.entities).toHaveLength(2);
    ref.warm({ lotwUsers: true });
    await vi.runAllTimersAsync();
    expect(origin.state.requests).toEqual(['cty.json', 'manifest.json', 'lotw.abc.json']);
  });
});
