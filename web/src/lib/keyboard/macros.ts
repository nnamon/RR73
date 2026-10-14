/**
 * Macros for every keyboard mode (docs/design/rtty.md, "Macro fields"): one QSO set and one
 * Contest set, shared by RTTY and the keyboard modes after it. A macro's fields expand when it is
 * tapped; Return to Rx ends the transmission after its text, and Log QSO when sent logs the
 * strip once its text has gone to the transmitter.
 */

export interface Macro {
  id: string;
  label: string;
  text: string;
  returnToRx: boolean;
  logWhenSent: boolean;
}

export type MacroSetId = 'qso' | 'contest';
export type MacroSets = Record<MacroSetId, Macro[]>;

/** The fields a macro can hold, in the order of the field buttons in Settings › Macros. */
export const FIELDS = ['CALL', 'NAME', 'QTH', 'RST', 'NR', 'EXCH', 'MYCALL', 'MYNAME', 'MYQTH', 'MYGRID', 'UTC'] as const;
export type Field = (typeof FIELDS)[number];

export type FieldValues = Record<Field, string>;

const m = (id: string, label: string, text: string, returnToRx = true, logWhenSent = false): Macro => ({ id, label, text, returnToRx, logWhenSent });

/** The default sets, as approved with the design. */
export function defaultMacros(): MacroSets {
  return {
    qso: [
      m('q-cq', 'CQ', 'CQ CQ CQ DE {MYCALL} {MYCALL} {MYCALL} PSE K'),
      m('q-answer', 'Answer', '{CALL} {CALL} DE {MYCALL} {MYCALL} {MYCALL} K'),
      m('q-over', 'Over', '{CALL} DE {MYCALL}', false),
      m('q-report', 'Report', 'TNX FER CALL. UR RST {RST} {RST}. NAME {MYNAME} {MYNAME} QTH {MYQTH} {MYQTH}'),
      m('q-btu', 'BTU', 'BTU {CALL} DE {MYCALL} K'),
      m('q-73', '73', 'TNX {NAME} 73 ES GL. {CALL} DE {MYCALL} SK'),
      m('q-qrz', 'QRZ?', 'QRZ? DE {MYCALL} K'),
      m('q-again', 'Again', 'AGN AGN PSE'),
    ],
    contest: [
      m('c-cq', 'CQ', 'CQ TEST {MYCALL} {MYCALL} CQ'),
      m('c-exch', 'Exch', '{CALL} {EXCH} {NR} {CALL}'),
      m('c-tu', 'TU', 'TU {MYCALL} TEST', true, true),
      m('c-mycall', 'My call', '{MYCALL} {MYCALL}'),
      m('c-sp', 'S&P exch', 'TU {EXCH} {NR}', true, true),
      m('c-again', 'Again', 'AGN AGN'),
      m('c-nr', 'Nr?', 'NR? NR?'),
      m('c-call', 'Call?', 'CL? CL?'),
    ],
  };
}

/** The station's name, QTH and grid, as the status line names them: a macro that needs one of them empty is not sent. */
export const STATION_FIELDS: Partial<Record<Field, string>> = { MYNAME: 'name', MYQTH: 'QTH', MYGRID: 'grid' };

/**
 * Before 0.14.1 the default Report macro kept Tx on after its text, against the design, which
 * ends every default macro but Over with Return to Rx. A stored Report still as it shipped then
 * gets Return to Rx; one the operator edited stays as it is.
 */
export function fixShippedReport(sets: MacroSets): MacroSets {
  const shipped = 'TNX FER CALL. UR RST {RST} {RST}. NAME {MYNAME} {MYNAME} QTH {MYQTH} {MYQTH}';
  const qso = sets.qso.map((x) => (x.id === 'q-report' && x.label === 'Report' && x.text === shipped && !x.returnToRx && !x.logWhenSent ? { ...x, returnToRx: true } : x));
  return { ...sets, qso };
}

/** The serial number as sent, with the digits set: 42 with 3 digits gives "042". */
export function serialText(n: number, digits: number): string {
  return String(Math.max(0, Math.round(n))).padStart(Math.max(1, Math.min(4, digits)), '0');
}

/** "1405" for a UTC time in ms. */
export function utc4(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** A field, in any case: {CALL} and {call} are the same field. */
const FIELD_RE = /\{([A-Za-z]+)\}/g;

/** Fields in `text`, each once, in order of appearance. */
export function fieldsIn(text: string): Field[] {
  const out: Field[] = [];
  for (const [, raw] of text.matchAll(FIELD_RE)) {
    const name = raw.toUpperCase();
    if ((FIELDS as readonly string[]).includes(name) && !out.includes(name as Field)) out.push(name as Field);
  }
  return out;
}

/**
 * Expands a macro's fields. {EXCH} is the exchange from Settings, itself expanded ("599 {NR}"
 * gives "599 042"). Fields with no value expand to nothing, and the spaces around them close up.
 * Returns the text and the fields that had no value.
 */
export function expand(text: string, v: FieldValues): { text: string; missing: Field[] } {
  const missing: Field[] = [];
  const one = (src: string, inner: boolean): string =>
    src.replace(FIELD_RE, (all, raw: string) => {
      const name = raw.toUpperCase();
      if (!(FIELDS as readonly string[]).includes(name)) return all;
      const f = name as Field;
      const value = f === 'EXCH' ? (inner ? '' : one(v.EXCH, true)) : v[f];
      if (!value.trim() && !missing.includes(f)) missing.push(f);
      return value;
    });
  const out = one(text, false)
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').replace(/ +([.,])/g, '$1').trimEnd())
    .join('\n');
  return { text: out, missing };
}

/** The text a macro adds to the queue: on a new line unless it starts with a space or the line is empty. */
export function queued(text: string, atLineStart: boolean): string {
  if (text.startsWith(' ') || atLineStart) return text;
  return `\n${text}`;
}

/** A new macro's id. */
export function newMacroId(): string {
  return `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function validMacro(raw: unknown): Macro | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.text !== 'string') return null;
  return { id: r.id, label: r.label.slice(0, 24), text: r.text.slice(0, 500), returnToRx: r.returnToRx !== false, logWhenSent: r.logWhenSent === true };
}

/** Stored sets, each kept when it is a list of macros; a missing set takes the defaults. */
export function normaliseMacros(raw: unknown): MacroSets {
  const d = defaultMacros();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const set = (k: MacroSetId) => (Array.isArray(r[k]) ? (r[k] as unknown[]).map(validMacro).filter((x): x is Macro => x !== null) : d[k]);
  return { qso: set('qso'), contest: set('contest') };
}

/** Macros of a set that differ from the defaults: edited, added or removed. */
export function changedCount(set: readonly Macro[], defaults: readonly Macro[]): number {
  const byId = new Map(defaults.map((x) => [x.id, x]));
  let n = 0;
  for (const x of set) {
    const d = byId.get(x.id);
    if (!d || d.label !== x.label || d.text !== x.text || d.returnToRx !== x.returnToRx || d.logWhenSent !== x.logWhenSent) n++;
  }
  n += defaults.filter((d) => !set.some((x) => x.id === d.id)).length;
  return n;
}
