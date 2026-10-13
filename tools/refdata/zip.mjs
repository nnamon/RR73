// Reads the files in a zip archive (PKWARE APPNOTE 6.3): the central directory, then each
// local file, stored or deflated, checked against its CRC-32. Enough for the Big CTY package;
// no zip64, encryption or multi-disk archives.

import { inflateRawSync, crc32 } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Returns a Map from file name to contents (Buffer). Throws on anything it cannot read. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end of central directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error(`zip central directory entry ${n} is damaged`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    // The central directory has the sizes even when a local header defers them to a data descriptor.
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`zip entry ${name} is encrypted`);
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`zip local header for ${name} is damaged`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const stored = buf.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(stored);
    else if (method === 8) data = inflateRawSync(stored);
    else throw new Error(`zip entry ${name} uses compression method ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip entry ${name} fails its size or CRC check`);
    files.set(name, data);
  }
  return files;
}
