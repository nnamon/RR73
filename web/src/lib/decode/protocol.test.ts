import { describe, expect, it } from 'vitest';
import { parseDecodes } from './protocol';

describe('parseDecodes', () => {
  it('reads the decoder output', () => {
    const json = '[{"text":"CQ 9M2TRX OJ02","freq_hz":1022.4,"dt_s":0.11,"snr_db":-10.2},{"text":"9V1NE JA1KXM PM95","freq_hz":1418,"dt_s":0.2,"snr_db":-12}]';
    expect(parseDecodes(json)).toEqual([
      { text: 'CQ 9M2TRX OJ02', freq_hz: 1022.4, dt_s: 0.11, snr_db: -10.2 },
      { text: '9V1NE JA1KXM PM95', freq_hz: 1418, dt_s: 0.2, snr_db: -12 },
    ]);
  });

  it('ignores extra fields and drops malformed entries', () => {
    const json = JSON.stringify([
      { text: 'CQ K1ABC FN42', freq_hz: 500, dt_s: 0, snr_db: 1, pass: 2 },
      { text: '', freq_hz: 1, dt_s: 0, snr_db: 0 },
      { text: 'A B C', freq_hz: 'x', dt_s: 0, snr_db: 0 },
      { text: 'A B C', freq_hz: 1, dt_s: null, snr_db: 0 },
      null,
      7,
    ]);
    expect(parseDecodes(json)).toEqual([{ text: 'CQ K1ABC FN42', freq_hz: 500, dt_s: 0, snr_db: 1 }]);
  });

  it('gives nothing for output that is not an array', () => {
    expect(parseDecodes('{}')).toEqual([]);
    expect(parseDecodes('not json')).toEqual([]);
    expect(parseDecodes('[]')).toEqual([]);
  });
});
