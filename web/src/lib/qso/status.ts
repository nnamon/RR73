/**
 * Every notice the status line above Operate's buttons shows. Each one states the event or the
 * new value in a few words, with no full stop: "Tx set to 908 Hz", "No reply from VK2LAW". No
 * reasons or instructions unless the operator has to act. The copy lint holds every string in
 * this file to 6 words of copy and no closing full stop (tools/lint-copy, status rule).
 */

export const STATUS = {
  noReply: (call: string) => `No reply from ${call}`,
  noReplyNotLogged: (call: string) => `No reply from ${call} · not logged`,
  endedEarly: (call: string) => `${call} ended early · not logged`,
  answered: (call: string, other: string) => `${call} answered ${other}`,
  stillWorking: (call: string, other: string) => `${call} is still working ${other}`,
  noCall: 'No callsign to call',
  setUp: 'Set callsign and grid in Settings',
  audioOff: 'Audio off',
  audioStopped: 'Audio stopped · Tx off',
  watchdog: (min: number) => `Watchdog stopped Tx after ${min} min`,
  watchdogLast: 'Watchdog ends Tx after this QSO',
  encode: 'Message cannot be encoded',
  txSet: (hz: number) => `Tx set to ${hz} Hz`,
  noClear: 'Not enough audio yet',
  decodesCleared: 'Decodes cleared',
  practice: (scenario: string) => `Practice · ${scenario}`,
  foxUnknown: 'Fox callsign not in this message',
  houndCalling: (call: string) => `Calling the Fox · ${call}`,
  houndReport: (db: string, call: string) => `Report received · ${db} dB from ${call}`,
  houndLogged: (call: string) => `Logged · ${call}`,
  beaconStopped: (after: string) => `Beacon stopped after ${after}`,
  beaconOff: 'Audio stopped · Beacon off',
  beaconSort: (by: string) => `Spots sorted by ${by}`,
  beaconStopAfter: (after: string) => `Stop beacon after ${after}`,
  beaconPct: (pct: number) => `Tx in ${pct}% of slots`,
  noWsprCall: 'Callsign cannot be sent in WSPR',
  spotsCleared: 'Spots cleared',
  noMyCall: 'Set callsign in Settings',
  callSet: (call: string) => `Call set to ${call}`,
  tuned: (hz: number) => `Tuned to ${hz} Hz`,
  shiftFound: (hz: number) => `Shift ${hz} Hz found`,
  notSent: (chars: string) => `Not sent: ${chars}`,
  idleOff: (after: string) => `Tx off after ${after} idle`,
  speedShift: (baud: number, shift: number) => `Speed ${baud} baud, shift ${shift} Hz`,
  squelch: (db: string) => `Squelch ${db}`,
  reverse: (on: boolean) => (on ? 'Reverse on' : 'Reverse off'),
  afc: (on: boolean) => (on ? 'AFC on' : 'AFC off'),
  macroSet: (set: string) => `${set} macros`,
  textCleared: 'Text cleared',
} as const;

/** Why a call paused on its last message, after the message in the status line: "Tx1 · VK2LAW 9V1NE OJ11 · no reply". */
export const PAUSED = {
  noReply: 'no reply',
  answered: (other: string) => `answered ${other}`,
  working: (other: string) => `working ${other}`,
} as const;
