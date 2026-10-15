import { describe, expect, it } from 'vitest';
import { CACHE_NAME, HttpStore, ReferenceUnavailableError } from './store';
import { MemoryCaches, ORIGIN, fakeOrigin } from './testing';

function setup(files: Record<string, unknown> = {}) {
  const origin = fakeOrigin(files);
  const caches = new MemoryCaches();
  const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: caches.asStorage() });
  return { store, origin, caches };
}

async function problem(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ReferenceUnavailableError) return e.problem;
    throw e;
  }
  return null;
}

describe('HttpStore.json', () => {
  it('reads core files', async () => {
    const { store, origin } = setup({ 'cty.json': { format: 1 } });
    expect(await store.json('cty.json')).toEqual({ format: 1 });
    expect(origin.state.requests).toEqual(['cty.json']);
  });

  it('names what went wrong', async () => {
    const { store, origin } = setup({ 'bad.json': 1 });
    expect(await problem(store.json('none.json'))).toBe('missing');
    origin.state.offline = true;
    expect(await problem(store.json('cty.json'))).toBe('unreachable');
    const html = new HttpStore(ORIGIN, { fetch: () => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })), caches: null });
    expect(await problem(html.json('cty.json'))).toBe('missing');
    const broken = new HttpStore(ORIGIN, { fetch: () => Promise.resolve(new Response('{"format":')), caches: null });
    expect(await problem(broken.json('cty.json'))).toBe('invalid');
    const refused = new HttpStore(ORIGIN, { fetch: () => Promise.resolve(new Response('busy', { status: 503 })), caches: null });
    expect(await problem(refused.json('cty.json'))).toBe('unreachable');
  });
});

describe('HttpStore.kept', () => {
  it('keeps a copy under the slot and reads it without the network next time', async () => {
    const { store, origin, caches } = setup({ 'sota/index.aaa.json': { v: 1 } });
    expect(await store.kept('sota/index.json', 'sota/index.aaa.json')).toEqual({ data: { v: 1 }, file: 'sota/index.aaa.json', stale: false });
    origin.state.offline = true;
    expect(await store.kept('sota/index.json', 'sota/index.aaa.json')).toEqual({ data: { v: 1 }, file: 'sota/index.aaa.json', stale: false });
    expect(origin.state.requests).toEqual(['sota/index.aaa.json']);
    expect([...caches.caches.get(CACHE_NAME)!.entries.keys()]).toEqual([`${ORIGIN}sota/index.json`]);
  });

  it('replaces the copy when the current file changes', async () => {
    const { store, origin } = setup({ 'sota/index.aaa.json': { v: 1 }, 'sota/index.bbb.json': { v: 2 } });
    await store.kept('sota/index.json', 'sota/index.aaa.json');
    expect(await store.kept('sota/index.json', 'sota/index.bbb.json')).toEqual({ data: { v: 2 }, file: 'sota/index.bbb.json', stale: false });
    origin.state.offline = true;
    expect((await store.kept('sota/index.json', 'sota/index.bbb.json')).data).toEqual({ v: 2 });
    expect(await store.keptFiles('')).toEqual(new Map([['sota/index.json', 'sota/index.bbb.json']]));
  });

  it('falls back to an older copy, marked stale, when the current file cannot be fetched', async () => {
    const { store, origin } = setup({ 'pota/US.aaa.json': { v: 1 } });
    await store.kept('pota/US.json', 'pota/US.aaa.json');
    origin.state.offline = true;
    expect(await store.kept('pota/US.json', 'pota/US.bbb.json')).toEqual({ data: { v: 1 }, file: 'pota/US.aaa.json', stale: true });
    expect(await problem(store.kept('pota/FR.json', 'pota/FR.aaa.json'))).toBe('unreachable');
  });

  it('refetches a damaged copy and still answers when the store is full', async () => {
    const { store, caches } = setup({ 'pota/US.aaa.json': { v: 1 } });
    const cache = await caches.open(CACHE_NAME);
    cache.entries.set(`${ORIGIN}pota/US.json`, { body: '{"v":', headers: [['x-rr73-file', 'pota/US.aaa.json']] });
    expect((await store.kept('pota/US.json', 'pota/US.aaa.json')).data).toEqual({ v: 1 });
    cache.entries.clear();
    cache.failPuts = true;
    expect((await store.kept('pota/US.json', 'pota/US.aaa.json')).data).toEqual({ v: 1 });
    expect(cache.entries.size).toBe(0);
  });

  it('works without the Cache API', async () => {
    const origin = fakeOrigin({ 'sota/index.aaa.json': { v: 1 } });
    const store = new HttpStore(ORIGIN, { fetch: origin.fetch, caches: null });
    expect((await store.kept('sota/index.json', 'sota/index.aaa.json')).data).toEqual({ v: 1 });
    expect(await store.keptFiles('')).toEqual(new Map());
    await store.drop('');
  });
});

describe('HttpStore.keptFiles and drop', () => {
  it('lists and removes kept copies by slot prefix', async () => {
    const { store } = setup({ 'pota/US.a.json': 1, 'pota/FR.a.json': 2, 'sota/G.a.json': 3, 'sota/index.a.json': 4 });
    await store.kept('pota/US.json', 'pota/US.a.json');
    await store.kept('pota/FR.json', 'pota/FR.a.json');
    await store.kept('sota/G.json', 'sota/G.a.json');
    await store.kept('sota/index.json', 'sota/index.a.json');
    expect(await store.keptFiles('pota/')).toEqual(
      new Map([
        ['pota/US.json', 'pota/US.a.json'],
        ['pota/FR.json', 'pota/FR.a.json'],
      ]),
    );
    await store.drop('pota/', (slot) => slot === 'pota/US.json');
    expect([...(await store.keptFiles('')).keys()].sort()).toEqual(['pota/US.json', 'sota/G.json', 'sota/index.json']);
    await store.drop('sota/index.json');
    expect([...(await store.keptFiles('')).keys()].sort()).toEqual(['pota/US.json', 'sota/G.json']);
  });
});
