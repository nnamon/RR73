import { describe, expect, it } from 'vitest';
import { QspError, apiUrl, blockedFromPage, normaliseBase, qspAbout, qspErrorText, qspReceivers, qspStartSession, streamUrl, type FetchFn } from './qsp';

const BASE = 'https://relay.example.org/qsp';

function answer(status: number, body: unknown): FetchFn {
  return async () => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('the relay address', () => {
  it('is an http or https API base, kept without a trailing slash', () => {
    expect(normaliseBase(' https://relay.example.org/qsp/ ')).toBe(BASE);
    expect(normaliseBase('http://127.0.0.1:7373')).toBe('http://127.0.0.1:7373');
    expect(normaliseBase('')).toBeNull();
    expect(normaliseBase('relay.example.org/qsp')).toBeNull();
    expect(normaliseBase('ftp://relay.example.org')).toBeNull();
    expect(normaliseBase('https://relay.example.org/qsp?x=1')).toBeNull();
  });

  it('at http is blocked from the https app, except on this device', () => {
    expect(blockedFromPage('http://192.168.1.20:7373', 'https:')).toBe(true);
    expect(blockedFromPage('https://relay.example.org/qsp', 'https:')).toBe(false);
    expect(blockedFromPage('http://localhost:7373', 'https:')).toBe(false);
    expect(blockedFromPage('http://127.0.0.1:7373', 'https:')).toBe(false);
    expect(blockedFromPage('http://192.168.1.20:7373', 'http:')).toBe(false);
  });

  it('joins paths onto the base, and streams over wss from https', () => {
    expect(apiUrl(`${BASE}/`, '/about')).toBe(`${BASE}/about`);
    expect(streamUrl(BASE, '/v1/sdr/sessions/abc/stream?ticket=t')).toBe('wss://relay.example.org/qsp/v1/sdr/sessions/abc/stream?ticket=t');
    expect(streamUrl('http://127.0.0.1:7373', '/x')).toBe('ws://127.0.0.1:7373/x');
  });
});

describe('requests to the relay', () => {
  it('send the key and read the answers', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith('/about')) return new Response(JSON.stringify({ name: 'QSP', version: '0.15.4', api: ['v1'], auth: true, services: ['sdr'], userReceivers: false }));
      if (url.endsWith('/receivers')) return new Response(JSON.stringify({ receivers: [{ id: 'sarts-web888', kind: 'kiwisdr', name: 'SARTS Web-888', location: 'Singapore', grid: 'OJ11' }] }));
      return new Response(JSON.stringify({ id: 's1', receiver: 'sarts-web888', dialHz: 14074000, encoding: 'ima-adpcm', state: 'waiting', stream: '/v1/sdr/sessions/s1/stream?ticket=t' }), { status: 201 });
    };
    expect((await qspAbout(BASE, fetchFn)).version).toBe('0.15.4');
    expect((await qspReceivers(BASE, 'k'.repeat(16), fetchFn))[0].id).toBe('sarts-web888');
    const s = await qspStartSession(BASE, 'k'.repeat(16), 'sarts-web888', 14074000, '9V1NE', fetchFn);
    expect(s.stream).toBe('/v1/sdr/sessions/s1/stream?ticket=t');
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((seen[1].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${'k'.repeat(16)}`);
    expect(JSON.parse(String(seen[2].init?.body))).toEqual({ receiver: 'sarts-web888', dialHz: 14074000, listener: '9V1NE', encoding: 'ima-adpcm' });
    expect(seen.every((s) => s.init?.credentials === 'omit')).toBe(true);
  });

  it('sort failures into what Settings can explain', async () => {
    const fail = (f: FetchFn): Promise<QspError> =>
      qspReceivers(BASE, '', f).then(
        () => Promise.reject(new Error('the relay answered')),
        (e: unknown) => e as QspError,
      );
    expect((await fail(answer(401, { error: { code: 'unauthorised', message: 'x' } }))).kind).toBe('unauthorised');
    const busy = await fail(answer(409, { error: { code: 'receiver-busy', message: 'All of this relay’s sessions on sarts-web888 are in use. Try again later.' } }));
    expect([busy.kind, busy.code]).toEqual(['refused', 'receiver-busy']);
    expect(qspErrorText(busy)).toBe('All of this relay’s sessions on sarts-web888 are in use. Try again later.');
    expect((await fail(answer(200, '<html>'))).kind).toBe('format');
    expect((await fail(answer(200, { nothing: true }))).kind).toBe('format');
    expect((await fail(async () => Promise.reject(new TypeError('Load failed')))).kind).toBe('network');
    expect(qspErrorText(new QspError('unauthorised'))).toMatch(/^The relay refused the access key/);
  });
});
