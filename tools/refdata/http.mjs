// One HTTP GET per call: no retries. A failed source waits for the next day's build (build.mjs).

export const USER_AGENT = 'RR73-refdata/1 (+https://github.com/nnamon/RR73)';

/**
 * Downloads a URL. With an etag or lastModified from an earlier download, asks the server to
 * answer 304 when nothing changed. Returns { notModified: true } or { body, etag, lastModified }.
 */
export async function download(url, { fetch = globalThis.fetch, etag = null, lastModified = null, timeoutMs = 180_000 } = {}) {
  const headers = { 'user-agent': USER_AGENT };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  return { notModified: false, body, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
}
