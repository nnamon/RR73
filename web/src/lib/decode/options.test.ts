import { describe, expect, it } from 'vitest';
import { contextFor, laterStages } from './options';

describe('the Decoding settings', () => {
  it('run the later stages only with Depth deep, and send the QSO context only with A priori on', () => {
    expect(laterStages({ decodeDepth: 'deep', aPriori: true })).toBe(true);
    expect(laterStages({ decodeDepth: 'fast', aPriori: true })).toBe(false);
    const ctx = { myCall: '9V1NE' };
    expect(contextFor({ decodeDepth: 'deep', aPriori: true }, ctx)).toBe(ctx);
    expect(contextFor({ decodeDepth: 'deep', aPriori: false }, ctx)).toBeUndefined();
    expect(contextFor({ decodeDepth: 'deep', aPriori: true }, null)).toBeUndefined();
  });
});
