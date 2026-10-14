// WSPRnet's upload records, as WSJT-X sends them (docs/design/qsp.md, WSPRnet): one
// form-encoded record per POST to https://wsprnet.org/post/. A slot with spots sends one
// `function=wspr` record per spot within 10 kHz of the reporter's frequency (dial + 1500 Hz); a
// slot without spots sends one `function=wsprstat` record. Messages of Type 1 (CALL GRID4 DBM),
// Type 2 (compound callsign and power, sent with an empty grid) and Type 3 (<CALL> GRID6 DBM,
// sent without the brackets) are uploaded; an unresolved hash is not.

import type { WsprDecode } from '../wspr/spots';
import { driftHz } from '../wspr/spots';
import { readMessage } from '../wspr/message';

/** WSPR's mode code. */
export const MODE_WSPR = 2;

export interface Reporter {
  /** Callsign as configured. */
  callsign: string;
  /** Locator as configured, 4 or 6 characters. */
  grid: string;
  /** Software and version. */
  version: string;
}

/** The station's own transmit settings, for `wsprstat`. */
export interface TxStatus {
  /** Transmit percentage while the beacon is on, else 0. */
  pct: number;
  /** Dial + Tx audio, Hz. */
  frequencyHz: number;
  dbm: number;
}

/** Form encoding as WSPRnet takes it: letters, digits, `-._~` and `/` as they are, every other byte as %XX (a space as %20). */
export function form(pairs: readonly (readonly [string, string])[]): string {
  return pairs
    .map(([k, v]) => {
      let out = `${k}=`;
      for (const b of new TextEncoder().encode(v)) {
        const c = String.fromCharCode(b);
        out += /[A-Za-z0-9\-._~/]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      return out;
    })
    .join('&');
}

/** MHz to 6 decimals: 14097100 Hz gives "14.097100". */
export function mhz(hz: number): string {
  const n = Math.round(hz);
  return `${Math.floor(n / 1e6)}.${String(n % 1e6).padStart(6, '0')}`;
}

/** One decimal, without "-0.0". */
function oneDecimal(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? '0.0' : r.toFixed(1);
}

/** `yymmdd` and `hhmm` of a UTC time. */
export function dateTime(ms: number): [string, string] {
  const iso = new Date(ms).toISOString();
  return [iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10), iso.slice(11, 13) + iso.slice(14, 16)];
}

/** A slot's records, in decode order. */
export function records(reporter: Reporter, slotStartMs: number, dialHz: number, decodes: readonly WsprDecode[], tx: TxStatus): string[] {
  const rqrg = dialHz + 1500;
  const rgrid = reporter.grid.trim().toUpperCase();
  const rcall = reporter.callsign.trim().toUpperCase();
  if (!decodes.length) {
    return [
      form([
        ['function', 'wsprstat'],
        ['rcall', rcall],
        ['rgrid', rgrid],
        ['rqrg', mhz(rqrg)],
        ['tpct', String(tx.pct)],
        ['tqrg', mhz(tx.frequencyHz)],
        ['dbm', String(tx.dbm)],
        ['version', reporter.version],
        ['mode', String(MODE_WSPR)],
      ]),
    ];
  }
  const [date, time] = dateTime(slotStartMs);
  const out: string[] = [];
  for (const d of decodes) {
    const m = readMessage(d.text);
    if (!m.call || m.powerDbm === null) continue;
    const hz = dialHz + d.freq_hz;
    if (Math.abs(hz - rqrg) >= 10_000) continue;
    out.push(
      form([
        ['function', 'wspr'],
        ['date', date],
        ['time', time],
        ['sig', String(Math.round(d.snr_db))],
        ['dt', oneDecimal(d.dt_s)],
        ['drift', String(Math.round(driftHz(d.drift_hz_per_s)))],
        ['tqrg', mhz(hz)],
        ['tcall', m.call],
        ['tgrid', m.msgType === 2 ? '' : (m.grid ?? '').toUpperCase()],
        ['dbm', String(m.powerDbm)],
        ['version', reporter.version],
        ['rcall', rcall],
        ['rgrid', rgrid],
        ['rqrg', mhz(rqrg)],
        ['mode', String(MODE_WSPR)],
      ]),
    );
  }
  return out;
}
