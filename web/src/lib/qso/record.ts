/**
 * The QSO record the sequencer's logQso effect carries, in the shape of docs/design/log.md:
 * ADIF fields under their ADIF names, plus RR73's own fields. lib/log stores it as is.
 */

import type { Mode } from '../clock/slots';
import { baseCall } from '../decode/marking';
import { bare } from './messages';

export interface QsoRecord {
  // ADIF fields
  CALL: string;
  GRIDSQUARE?: string;
  /** FT8, or MFSK with SUBMODE FT4 (ADIF 3.1). */
  MODE: 'FT8' | 'MFSK';
  SUBMODE?: 'FT4';
  BAND: string;
  /** MHz: dial plus our transmit audio frequency, 6 decimals. */
  FREQ: string;
  /** YYYYMMDD and HHMMSS, UTC. */
  QSO_DATE: string;
  TIME_ON: string;
  QSO_DATE_OFF: string;
  TIME_OFF: string;
  /** dB as sent on air, such as -14. */
  RST_SENT: string;
  RST_RCVD: string;
  STATION_CALLSIGN: string;
  OPERATOR: string;
  MY_GRIDSQUARE: string;
  TX_PWR?: string;
  MY_SIG?: string;
  MY_SIG_INFO?: string;
  MY_POTA_REF?: string;
  MY_SOTA_REF?: string;
  MY_WWFF_REF?: string;
  MY_IOTA?: string;
  COMMENT?: string;
  // RR73 fields
  /** UUID. */
  id: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  updatedAt: string;
  activationId: string | null;
  /** Set by Undo and delete: a tombstone that destinations can be told about. */
  deletedAt: string | null;
  source: 'sequencer' | 'manual';
  /** How the other station's last decode looked. */
  provenance: { preset: string; snrDb: number; dtS: number; audioHz: number };
}

export interface QsoDetails {
  call: string;
  grid: string | null;
  mode: Mode;
  band: string;
  dialHz: number;
  /** Our transmit audio frequency, Hz. */
  txHz: number;
  startMs: number;
  endMs: number;
  /** Reports as sent on air, such as "-14". */
  sent: string;
  rcvd: string;
  stationCall: string;
  myGrid: string;
  activationId: string | null;
  preset: string;
  snrDb: number;
  dtS: number;
  audioHz: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const date = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};
const time = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
};

export function buildRecord(q: QsoDetails, id: string, nowMs: number): QsoRecord {
  const now = new Date(nowMs).toISOString();
  const r: QsoRecord = {
    CALL: bare(q.call),
    MODE: q.mode === 'FT4' ? 'MFSK' : 'FT8',
    BAND: q.band.toLowerCase(),
    FREQ: ((q.dialHz + q.txHz) / 1e6).toFixed(6),
    QSO_DATE: date(q.startMs),
    TIME_ON: time(q.startMs),
    QSO_DATE_OFF: date(q.endMs),
    TIME_OFF: time(q.endMs),
    RST_SENT: q.sent,
    RST_RCVD: q.rcvd,
    STATION_CALLSIGN: q.stationCall.toUpperCase(),
    OPERATOR: baseCall(q.stationCall.toUpperCase()),
    MY_GRIDSQUARE: q.myGrid.toUpperCase(),
    id,
    createdAt: now,
    updatedAt: now,
    activationId: q.activationId,
    deletedAt: null,
    source: 'sequencer',
    provenance: { preset: q.preset, snrDb: q.snrDb, dtS: q.dtS, audioHz: q.audioHz },
  };
  if (q.mode === 'FT4') r.SUBMODE = 'FT4';
  if (q.grid) r.GRIDSQUARE = q.grid.toUpperCase();
  return r;
}
