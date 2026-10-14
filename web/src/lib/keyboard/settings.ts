/**
 * Settings every keyboard mode shares (Settings › Macros and the Contest group of Settings ›
 * RTTY): the macro sets, the set in use, the contest and its serial numbers.
 */

import { defaultMacros, normaliseMacros, type MacroSetId, type MacroSets } from './macros';

export interface KeyboardSettings {
  macros: MacroSets;
  /** The set in Operate's macro row: QSO or Contest. */
  set: MacroSetId;
  /** CONTEST_ID written with Contest set QSOs, such as CQ-WPX-RTTY; '' is Off. */
  contestId: string;
  /** The serial number the next Contest set QSO sends: 1 to 9999. */
  nextSerial: number;
  /** Digits a serial number is sent with: 1 to 4 (3 sends 042). */
  serialDigits: number;
  /** {EXCH}: the contest exchange, with fields. */
  exchange: string;
}

export function keyboardDefaults(): KeyboardSettings {
  return { macros: defaultMacros(), set: 'qso', contestId: '', nextSerial: 1, serialDigits: 3, exchange: '599 {NR}' };
}

/** "CQ-WPX-RTTY": upper case letters, digits and dashes, at most 32. */
export function normaliseContestId(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 32);
}

export function validateKeyboard(raw: unknown): KeyboardSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const k = keyboardDefaults();
  k.macros = normaliseMacros(r.macros);
  if (r.set === 'qso' || r.set === 'contest') k.set = r.set;
  if (typeof r.contestId === 'string') k.contestId = normaliseContestId(r.contestId);
  if (typeof r.nextSerial === 'number' && Number.isInteger(r.nextSerial) && r.nextSerial >= 1 && r.nextSerial <= 9999) k.nextSerial = r.nextSerial;
  if (typeof r.serialDigits === 'number' && Number.isInteger(r.serialDigits) && r.serialDigits >= 1 && r.serialDigits <= 4) k.serialDigits = r.serialDigits;
  if (typeof r.exchange === 'string') k.exchange = r.exchange.slice(0, 60);
  return k;
}
