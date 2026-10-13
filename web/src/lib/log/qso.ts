// QSO records: built from the sequencer's logQso record or the manual form, and kept in step
// with their activation's references.

import type { Activation, DecodeProvenance, LogQsoRecord, Qso, Reference } from './types';

/** Upper case, callsign characters only, at most 20: "vk3/9v1ne" gives "VK3/9V1NE". */
export function normaliseCall(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '')
    .slice(0, 20);
}

const GRID = /^[A-R]{2}[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?$/i;

/** True for a 4, 6 or 8 character Maidenhead locator. */
export function isGrid(s: string): boolean {
  return GRID.test(s.trim());
}

/** "qf22LB" gives "QF22lb": field and square upper case, subsquare lower, as WSJT-X writes them. */
export function normaliseGrid(s: string): string {
  const t = s.trim();
  if (!isGrid(t)) return '';
  return t.slice(0, 4).toUpperCase() + t.slice(4, 6).toLowerCase() + t.slice(6);
}

/** A report as sent on air: -9 gives "-09", 5 gives "+05". Text is kept, with U+2212 read as "-". */
export function formatReport(r: number | string): string {
  if (typeof r === 'string') return r.trim().replace(/−/g, '-');
  if (!Number.isFinite(r)) return '';
  const v = Math.max(-50, Math.min(49, Math.round(r)));
  return (v < 0 ? '-' : '+') + String(Math.abs(v)).padStart(2, '0');
}

/** ADIF MODE and SUBMODE for an operator mode: FT4 is MODE MFSK with SUBMODE FT4 (ADIF 3.1). */
export function adifMode(mode: string): { mode: string; submode: string } {
  const m = mode.trim().toUpperCase();
  if (m === 'FT4') return { mode: 'MFSK', submode: 'FT4' };
  return { mode: m, submode: '' };
}

/** The mode as the operator says it: FT4 for MFSK/FT4, else MODE. */
export function displayMode(q: Pick<Qso, 'mode' | 'submode'>): string {
  return q.submode || q.mode;
}

type MyRefs = Pick<Qso, 'mySig' | 'mySigInfo' | 'myPotaRef' | 'mySotaRef' | 'myWwffRef' | 'myIota'>;
type TheirRefs = Pick<Qso, 'sig' | 'sigInfo' | 'potaRef' | 'sotaRef' | 'wwffRef' | 'iota'>;

const refsOf = (refs: readonly Reference[], p: Reference['programme']) => refs.filter((r) => r.programme === p).map((r) => r.ref);

/**
 * MY_ fields for an activation. MY_POTA_REF lists every park; MY_SIG and MY_SIG_INFO name the
 * first park, or the WWFF reference when there is no park. SOTA and IOTA have their own fields.
 */
export function activationFields(a: Pick<Activation, 'refs'> | null): MyRefs {
  const refs = a?.refs ?? [];
  const pota = refsOf(refs, 'POTA');
  const wwff = refsOf(refs, 'WWFF');
  const sig = pota.length ? { mySig: 'POTA', mySigInfo: pota[0] } : wwff.length ? { mySig: 'WWFF', mySigInfo: wwff[0] } : { mySig: '', mySigInfo: '' };
  return {
    ...sig,
    myPotaRef: pota.join(','),
    mySotaRef: refsOf(refs, 'SOTA')[0] ?? '',
    myWwffRef: wwff[0] ?? '',
    myIota: refsOf(refs, 'IOTA')[0] ?? '',
  };
}

/** SIG, SIG_INFO and the reference fields for the other station's references. */
export function theirFields(refs: readonly Reference[]): TheirRefs {
  const pota = refsOf(refs, 'POTA');
  const wwff = refsOf(refs, 'WWFF');
  const sig = pota.length ? { sig: 'POTA', sigInfo: pota[0] } : wwff.length ? { sig: 'WWFF', sigInfo: wwff[0] } : { sig: '', sigInfo: '' };
  return { ...sig, potaRef: pota.join(','), sotaRef: refsOf(refs, 'SOTA')[0] ?? '', wwffRef: wwff[0] ?? '', iota: refsOf(refs, 'IOTA')[0] ?? '' };
}

/** The other station's references read back from a QSO, for the edit form. */
export function theirRefs(q: TheirRefs): Reference[] {
  const out: Reference[] = [];
  for (const p of q.potaRef.split(',').map((s) => s.trim()).filter(Boolean)) out.push({ programme: 'POTA', ref: p });
  if (!q.potaRef && q.sig.toUpperCase() === 'POTA' && q.sigInfo) out.push({ programme: 'POTA', ref: q.sigInfo });
  if (q.sotaRef) out.push({ programme: 'SOTA', ref: q.sotaRef });
  if (q.wwffRef) out.push({ programme: 'WWFF', ref: q.wwffRef });
  if (q.iota) out.push({ programme: 'IOTA', ref: q.iota });
  return out;
}

/** A random UUID; crypto.randomUUID needs a secure context, so a fallback builds a v4 UUID. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface CreateContext {
  id: string;
  now: number;
  /** The activation the QSO belongs to, already resolved from the record. */
  activation: Activation | null;
  /** The operator's callsign from Settings. */
  callsign: string;
}

export class QsoInputError extends Error {}

function provenance(d: Partial<DecodeProvenance> | null | undefined): DecodeProvenance | null {
  if (!d) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { preset: typeof d.preset === 'string' ? d.preset : null, snrDb: num(d.snrDb), dtS: num(d.dtS), audioHz: num(d.audioHz) };
}

/** Builds a stored QSO from a logQso record. Throws QsoInputError when the call or times are unusable. */
export function createQso(r: LogQsoRecord, ctx: CreateContext): Qso {
  const call = normaliseCall(r.call);
  if (!/[A-Z0-9]/.test(call)) throw new QsoInputError('The QSO has no callsign.');
  if (!Number.isFinite(r.startUtcMs) || !Number.isFinite(r.endUtcMs)) throw new QsoInputError('The QSO has no start or end time.');
  const a = ctx.activation;
  const freq = r.dialHz + r.audioHz;
  const stationCallsign = normaliseCall(r.stationCallsign ?? a?.callsign ?? ctx.callsign);
  return {
    call,
    gridsquare: normaliseGrid(r.grid ?? ''),
    ...adifMode(r.mode),
    band: r.band.toLowerCase(),
    freqHz: Number.isFinite(freq) && freq > 0 ? Math.round(freq) : null,
    start: Math.min(r.startUtcMs, r.endUtcMs),
    end: Math.max(r.startUtcMs, r.endUtcMs),
    rstSent: formatReport(r.reportSent),
    rstRcvd: formatReport(r.reportRcvd),
    stationCallsign,
    operator: normaliseCall(a?.operator || ctx.callsign),
    myGridsquare: normaliseGrid(r.myGridsquare ?? a?.grid ?? ''),
    txPwrW: typeof r.txPwrW === 'number' && r.txPwrW > 0 ? r.txPwrW : null,
    ...activationFields(a),
    ...theirFields(r.theirRefs ?? []),
    comment: (r.comment ?? '').trim(),
    extra: {},
    id: ctx.id,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    activationId: a?.id ?? null,
    source: r.source ?? 'sequencer',
    decode: provenance(r.decode),
  };
}

/** The station fields an activation sets on its QSOs; used when the activation is edited. */
export function stampActivation(q: Qso, a: Activation): Qso {
  return {
    ...q,
    ...activationFields(a),
    stationCallsign: a.callsign || q.stationCallsign,
    operator: a.operator || q.operator,
    myGridsquare: a.grid || q.myGridsquare,
  };
}

/** True when two QSOs differ in a field a destination receives. */
export function adifChanged(a: Qso, b: Qso): boolean {
  const skip = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'activationId', 'source', 'decode']);
  for (const k of Object.keys(a) as (keyof Qso)[]) {
    if (skip.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
}
