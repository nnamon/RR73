/**
 * ADIF 3.1 in the ADI format: a free-text header line, header fields, <EOH>, then records of
 * <NAME:LENGTH>value fields each closed by <EOR>.
 *
 * Writing: field names upper case, lengths in UTF-8 bytes. Values with characters outside ASCII
 * go last in their record. Wavelog's parser reads lengths as characters first and falls back to
 * bytes when the character count does not end on a field boundary; a non-ASCII value at the end
 * of a record always ends on one, so both readings agree. RR73's own QSOs have one free-text
 * field, COMMENT. An imported record with several non-ASCII values may still read wrongly in
 * Wavelog when an earlier one holds many multi-byte characters.
 *
 * Reading accepts what other loggers write: any case in names, EOH and EOR, type indicators
 * (<QSO_DATE:8:D>), text and line breaks between fields, a missing header, lengths counted in
 * bytes or in characters, a BOM, and a last record without <EOR>.
 */

/** Field name (upper case) to value, in writing order. */
export type AdifRecord = Record<string, string>;

export interface AdifFile {
  /** Free text before the first header field. */
  headerText: string;
  header: AdifRecord;
  records: AdifRecord[];
  /** Plain-words notes about what the reader skipped or guessed. */
  warnings: string[];
}

export const ADIF_VERSION = '3.1.4';
export const PROGRAM_ID = 'RR73';

const encoder = new TextEncoder();

/** Length of a value in UTF-8 bytes. */
export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** ASCII from space to tilde: what ADI strings allow, and where bytes and characters agree. */
function isAscii(s: string): boolean {
  return /^[\x20-\x7e\r\n\t]*$/.test(s);
}

/** One field: <CALL:6>VK2ESN. */
export function adifField(name: string, value: string): string {
  return `<${name.toUpperCase()}:${utf8Length(value)}>${value}`;
}

/** "20261013 131452": ADIF's CREATED_TIMESTAMP for a UTC time in ms. */
export function adifTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export interface WriteOptions {
  programVersion: string;
  /** UTC ms, for CREATED_TIMESTAMP. */
  createdAt: number;
  /** First line of the file; must not start with "<". */
  headerText?: string;
}

/** One record on one line, empty values left out, non-ASCII values last. */
export function writeRecord(record: AdifRecord): string {
  const entries = Object.entries(record).filter(([, v]) => v !== '');
  const plain = entries.filter(([, v]) => isAscii(v));
  const intl = entries.filter(([, v]) => !isAscii(v));
  return [...plain, ...intl].map(([k, v]) => adifField(k, v)).join(' ') + ' <EOR>';
}

export function writeAdif(records: AdifRecord[], opts: WriteOptions): string {
  const text = (opts.headerText ?? `ADIF export from RR73 ${opts.programVersion}`).replace(/^</, ' <');
  const header = [
    adifField('ADIF_VER', ADIF_VERSION),
    adifField('PROGRAMID', PROGRAM_ID),
    adifField('PROGRAMVERSION', opts.programVersion),
    adifField('CREATED_TIMESTAMP', adifTimestamp(opts.createdAt)),
  ].join('\n');
  const body = records.map(writeRecord).join('\n');
  return `${text}\n${header}\n<EOH>\n\n${body}${records.length ? '\n' : ''}`;
}

/** UTF-8 bytes of one code point. */
function cpBytes(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * The end index (UTF-16) of a value starting at `from` that is `len` UTF-8 bytes long, or null
 * when the text ends first or a character straddles the end.
 */
function endByBytes(text: string, from: number, len: number): number | null {
  let i = from;
  let bytes = 0;
  while (bytes < len) {
    if (i >= text.length) return null;
    const cp = text.codePointAt(i)!;
    bytes += cpBytes(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes === len ? i : null;
}

/** The end index (UTF-16) of a value that is `len` characters (code points) long, or null. */
function endByChars(text: string, from: number, len: number): number | null {
  let i = from;
  for (let n = 0; n < len; n++) {
    if (i >= text.length) return null;
    i += text.codePointAt(i)! > 0xffff ? 2 : 1;
  }
  return i;
}

/** A value ends on a boundary when the next character starts a tag or is white space, or the text ends. */
function atBoundary(text: string, i: number): boolean {
  return i >= text.length || text[i] === '<' || /\s/.test(text[i]);
}

export function parseAdif(input: string): AdifFile {
  const text = input.replace(/^﻿/, '');
  const warnings: string[] = [];
  const records: AdifRecord[] = [];
  let header: AdifRecord = {};
  let fields: AdifRecord = {};
  let headerText = '';
  let seenTag = false;
  let i = 0;

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (!seenTag) {
      headerText = text.slice(0, lt).trim();
      seenTag = true;
    }
    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) {
      warnings.push('The file ends inside a field name.');
      break;
    }
    const spec = text.slice(lt + 1, gt).split(':');
    const name = spec[0].trim().toUpperCase();
    if (name === 'EOH') {
      header = fields;
      fields = {};
      i = gt + 1;
      continue;
    }
    if (name === 'EOR') {
      if (Object.keys(fields).length) records.push(fields);
      fields = {};
      i = gt + 1;
      continue;
    }
    const len = spec.length >= 2 && /^\s*\d+\s*$/.test(spec[1]) ? Number(spec[1]) : null;
    if (!name || len === null || !/^[A-Z0-9_]+$/.test(name)) {
      // Not a field: text such as "<generated by X>" in a header, or a malformed tag.
      if (Object.keys(fields).length || records.length) warnings.push(`Skipped "<${text.slice(lt + 1, gt)}>": it has no length.`);
      i = gt + 1;
      continue;
    }
    const from = gt + 1;
    const byBytes = endByBytes(text, from, len);
    const byChars = endByChars(text, from, len);
    let end: number;
    if (byBytes !== null && atBoundary(text, byBytes)) end = byBytes;
    else if (byChars !== null && atBoundary(text, byChars)) end = byChars;
    else if (byBytes !== null) end = byBytes;
    else if (byChars !== null) end = byChars;
    else {
      warnings.push(`${name} is shorter than its length of ${len}. RR73 kept what was there.`);
      end = text.length;
    }
    fields[name] = text.slice(from, end);
    i = end;
  }

  if (Object.keys(fields).length) {
    warnings.push('The last record has no <EOR>. RR73 read it anyway.');
    records.push(fields);
  }
  return { headerText, header, records, warnings };
}
