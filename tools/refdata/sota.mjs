// The SOTA summits list, published by Summits on the Air at
// https://storage.sota.org.uk/summitslist.csv: a title line "SOTA Summits List (Date=DD/MM/YYYY)",
// then a header and one row per summit. RR73 keeps the code, name, association, region,
// position, height, points and validity dates, split by association.
//
// Build time only: the app never contacts SOTA hosts, and RR73 uses no SOTA API.

import { parseCsv, csvRecords } from './csv.mjs';
import { position, shardFiles } from './refs.mjs';

export const SOTA_URL = 'https://storage.sota.org.uk/summitslist.csv';

const CODE = /^([A-Z0-9]{1,6})\/([A-Z0-9]{2})-(\d{3})$/;

/** "13/10/2026" to 20261013; null when not a date. */
export function dmyNumber(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : null;
}

/** Valid-to dates from 2099 on mean the summit has no end date; the list uses 31/12/2099. */
const OPEN_ENDED = 20990101;

/** Converts the summits list to sota/index.json and one shard per association. */
export function convertSota(text) {
  const rows = parseCsv(text);
  const title = rows.findIndex((r) => r[0]?.startsWith('SOTA Summits List'));
  const titleDate = title >= 0 ? /Date=(\d{1,2}\/\d{1,2}\/\d{4})/.exec(rows[title].join(',')) : null;
  const headerAt = rows.findIndex((r) => r[0]?.trim() === 'SummitCode');
  if (headerAt < 0) throw new Error('the summits list has no SummitCode header');
  const records = csvRecords(rows.slice(headerAt));
  const groups = new Map();
  let skipped = 0;
  let unplaced = 0;
  for (const r of records) {
    const m = CODE.exec(r.SummitCode.trim().toUpperCase());
    const from = dmyNumber(r.ValidFrom);
    const to = dmyNumber(r.ValidTo);
    if (!m || from === null || to === null) {
      skipped++;
      continue;
    }
    const pos = position(r.Latitude, r.Longitude);
    if (!pos) unplaced++;
    if (!groups.has(m[1])) groups.set(m[1], { rows: [], extra: { association: r.AssociationName.trim(), regions: {} }, name: r.AssociationName.trim() });
    const g = groups.get(m[1]);
    g.extra.regions[m[2]] ??= r.RegionName.trim();
    g.rows.push([
      `${m[2]}-${m[3]}`,
      r.SummitName.trim(),
      pos ? pos.lat : null,
      pos ? pos.lon : null,
      Math.round(Number(r.AltM)) || 0,
      Math.round(Number(r.Points)) || 0,
      from,
      to >= OPEN_ENDED ? 0 : to,
    ]);
  }
  if (!groups.size) throw new Error('the summits list has no summits');
  const { files, entry, count } = shardFiles('sota', 'SOTA', '/', groups);
  const d = titleDate ? dmyNumber(titleDate[1]) : null;
  const dataDate = d ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}` : null;
  const warnings = [];
  if (skipped) warnings.push(`skipped ${skipped} rows without a summit code like W7O/CN-001 or valid dates`);
  if (unplaced) warnings.push(`${unplaced} summits have no usable position`);
  return { files, entry, records: count, dataDate, warnings };
}
