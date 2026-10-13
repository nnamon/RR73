// QSO records to ADIF records and back.

import { bandOfHz, isAdifBand } from './bandplan';
import type { AdifRecord } from './adif';
import { adifMode, normaliseCall, normaliseGrid } from './qso';
import type { Qso, Reference } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "20261013" for a UTC time in ms. */
export function adifDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** "131452" for a UTC time in ms. */
export function adifTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** FREQ in MHz with 6 decimals: 14075500 Hz gives "14.075500". */
export function adifFreq(hz: number): string {
  return (hz / 1e6).toFixed(6);
}

export interface RecordOptions {
  /** Adds APP_RR73_ID, so a re-import recognises the QSO. */
  rr73Id?: boolean;
  /** A programme file: MY_SIG, MY_SIG_INFO and the programme's own field name only this reference. */
  reference?: Reference;
}

/** The ADIF record for a QSO, in a stable field order. Empty fields are left out by the writer. */
export function qsoToRecord(q: Qso, opts: RecordOptions = {}): AdifRecord {
  let { mySig, mySigInfo, myPotaRef, myWwffRef } = q;
  const ref = opts.reference;
  if (ref?.programme === 'POTA') [mySig, mySigInfo, myPotaRef] = ['POTA', ref.ref, ref.ref];
  if (ref?.programme === 'WWFF') [mySig, mySigInfo, myWwffRef] = ['WWFF', ref.ref, ref.ref];
  const r: AdifRecord = {
    CALL: q.call,
    QSO_DATE: adifDate(q.start),
    TIME_ON: adifTime(q.start),
    QSO_DATE_OFF: adifDate(q.end),
    TIME_OFF: adifTime(q.end),
    BAND: q.band,
    FREQ: q.freqHz ? adifFreq(q.freqHz) : '',
    MODE: q.mode,
    SUBMODE: q.submode,
    RST_SENT: q.rstSent,
    RST_RCVD: q.rstRcvd,
    GRIDSQUARE: q.gridsquare,
    STATION_CALLSIGN: q.stationCallsign,
    OPERATOR: q.operator,
    MY_GRIDSQUARE: q.myGridsquare,
    TX_PWR: q.txPwrW ? String(q.txPwrW) : '',
    MY_SIG: mySig,
    MY_SIG_INFO: mySigInfo,
    MY_POTA_REF: myPotaRef,
    MY_SOTA_REF: q.mySotaRef,
    MY_WWFF_REF: myWwffRef,
    MY_IOTA: q.myIota,
    SIG: q.sig,
    SIG_INFO: q.sigInfo,
    POTA_REF: q.potaRef,
    SOTA_REF: q.sotaRef,
    WWFF_REF: q.wwffRef,
    IOTA: q.iota,
  };
  for (const [k, v] of Object.entries(q.extra)) if (!(k in r)) r[k] = v;
  if (opts.rr73Id) r.APP_RR73_ID = q.id;
  r.COMMENT = q.comment;
  return r;
}

/** Fields RR73 reads into its own QSO fields; everything else goes to `extra`. */
const KNOWN = new Set([
  'CALL', 'QSO_DATE', 'TIME_ON', 'QSO_DATE_OFF', 'TIME_OFF', 'BAND', 'FREQ', 'MODE', 'SUBMODE', 'RST_SENT', 'RST_RCVD', 'GRIDSQUARE',
  'STATION_CALLSIGN', 'OPERATOR', 'MY_GRIDSQUARE', 'TX_PWR', 'MY_SIG', 'MY_SIG_INFO', 'MY_POTA_REF', 'MY_SOTA_REF', 'MY_WWFF_REF',
  'MY_IOTA', 'SIG', 'SIG_INFO', 'POTA_REF', 'SOTA_REF', 'WWFF_REF', 'IOTA', 'COMMENT', 'APP_RR73_ID',
]);

/** UTC ms for an ADIF date (YYYYMMDD) and time (HHMM or HHMMSS), or null. */
export function parseDateTime(date: string, time: string): number | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(date.trim());
  const t = /^(\d{2})(\d{2})(\d{2})?$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, da, h, mi, s);
  return new Date(ms).getUTCDate() === da ? ms : null;
}

export type ReadResult = { ok: true; qso: Qso; warnings: string[] } | { ok: false; reason: string };

export interface ReadContext {
  now: number;
  newId: () => string;
}

/** A QSO from an ADIF record written by any logger. */
export function recordToQso(rec: AdifRecord, ctx: ReadContext): ReadResult {
  const get = (k: string) => (rec[k] ?? '').trim();
  const warnings: string[] = [];
  const call = normaliseCall(get('CALL'));
  if (!call) return { ok: false, reason: 'A record has no CALL.' };
  const start = parseDateTime(get('QSO_DATE'), get('TIME_ON'));
  if (start === null) return { ok: false, reason: `The QSO with ${call} has no valid QSO_DATE and TIME_ON.` };

  let end = start;
  if (get('TIME_OFF')) {
    const off = parseDateTime(get('QSO_DATE_OFF') || get('QSO_DATE'), get('TIME_OFF'));
    if (off === null) warnings.push(`The QSO with ${call} has an unreadable TIME_OFF. RR73 ends it at its start time.`);
    // A TIME_OFF before TIME_ON without QSO_DATE_OFF crossed midnight UTC.
    else end = off < start && !get('QSO_DATE_OFF') ? off + 86_400_000 : Math.max(off, start);
  }

  const freqMhz = Number(get('FREQ'));
  const freqHz = get('FREQ') && Number.isFinite(freqMhz) && freqMhz > 0 ? Math.round(freqMhz * 1e6) : null;
  if (get('FREQ') && freqHz === null) warnings.push(`The QSO with ${call} has an unreadable FREQ.`);
  let band = get('BAND').toLowerCase();
  if (band && !isAdifBand(band)) warnings.push(`The QSO with ${call} has an unknown BAND "${get('BAND')}".`);
  if (!band && freqHz) band = bandOfHz(freqHz) ?? '';

  // Older WSJT-X versions wrote MODE FT4; ADIF 3.1 has MODE MFSK with SUBMODE FT4.
  let mode = get('MODE').toUpperCase();
  let submode = get('SUBMODE').toUpperCase();
  if (mode === 'FT4' && !submode) ({ mode, submode } = adifMode('FT4'));

  const pwr = Number(get('TX_PWR'));
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) if (!KNOWN.has(k) && v !== '') extra[k] = v;
  const id = /^[0-9a-f-]{36}$/i.test(get('APP_RR73_ID')) ? get('APP_RR73_ID').toLowerCase() : ctx.newId();

  return {
    ok: true,
    warnings,
    qso: {
      call,
      gridsquare: normaliseGrid(get('GRIDSQUARE')),
      mode,
      submode,
      band,
      freqHz,
      start,
      end,
      rstSent: get('RST_SENT'),
      rstRcvd: get('RST_RCVD'),
      stationCallsign: normaliseCall(get('STATION_CALLSIGN')),
      operator: normaliseCall(get('OPERATOR')),
      myGridsquare: normaliseGrid(get('MY_GRIDSQUARE')),
      txPwrW: get('TX_PWR') && Number.isFinite(pwr) && pwr > 0 ? pwr : null,
      mySig: get('MY_SIG').toUpperCase(),
      mySigInfo: get('MY_SIG_INFO').toUpperCase(),
      myPotaRef: get('MY_POTA_REF').toUpperCase(),
      mySotaRef: get('MY_SOTA_REF').toUpperCase(),
      myWwffRef: get('MY_WWFF_REF').toUpperCase(),
      myIota: get('MY_IOTA').toUpperCase(),
      sig: get('SIG').toUpperCase(),
      sigInfo: get('SIG_INFO').toUpperCase(),
      potaRef: get('POTA_REF').toUpperCase(),
      sotaRef: get('SOTA_REF').toUpperCase(),
      wwffRef: get('WWFF_REF').toUpperCase(),
      iota: get('IOTA').toUpperCase(),
      comment: get('COMMENT'),
      extra,
      id,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      deletedAt: null,
      activationId: null,
      source: 'import',
      decode: null,
    },
  };
}
