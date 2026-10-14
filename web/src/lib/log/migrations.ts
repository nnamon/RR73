/**
 * One-time changes to stored log settings. Each has an id recorded in the kv store under
 * "migrations" once it has run, so it runs once per phone and a later choice sticks.
 */

import type { LoggingSettings } from './types';

/**
 * 0.5.0 sent QSOs to Wavelog by itself. The operator reviews the log first, so Send automatically
 * starts off: on a phone that ran 0.5.0 it is switched off once; turning it on afterwards sticks.
 */
export const SEND_AUTOMATICALLY_OFF = 'logging-send-automatically-off';

export interface Migrated {
  settings: LoggingSettings;
  /** Ids of every migration that has run, this one included. */
  applied: string[];
  /** True when something ran now and needs storing. */
  changed: boolean;
}

export function migrateLogging(stored: Partial<LoggingSettings> | undefined, applied: readonly string[] | undefined, defaults: LoggingSettings): Migrated {
  const done = Array.isArray(applied) ? applied.filter((x): x is string => typeof x === 'string') : [];
  const settings: LoggingSettings = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  if (done.includes(SEND_AUTOMATICALLY_OFF)) return { settings, applied: done, changed: false };
  return { settings: { ...settings, sendAutomatically: false }, applied: [...done, SEND_AUTOMATICALLY_OFF], changed: true };
}
