// The log's records: QSOs, the delivery ledger, destinations and activations (docs/design/log.md).

/** Programmes an activation can count towards. */
export const PROGRAMMES = ['POTA', 'SOTA', 'WWFF', 'IOTA'] as const;
export type Programme = (typeof PROGRAMMES)[number];

/** A park, summit, WWFF area or island group, such as POTA VK-0921. */
export interface Reference {
  programme: Programme;
  /** Upper case, as published: VK-0921, VK3/VC-012, VKFF-0921, OC-001. */
  ref: string;
}

export type QsoSource = 'sequencer' | 'manual' | 'import' | 'keyboard';

/** Where a sequencer QSO's last decode of the other station came from. */
export interface DecodeProvenance {
  /** Decoder preset, such as subtract-3. */
  preset: string | null;
  /** SNR of their last decode, dB in 2500 Hz. */
  snrDb: number | null;
  /** DT of their last decode, s. */
  dtS: number | null;
  /** Their audio frequency, Hz. */
  audioHz: number | null;
}

/**
 * One QSO: the ADIF fields RR73 writes, then RR73's own fields. Text fields hold '' when
 * unknown, so every record has the same shape in IndexedDB.
 */
export interface Qso {
  /** CALL, upper case. */
  call: string;
  /** GRIDSQUARE, their grid when received. */
  gridsquare: string;
  /** MODE: FT8, RTTY, MFSK for FT4 (ADIF 3.1), or DATA for LQ8 (the LQ8 portal's ADIF). */
  mode: string;
  /** SUBMODE: FT4 with MODE MFSK, LQ8 with MODE DATA, else ''. */
  submode: string;
  /** BAND, lower case: 20m. */
  band: string;
  /** FREQ as dial plus audio frequency, Hz. */
  freqHz: number | null;
  /** QSO_DATE and TIME_ON, UTC ms. */
  start: number;
  /** QSO_DATE_OFF and TIME_OFF, UTC ms. */
  end: number;
  /** RST_SENT and RST_RCVD as sent on air: -14, +05. */
  rstSent: string;
  rstRcvd: string;
  /** STATION_CALLSIGN: the call used on air, such as VK3/9V1NE. */
  stationCallsign: string;
  /** OPERATOR: the operator's own callsign. */
  operator: string;
  /** MY_GRIDSQUARE. */
  myGridsquare: string;
  /** TX_PWR, W. */
  txPwrW: number | null;
  /** MY_SIG and MY_SIG_INFO: POTA's own docs use these. */
  mySig: string;
  mySigInfo: string;
  /** MY_POTA_REF: one park, or a comma-separated list for a multi-park activation. */
  myPotaRef: string;
  mySotaRef: string;
  myWwffRef: string;
  myIota: string;
  /** Their reference, for park to park and summit to summit. */
  sig: string;
  sigInfo: string;
  potaRef: string;
  sotaRef: string;
  wwffRef: string;
  iota: string;
  /** COMMENT. */
  comment: string;
  /** NAME and QTH: the other operator's name and location, as received. */
  name: string;
  qth: string;
  /** STX and SRX: contest serial numbers sent and received, as on air ("042"). */
  stx: string;
  srx: string;
  /** CONTEST_ID, such as CQ-WPX-RTTY. */
  contestId: string;
  /** Other ADIF fields from an import, by upper-case name, written back unchanged. */
  extra: Record<string, string>;

  /** RR73: a UUID. */
  id: string;
  /** RR73: when the QSO was logged and last changed, UTC ms. */
  createdAt: number;
  updatedAt: number;
  /** RR73: set by Undo and Delete. The record stays as a tombstone so destinations can be told. */
  deletedAt: number | null;
  activationId: string | null;
  source: QsoSource;
  decode: DecodeProvenance | null;
}

/**
 * What the sequencer's logQso effect carries, and what manual entry builds. Station fields
 * left out come from the running activation and Settings.
 */
export interface LogQsoRecord {
  call: string;
  /** Their grid, when received. */
  grid?: string | null;
  mode: 'FT8' | 'FT4' | 'LQ8' | 'RTTY';
  band: string;
  /** Dial frequency, Hz. */
  dialHz: number;
  /** Our transmit audio frequency, Hz: the lowest tone in FT8 and FT4, the mark tone in RTTY. FREQ is dial plus audio. */
  audioHz: number;
  startUtcMs: number;
  endUtcMs: number;
  /** Reports as sent on air, dB: -14, or the text "-14" or "599". */
  reportSent: number | string;
  reportRcvd: number | string;
  /** NAME, QTH, STX, SRX and CONTEST_ID, from a keyboard mode's strip. */
  name?: string;
  qth?: string;
  stx?: string;
  srx?: string;
  contestId?: string;
  /** The activation the QSO belongs to. Left out: the running one. null: none. */
  activationId?: string | null;
  /** Defaults to sequencer. */
  source?: QsoSource;
  decode?: Partial<DecodeProvenance> | null;
  comment?: string;
  /** Their references, for park to park and summit to summit. */
  theirRefs?: Reference[];
  txPwrW?: number | null;
  /** The call used on air; defaults to the activation's, then Settings. */
  stationCallsign?: string;
  myGridsquare?: string;
}

export const DESTINATION_IDS = ['wavelog', 'adif-file', 'pota-file', 'sota-file', 'wwff-file'] as const;
/** One destination of each kind for now, so the id is the kind. */
export type DestinationId = (typeof DESTINATION_IDS)[number];
export type DestinationKind = DestinationId;
export type FileDestinationId = Exclude<DestinationId, 'wavelog'>;
export type Transport = 'direct' | 'relay' | 'file';

/**
 * not-sent: a direct destination's copy the operator has not sent yet, with Send automatically
 * off. waiting: queued, and the outbox sends it while RR73 is open and online.
 */
export const LEDGER_STATES = ['not-sent', 'waiting', 'delivered', 'refused', 'changed', 'file-ready', 'submitted', 'not-needed'] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

/**
 * What the operator does about a refusal: change the Wavelog address or key, choose a station
 * location, edit the QSO (which sends it again), or fix something at the destination and send again.
 */
export type FixKind = 'wavelog-address' | 'wavelog-key' | 'wavelog-station' | 'edit-qso' | 'resend';

export interface Refusal {
  fix: FixKind;
  /** destination: every QSO waiting for this destination is refused for the same reason. */
  scope: 'qso' | 'destination';
}

/** A file that includes a QSO: one POTA park and UTC day, one SOTA summit and UTC day, and so on. */
export interface FilePart {
  /** pota|VK-0921|20261013, sota|VK3/VC-012|20261013, wwff|VKFF-0921|<activation id>, adif|<activation id>. */
  key: string;
  submittedAt: number | null;
}

/** One QSO at one destination. */
export interface LedgerEntry {
  qsoId: string;
  destinationId: DestinationId;
  state: LedgerState;
  attempts: number;
  lastAttemptAt: number | null;
  /** Direct destinations: when the outbox may send it, UTC ms. */
  nextAttemptAt: number | null;
  /** Plain words: why it failed and what to do, or why it changed. */
  lastError: string | null;
  refusal: Refusal | null;
  remoteRef: string | null;
  deliveredAt: number | null;
  /** The QSO's updatedAt when the destination received it (or the file was submitted). */
  deliveredUpdatedAt: number | null;
  /** The last attempt timed out, so the destination may hold the QSO already. */
  possibleDuplicate: boolean;
  /** The destination reported it already held the QSO. */
  duplicate: boolean;
  /** File destinations: the files that include this QSO. */
  parts: FilePart[];
}

export interface WavelogStation {
  id: string;
  name: string;
  callsign: string;
  grid: string;
  /** Wavelog's active station location. */
  active: boolean;
}

export interface WavelogTest {
  at: number;
  ok: boolean;
  /** Plain words, shown under the Wavelog row. */
  message: string;
  rights: 'r' | 'rw' | null;
  version: string | null;
}

export interface WavelogConfig {
  id: 'wavelog';
  kind: 'wavelog';
  enabled: boolean;
  /** Base address, such as https://log.example.com. */
  url: string;
  /** Stored only in this phone's IndexedDB. */
  apiKey: string;
  /** Station location for QSOs outside an activation, and the default for new activations. */
  stationId: string | null;
  /** Station locations from the last successful Test connection. */
  stations: WavelogStation[];
  lastTest: WavelogTest | null;
  /**
   * Read Wavelog's log: RR73 reads what Wavelog's log holds for decode colours, the New
   * chip and Hide worked only (docs/design/wavelog-worked.md). Off by default.
   */
  readWorked: boolean;
}

export interface FileDestinationConfig {
  id: FileDestinationId;
  kind: FileDestinationId;
  enabled: boolean;
}

export type DestinationConfig = WavelogConfig | FileDestinationConfig;

export interface LoggingSettings {
  /** The outbox runs by itself while RR73 is open and online. */
  sendAutomatically: boolean;
  /** Edits to delivered QSOs go out again where the destination accepts changes. */
  sendEdits: boolean;
}

export interface Activation {
  id: string;
  refs: Reference[];
  /** The call used on air, such as VK3/9V1NE. */
  callsign: string;
  /** The operator's own callsign, written as OPERATOR. */
  operator: string;
  grid: string;
  gridSource: 'gps' | 'typed' | 'none';
  /** Wavelog station location for this activation's QSOs; null uses the Wavelog default. */
  wavelogStationId: string | null;
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
}
