// Shared by the park and summit converters: positions, Maidenhead fields and shard files.

import { createHash } from 'node:crypto';

/**
 * A position from two CSV fields, rounded to 4 decimals (11 m). Null when either is empty, out of
 * range, or both are exactly 0: the POTA list uses 0,0 for parks without a position.
 */
export function position(latText, lonText) {
  if (!String(latText).trim() || !String(lonText).trim()) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  const r = (v) => Math.round(v * 1e4) / 1e4 || 0;
  return { lat: r(lat), lon: r(lon) };
}

/** The 4-character Maidenhead square holding a position: "FN31" for 41.7° N, 72.7° W. */
export function square(lat, lon) {
  const x = Math.min(Math.max(lon + 180, 0), 360 - 1e-9);
  const y = Math.min(Math.max(lat + 90, 0), 180 - 1e-9);
  return String.fromCharCode(65 + Math.floor(x / 20), 65 + Math.floor(y / 10)) + Math.floor((x % 20) / 2) + Math.floor(y % 10);
}

/** A file name carrying a hash of its content: ("US", body) gives "US.3f9c0a12b4.json". */
export function hashedName(stem, body) {
  return `${stem}.${createHash('sha256').update(body).digest('hex').slice(0, 10)}.json`;
}

/**
 * Writes one programme's shards and index. groups maps each key to { rows, extra, name }, where
 * rows hold lat and lon at positions 2 and 3, and extra adds fields to the shard file. Every file
 * name carries a hash of its content, so the app can tell a kept copy from the current one.
 */
export function shardFiles(dir, programme, separator, groups) {
  const files = {};
  const shards = [];
  let count = 0;
  for (const key of [...groups.keys()].sort()) {
    const { rows, extra = {}, name } = groups.get(key);
    const body = JSON.stringify({ format: 1, programme, key, ...extra, rows });
    const file = hashedName(key, body);
    files[`${dir}/${file}`] = body;
    const squares = [...new Set(rows.filter((r) => r[2] !== null && r[3] !== null).map((r) => square(r[2], r[3])))].sort().join('');
    const info = { key, file, count: rows.length, bytes: Buffer.byteLength(body), squares };
    if (name) info.name = name;
    shards.push(info);
    count += rows.length;
  }
  const index = JSON.stringify({ format: 1, programme, separator, count, shards });
  const entry = `${dir}/${hashedName('index', index)}`;
  files[entry] = index;
  return { files, entry, count };
}
