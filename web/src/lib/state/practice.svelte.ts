// The practice band's switches, kept in IndexedDB under their own key ("practice"), outside the
// settings record: the settings schema and its migrations stay as they are.

import { getKv, mergeKv, peekKv } from './db';
import { isScenario, type ScenarioId } from '../practice/scenarios';

export interface PracticeSettings {
  /** The practice band replaces the radio: its own log, a Wavelog stand-in, no network sends. */
  on: boolean;
  /** Tx audio plays as on the air. Off, transmissions run silently. */
  playTx: boolean;
  /** 25 to 40 stations a slot in place of 8 to 15. */
  crowded: boolean;
  scenario: ScenarioId;
}

export const PRACTICE_DEFAULTS: Readonly<PracticeSettings> = { on: false, playTx: true, crowded: false, scenario: 'random' };

const KEY = 'practice';

export const practice = $state<PracticeSettings>({ ...PRACTICE_DEFAULTS });

export function validatePractice(raw: unknown): PracticeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    on: typeof r.on === 'boolean' ? r.on : PRACTICE_DEFAULTS.on,
    playTx: typeof r.playTx === 'boolean' ? r.playTx : PRACTICE_DEFAULTS.playTx,
    crowded: typeof r.crowded === 'boolean' ? r.crowded : PRACTICE_DEFAULTS.crowded,
    scenario: isScenario(r.scenario) ? r.scenario : PRACTICE_DEFAULTS.scenario,
  };
}

let changed = false;

/** Reads the stored switches; changes made before they arrive win. */
export async function loadPractice(): Promise<void> {
  try {
    const peeked = await peekKv<unknown>(KEY);
    const stored = peeked ? peeked.value : await getKv<unknown>(KEY);
    if (!changed) Object.assign(practice, validatePractice(stored));
  } catch {
    // No storage: practice stays off.
  }
}

export async function updatePractice(patch: Partial<PracticeSettings>): Promise<void> {
  changed = true;
  Object.assign(practice, patch);
  try {
    await mergeKv(KEY, { ...patch });
  } catch {
    // As in loadPractice.
  }
}

/** The Tx output level: silent while practice is on with Play Tx audio off. */
export function txLevel(level: number): number {
  return practice.on && !practice.playTx ? 0 : level;
}
