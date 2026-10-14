/**
 * Practice mode: the practice band in place of the radio. Turning it on swaps four things, and
 * turning it off swaps them back:
 *
 * - capture: the practice band (source.ts) in place of the microphone, through the same worklet,
 *   slot assembler and decoder;
 * - the log: the practice log, a database of its own (log/store.ts);
 * - Wavelog: a stand-in on the phone (wavelog-stand-in.ts);
 * - the network: the guard in guard.ts refuses every request except the app's own files.
 *
 * The stations react to what the sequencer sends: each slot reads the operator's transmission
 * in the slot before from qso.sent.
 */

import { SLOT_MS, SLOT_RATE, isFt, type FtMode } from '../clock/slots';
import { log, notify, reloadLog, setFetch, setWavelog, useLog } from '../log/log.svelte';
import { countPracticeQsos, restorePracticeRecords, takePracticeRecords, type PracticeRecords } from '../log/store';
import { practice, updatePractice } from '../state/practice.svelte';
import { endQso, qso, showNotice } from '../state/qso.svelte';
import { settings } from '../state/settings.svelte';
import { codec, setInputSource, startAudio } from '../state/station.svelte';
import { STATUS } from '../qso/status';
import { scenarioOf, type ScenarioId } from './scenarios';
import { PracticeBand, type OperatorTx } from './sim';
import { PracticeInput, type SlotFeed } from './source';
import { STAND_IN_URL, standInConfig, wavelogStandIn } from './wavelog-stand-in';

let band: PracticeBand | null = null;
let bandKey = '';
/** A new band each time the app starts or a scenario is chosen; tests set their own. */
let seed = Date.now() >>> 0;

function myStation() {
  const c = qso.st.config;
  return { callsign: c.myCall || settings.callsign, grid: c.myGrid || settings.grid };
}

/**
 * The band for the current settings: a new one when the mode, band or callsign changes. A new
 * scenario or the crowded band applies to the stations already there.
 */
function currentBand(): PracticeBand {
  const c = qso.st.config;
  const key = [seed, settings.mode, settings.band, c.myCall, c.myGrid].join('|');
  if (!band || key !== bandKey) {
    band = new PracticeBand({ seed, scenario: practice.scenario, crowded: practice.crowded, myCall: c.myCall, myGrid: c.myGrid, mode: ftMode() });
    bandKey = key;
  }
  band.configure({ scenario: practice.scenario, crowded: practice.crowded });
  return band;
}

/** What the sequencer transmitted in the slot starting at `slotStartMs`. */
function operatorTx(slotStartMs: number): OperatorTx | null {
  const row = qso.sent.find((r) => r.slotStartMs === slotStartMs);
  return row ? { text: row.text, freqHz: row.freqHz } : null;
}

/** The practice band's stations work FT8 and FT4; in WSPR the band carries its noise only. */
function ftMode(): FtMode {
  return isFt(settings.mode) ? settings.mode : 'FT8';
}

const feed: SlotFeed = {
  mode: ftMode,
  signals: (startMs) => (isFt(settings.mode) ? currentBand().slot(startMs, operatorTx(startMs - SLOT_MS[ftMode()])) : []),
  synth: (text, mode, f0Hz) => codec().synthesize(text, mode, f0Hz, SLOT_RATE),
};

const input = new PracticeInput(feed);
const standIn = wavelogStandIn(myStation);

async function apply(on: boolean): Promise<void> {
  setFetch(on ? standIn.fetch : null);
  setInputSource(on ? input : null);
  await useLog(on);
  if (on && log.wavelog.url !== STAND_IN_URL) {
    const s = myStation();
    await setWavelog(standInConfig(s.callsign, s.grid));
  }
}

let started = false;

/** At app start: with practice on from before, the practice band and log take over. Audio waits for a tap. */
export function initPractice(): Promise<void> {
  if (started) return Promise.resolve();
  started = true;
  return practice.on ? apply(true) : Promise.resolve();
}

/** Turns practice on or off. Call from the tap: turning it on starts the band at once. */
export function setPracticeOn(on: boolean): Promise<void> {
  if (on === practice.on) return Promise.resolve();
  // A QSO in progress belongs to the band it started on.
  endQso();
  void updatePractice({ on });
  const switched = apply(on);
  if (on) void startAudio();
  return switched;
}

/** Chooses a scenario from the ••• menu. The stations on the band follow it from the next slot. */
export function chooseScenario(id: ScenarioId) {
  void updatePractice({ scenario: id });
  const s = scenarioOf(id);
  showNotice(STATUS.practice(s.name));
}

export function setCrowded(on: boolean) {
  return updatePractice({ crowded: on });
}

export function setPlayTx(on: boolean) {
  return updatePractice({ playTx: on });
}

/** QSOs in the practice log. */
export async function practiceQsoCount(): Promise<number> {
  if (practice.on) return log.live.length;
  try {
    return await countPracticeQsos();
  } catch {
    return 0;
  }
}

const plural = (n: number) => `${n} practice ${n === 1 ? 'QSO' : 'QSOs'}`;

/** Clear practice log: empties it at once and offers Undo. The log is untouched. */
export async function clearPracticeLog(): Promise<number> {
  const taken = await takePracticeRecords();
  if (practice.on) await reloadLog();
  const n = taken.qsos.filter((q) => q.deletedAt === null).length;
  notify({ kind: 'cleared', qsoId: null, text: `Cleared ${plural(n)}`, undo: () => void undoClear(taken, n) });
  return n;
}

async function undoClear(r: PracticeRecords, n: number) {
  await restorePracticeRecords(r);
  if (practice.on) await reloadLog();
  notify({ kind: 'info', qsoId: null, text: `Restored ${plural(n)}` });
  cleared.version++;
}

/** Changes after a clear or its Undo, for screens that show the count. */
export const cleared = $state({ version: 0 });

/** Tests fix the band's seed. */
export function setPracticeSeed(n: number) {
  seed = n >>> 0;
  band = null;
}
