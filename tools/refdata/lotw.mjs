// ARRL's LoTW user activity list: one line per callsign, "CALL,YYYY-MM-DD,HH:MM:SS", the date
// and time (UTC) of the callsign's last upload. Documented at
// https://lotw.arrl.org/lotw-help/developer-query-lotw-users/ and updated about once a week.

import { hashedName } from './refs.mjs';

export const LOTW_URL = 'https://lotw.arrl.org/lotw-user-activity.csv';

/**
 * Converts the list to lotw.<hash>.json: callsigns grouped by the date of their last upload,
 * which writes each date once. A duplicated callsign keeps its latest date.
 */
export function convertLotw(text) {
  const latestByCall = new Map();
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawCall, date] = line.split(',');
    const call = (rawCall ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(call) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      skipped++;
      continue;
    }
    const prev = latestByCall.get(call);
    if (!prev || date > prev) latestByCall.set(call, date);
  }
  if (!latestByCall.size) throw new Error('the LoTW list has no callsigns');
  const byDateLists = new Map();
  for (const [call, date] of latestByCall) {
    if (!byDateLists.has(date)) byDateLists.set(date, []);
    byDateLists.get(date).push(call);
  }
  const dates = [...byDateLists.keys()].sort();
  const byDate = Object.fromEntries(dates.map((d) => [d, byDateLists.get(d).sort().join(' ')]));
  const latest = dates[dates.length - 1];
  const body = JSON.stringify({ format: 1, latest, count: latestByCall.size, byDate });
  const entry = hashedName('lotw', body);
  const warnings = skipped ? [`skipped ${skipped} lines that are not "CALL,YYYY-MM-DD,HH:MM:SS"`] : [];
  return { files: { [entry]: body }, entry, records: latestByCall.size, dataDate: latest, warnings };
}
