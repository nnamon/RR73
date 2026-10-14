import { describe, expect, it } from 'vitest';
import { queueMarks, queueTag } from './queue';
import type { Caller } from '../qso/sequencer';

const T = Date.UTC(2026, 9, 14, 13, 14, 15);
const caller = (call: string, over: Partial<Caller> = {}): Caller => ({
  call,
  grid: 'FN42',
  kind: 'grid',
  report: null,
  snrDb: -12,
  dtS: 0.2,
  freqHz: 2341,
  heardMs: T,
  seq: 0,
  dupe: false,
  isNew: true,
  distanceKm: null,
  ...over,
});

describe('queueMarks', () => {
  it('tags the queue Next, 2nd, 3rd in answering order', () => {
    const marks = queueMarks([caller('ZL1TQK'), caller('DU1XYZ', { heardMs: T - 30_000 }), caller('VK2ESN')], false);
    expect(marks).toEqual([
      { call: 'ZL1TQK', slotStartMs: T, tag: 'Next' },
      { call: 'DU1XYZ', slotStartMs: T - 30_000, tag: '2nd' },
      { call: 'VK2ESN', slotStartMs: T, tag: '3rd' },
    ]);
  });

  it('tags dupes Dupe and leaves them out of the count, unless dupes are worked', () => {
    const q = [caller('W1AW', { dupe: true }), caller('VK2ESN')];
    expect(queueMarks(q, false).map((m) => m.tag)).toEqual(['Dupe', 'Next']);
    expect(queueMarks(q, true).map((m) => m.tag)).toEqual(['Next', '2nd']);
  });
});

describe('queueTag', () => {
  const marks = queueMarks([caller('ZL1TQK'), caller('DU1XYZ', { heardMs: T - 30_000 })], false);

  it('tags a caller’s message in the slot it last called in, and no earlier one', () => {
    expect(queueTag('9V1NE ZL1TQK RF73', T, marks)).toBe('Next');
    expect(queueTag('9V1NE ZL1TQK RF73', T - 30_000, marks)).toBeNull();
    expect(queueTag('9V1NE DU1XYZ PK04', T - 30_000, marks)).toBe('2nd');
  });

  it('tags nothing else, and nothing with no queue', () => {
    expect(queueTag('9V1NE JA1KXM PM95', T, marks)).toBeNull();
    expect(queueTag('CQ ZL1TQK RF73', T, [])).toBeNull();
  });
});
