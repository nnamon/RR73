// Test helpers for tools/refdata: a stored (uncompressed) zip writer, a fake fetch and temporary
// directories.

import { crc32 } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../fixtures/reference/', import.meta.url));

/** A zip archive with each file stored, method 0. files maps names to strings or Buffers. */
export function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/**
 * A fetch that answers from routes: url -> { status, body, headers } or a function of the
 * request headers returning one, or an Error to throw. Records every call.
 */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const headers = init.headers ?? {};
    calls.push({ url, headers });
    let route = routes[url];
    if (typeof route === 'function') route = route(headers);
    if (route instanceof Error) throw route;
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.status === 304 ? null : route.body, { status: route.status ?? 200, headers: route.headers ?? {} });
  };
  fn.calls = calls;
  return fn;
}

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `rr73-${prefix}-`));
}

export { join };
