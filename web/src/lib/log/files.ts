/**
 * File destinations: RR73 makes the file, the operator shares it and marks it submitted.
 *
 * - POTA: one file per park and UTC day, CALL@PARK-YYYYMMDD.adi, MY_SIG POTA and MY_SIG_INFO
 *   (and MY_POTA_REF) naming that park.
 * - SOTA: one file per summit and UTC day with MY_SOTA_REF and SOTA_REF, for the SOTA database.
 * - WWFF: one file per reference and activation, CALL@REFERENCE YYYYMMDD.adi as WWFF's log
 *   rules name it, for the national coordinator.
 * - ADIF: one file per activation with every field.
 *
 * A slash cannot appear in a file name, so VK3/9V1NE is written VK3-9V1NE and VK3/VC-012 is
 * written VK3-VC-012.
 */

import { refsLabel, utcDayKey } from './activation';
import { writeAdif } from './adif';
import { parsePartKey, type FilePartKey } from './ledger';
import { qsoToRecord } from './qso-adif';
import type { Activation, FileDestinationId, Qso, Reference } from './types';

export interface ExportFile {
  name: string;
  text: string;
}

export interface FileOptions {
  programVersion: string;
  now: number;
}

/** A name a file may carry: a slash becomes a hyphen, and characters file systems refuse go. */
export const safeName = (s: string) => s.replace(/\//g, '-').replace(/[\\:*?"<>|]/g, '');

/** "13 Oct 2026" for a YYYYMMDD day. */
export function dayText(day: string): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The QSOs of one file, oldest first. */
export function partQsos(key: FilePartKey, qsos: readonly Qso[], activation: Activation): Qso[] {
  return qsos
    .filter((q) => q.deletedAt === null && q.activationId === activation.id)
    .filter((q) => !('day' in key) || utcDayKey(q.start) === key.day)
    .sort((a, b) => a.start - b.start);
}

/** The destination a file key belongs to. */
export function destinationOfPart(key: FilePartKey): FileDestinationId {
  return key.programme === 'ADIF' ? 'adif-file' : key.programme === 'POTA' ? 'pota-file' : key.programme === 'SOTA' ? 'sota-file' : 'wwff-file';
}

/** "POTA VK-0921, 13 Oct 2026": the file on screen. */
export function partLabel(key: FilePartKey): string {
  if (key.programme === 'ADIF') return 'ADIF';
  if (key.programme === 'WWFF') return `WWFF ${key.ref}`;
  return `${key.programme} ${key.ref}, ${dayText(key.day)}`;
}

/** The file for one key (from the ledger), or null when it holds no QSOs. */
export function buildPartFile(partKey: string, qsos: readonly Qso[], activation: Activation, opts: FileOptions): ExportFile | null {
  const key = parsePartKey(partKey);
  if (!key) return null;
  const list = partQsos(key, qsos, activation);
  if (!list.length) return null;
  const call = safeName(activation.callsign || list[0].stationCallsign);
  const firstDay = utcDayKey(list[0].start);
  let name: string;
  let reference: Reference | undefined;
  let headerText: string;
  if (key.programme === 'POTA') {
    reference = { programme: 'POTA', ref: key.ref };
    name = `${call}@${safeName(key.ref)}-${key.day}.adi`;
    headerText = `POTA log for ${key.ref} on ${dayText(key.day)}, made by RR73 ${opts.programVersion}`;
  } else if (key.programme === 'SOTA') {
    reference = { programme: 'SOTA', ref: key.ref };
    name = `${call}@${safeName(key.ref)}-${key.day}.adi`;
    headerText = `SOTA log for ${key.ref} on ${dayText(key.day)}, made by RR73 ${opts.programVersion}`;
  } else if (key.programme === 'WWFF') {
    reference = { programme: 'WWFF', ref: key.ref };
    name = `${call}@${safeName(key.ref)} ${firstDay}.adi`;
    headerText = `WWFF log for ${key.ref} from ${dayText(firstDay)}, made by RR73 ${opts.programVersion}`;
  } else {
    name = `${call} ${firstDay} ${safeName(activation.refs.map((r) => r.ref).join(' '))}.adi`;
    headerText = `Activation log for ${refsLabel(activation.refs)} from ${dayText(firstDay)}, made by RR73 ${opts.programVersion}`;
  }
  const records = list.map((q) => qsoToRecord(q, { reference, rr73Id: key.programme === 'ADIF' }));
  return { name, text: writeAdif(records, { programVersion: opts.programVersion, createdAt: opts.now, headerText }) };
}

/** An ADIF export of any selection of QSOs, with RR73's id on each so a later import recognises them. */
export function buildExport(qsos: readonly Qso[], callsign: string, opts: FileOptions): ExportFile {
  const list = qsos.filter((q) => q.deletedAt === null).sort((a, b) => a.start - b.start);
  const records = list.map((q) => qsoToRecord(q, { rr73Id: true }));
  const name = `RR73 ${safeName(callsign || 'log')} ${utcDayKey(opts.now)}.adi`;
  const n = list.length;
  return { name, text: writeAdif(records, { programVersion: opts.programVersion, createdAt: opts.now, headerText: `${n} ${n === 1 ? 'QSO' : 'QSOs'} exported by RR73 ${opts.programVersion}` }) };
}

export type ShareResult = { kind: 'shared' } | { kind: 'cancelled' } | { kind: 'downloaded' };

/**
 * Hands a file to the share sheet where the browser can share files (on iPhone that includes
 * Save to Files), else downloads it. Call straight from a tap: the share sheet needs the tap's
 * user activation, so the file is built before this call and nothing here waits first.
 * Not tested on a device: whether a home-screen app may share .adi files.
 */
export async function shareFile(f: ExportFile, nav: Navigator = navigator, doc: Document = document): Promise<ShareResult> {
  const file = new File([f.text], f.name, { type: 'text/plain' });
  if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: f.name });
      return { kind: 'shared' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'cancelled' };
      // Refused (NotAllowedError, for one): download instead.
    }
  }
  const url = URL.createObjectURL(file);
  const a = doc.createElement('a');
  a.href = url;
  a.download = f.name;
  a.rel = 'noopener';
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { kind: 'downloaded' };
}
