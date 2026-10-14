// The POTA parks list, published by Parks on the Air at https://pota.app/all_parks_ext.csv:
// "reference","name","active","entityId","locationDesc","latitude","longitude","grid".
// RR73 keeps the reference, name, position and active flag, split by reference prefix.

import { parseCsv, csvRecords } from './csv.mjs';
import { position, shardFiles } from './refs.mjs';

export const POTA_URL = 'https://pota.app/all_parks_ext.csv';

const REF = /^([A-Z0-9]{1,4})-(\d{4,5})$/;

/** Converts the parks list to pota/index.json and one shard per prefix. */
export function convertPota(text) {
  const records = csvRecords(parseCsv(text));
  if (!records.length || !('reference' in records[0]) || !('latitude' in records[0])) throw new Error('the parks list has no reference and latitude columns');
  const groups = new Map();
  let skipped = 0;
  let unplaced = 0;
  for (const r of records) {
    const m = REF.exec(r.reference.trim().toUpperCase());
    if (!m) {
      skipped++;
      continue;
    }
    const pos = position(r.latitude, r.longitude);
    if (!pos) unplaced++;
    if (!groups.has(m[1])) groups.set(m[1], { rows: [] });
    groups.get(m[1]).rows.push([m[2], r.name.trim(), pos ? pos.lat : null, pos ? pos.lon : null, r.active.trim() === '1' ? 1 : 0]);
  }
  if (!groups.size) throw new Error('the parks list has no parks');
  const { files, entry, count } = shardFiles('pota', 'POTA', '-', groups);
  const warnings = [];
  if (skipped) warnings.push(`skipped ${skipped} rows whose reference is not PREFIX-NNNN`);
  if (unplaced) warnings.push(`${unplaced} parks have no usable position (empty, out of range or 0,0)`);
  return { files, entry, records: count, dataDate: null, warnings };
}
