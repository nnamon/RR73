import { describe, expect, it } from 'vitest';
import { migrateLogging, SEND_AUTOMATICALLY_OFF } from './migrations';

const DEFAULTS = { sendAutomatically: false, sendEdits: true };

describe('logging migrations', () => {
  it('switches Send automatically off once on a phone that ran 0.5.0, and records it', () => {
    expect(migrateLogging({ sendAutomatically: true, sendEdits: false }, undefined, DEFAULTS)).toEqual({
      settings: { sendAutomatically: false, sendEdits: false },
      applied: [SEND_AUTOMATICALLY_OFF],
      changed: true,
    });
  });

  it('keeps a later choice to turn it on', () => {
    expect(migrateLogging({ sendAutomatically: true, sendEdits: true }, [SEND_AUTOMATICALLY_OFF], DEFAULTS)).toEqual({
      settings: { sendAutomatically: true, sendEdits: true },
      applied: [SEND_AUTOMATICALLY_OFF],
      changed: false,
    });
  });

  it('records the migration on a new phone too, where the default is already off', () => {
    expect(migrateLogging(undefined, undefined, DEFAULTS)).toEqual({ settings: DEFAULTS, applied: [SEND_AUTOMATICALLY_OFF], changed: true });
  });

  it('keeps other migrations and ignores what is not a list of ids', () => {
    expect(migrateLogging(undefined, ['other', 3 as unknown as string], DEFAULTS).applied).toEqual(['other', SEND_AUTOMATICALLY_OFF]);
    expect(migrateLogging(undefined, 'nonsense' as unknown as string[], DEFAULTS).applied).toEqual([SEND_AUTOMATICALLY_OFF]);
  });
});
