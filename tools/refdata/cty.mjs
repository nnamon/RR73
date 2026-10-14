// Big CTY, the country file for everyday logging, by Jim Reisert AD1C. The site publishes each
// release as a dated zip (bigcty-YYYYMMDD.zip) linked from its Big CTY category page; the zip holds
// cty.dat, cty.csv (which adds ADIF DXCC codes) and copyright.txt (MIT licence).

import { parseCtyDat, parseCtyCsvCodes, toCtyJson } from '../../web/src/lib/reference/cty.ts';
import { unzip } from './zip.mjs';

export const BIGCTY_LIST = 'https://www.country-files.com/category/big-cty/';
export const BIGCTY_PAGE = 'https://www.country-files.com/big-cty/';

// The notice from https://www.country-files.com/copyright/ (checked 13 October 2026), used only
// when a release zip lacks copyright.txt. The page prints no year range or holder after "1994-".
const NOTICE_FALLBACK = `Big CTY by Jim Reisert AD1C, https://www.country-files.com/big-cty/

Copyright © 1994-

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const ZIP_LINK = /https:\/\/www\.country-files\.com\/bigcty\/download\/\d{4}\/bigcty-(\d{4})(\d{2})(\d{2})\.zip/g;

/** The newest Big CTY zip linked from a page or feed: { url, date: "YYYY-MM-DD" }, or null. */
export function latestBigCty(text) {
  let best = null;
  for (const m of text.matchAll(ZIP_LINK)) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!best || date > best.date) best = { url: m[0], date };
  }
  return best;
}

function findFile(files, name) {
  for (const [k, v] of files) if (k.toLowerCase().split('/').pop() === name) return v;
  return null;
}

/**
 * Converts a Big CTY zip to cty.json. Returns the files to write, the record count, the release
 * date and warnings for anything incomplete.
 */
export function convertBigCty(zip, { url, date }) {
  const files = unzip(zip);
  const dat = findFile(files, 'cty.dat');
  if (!dat) throw new Error('the Big CTY zip has no cty.dat');
  const warnings = [];
  const csv = findFile(files, 'cty.csv');
  const codes = csv ? parseCtyCsvCodes(csv.toString('utf8')) : new Map();
  if (!csv) warnings.push('the zip has no cty.csv: entities carry no DXCC codes');
  const copyright = findFile(files, 'copyright.txt');
  if (!copyright) warnings.push('the zip has no copyright.txt: using the notice from the copyright page');
  const notice = copyright ? `Big CTY by Jim Reisert AD1C, ${BIGCTY_PAGE}\n\n${copyright.toString('utf8').replace(/\r\n/g, '\n').trim()}\n` : NOTICE_FALLBACK;
  const entities = parseCtyDat(dat.toString('latin1'));
  const json = toCtyJson(entities, codes, { version: date, source: url, notice });
  const uncoded = json.entities.filter((e) => e.dxcc === null).map((e) => e.prefix);
  if (csv && uncoded.length) warnings.push(`no DXCC code in cty.csv for ${uncoded.join(', ')}`);
  return { files: { 'cty.json': JSON.stringify(json) }, entry: 'cty.json', records: entities.length, dataDate: date, warnings };
}
