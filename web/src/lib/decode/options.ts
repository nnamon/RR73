/**
 * What Settings › FT8 and FT4 › Decoding changes in a decode: Depth fast runs the first stage only
 * (no later stages), and A priori off sends no QSO context, so the decoder tries no expected
 * replies.
 */
export interface DecodeChoices {
  decodeDepth: 'deep' | 'fast';
  aPriori: boolean;
}

/** The QSO context to send with a slot, or undefined. */
export function contextFor<T>(choices: DecodeChoices, context: T | null): T | undefined {
  return choices.aPriori && context !== null ? context : undefined;
}

/** True when a slot runs the later stages after the first. */
export function laterStages(choices: DecodeChoices): boolean {
  return choices.decodeDepth === 'deep';
}
