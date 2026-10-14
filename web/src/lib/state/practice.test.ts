import { describe, expect, it } from 'vitest';
import { PRACTICE_DEFAULTS, practice, txLevel, validatePractice } from './practice.svelte';

describe('practice switches', () => {
  it('start off, with Tx audio playing on a band of the usual size', () => {
    expect(PRACTICE_DEFAULTS).toEqual({ on: false, playTx: true, crowded: false, scenario: 'random' });
    expect(validatePractice(undefined)).toEqual(PRACTICE_DEFAULTS);
  });

  it('keep only stored values of the right type', () => {
    expect(validatePractice({ on: true, playTx: 'no', crowded: true, scenario: 'cq-pileup' })).toEqual({ on: true, playTx: true, crowded: true, scenario: 'cq-pileup' });
    expect(validatePractice({ scenario: 'nonsense' }).scenario).toBe('random');
  });

  it('silence Tx only while practice is on with Play Tx audio off', () => {
    Object.assign(practice, { on: true, playTx: false });
    expect(txLevel(0.5)).toBe(0);
    Object.assign(practice, { on: false, playTx: false });
    expect(txLevel(0.5)).toBe(0.5);
    Object.assign(practice, { on: true, playTx: true });
    expect(txLevel(0.5)).toBe(0.5);
    Object.assign(practice, PRACTICE_DEFAULTS);
  });
});
