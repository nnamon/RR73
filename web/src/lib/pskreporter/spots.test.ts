import { describe, expect, it } from 'vitest';
import { spotsOf } from './spots';

const SLOT = Date.UTC(2026, 9, 15, 1, 0, 15);
const d = (text: string, freq_hz = 1000, snr_db = -10.4) => ({ text, freq_hz, dt_s: 0.1, snr_db });

describe('spots from a slot', () => {
  it('name each sender once, at dial plus audio, with the grid its messages carried', () => {
    const spots = spotsOf(
      [d('CQ 9M2TRX OJ02', 1022.4), d('9V1NE JA1KXM PM95', 1418), d('JH1RRT YB0AZK RR73', 2210, -16.6), d('CQ DX VK3QRP QF22', 1846), d('VK3QRP K1ABC -12', 500)],
      SLOT,
      14_074_000,
      'FT8',
    );
    expect(spots).toEqual([
      { callsign: '9M2TRX', locator: 'OJ02', frequencyHz: 14_075_022, snrDb: -10, mode: 'FT8', time: SLOT / 1000 },
      { callsign: 'JA1KXM', locator: 'PM95', frequencyHz: 14_075_418, snrDb: -10, mode: 'FT8', time: SLOT / 1000 },
      { callsign: 'YB0AZK', locator: '', frequencyHz: 14_076_210, snrDb: -17, mode: 'FT8', time: SLOT / 1000 },
      { callsign: 'VK3QRP', locator: 'QF22', frequencyHz: 14_075_846, snrDb: -10, mode: 'FT8', time: SLOT / 1000 },
      { callsign: 'K1ABC', locator: '', frequencyHz: 14_074_500, snrDb: -10, mode: 'FT8', time: SLOT / 1000 },
    ]);
  });

  it('leave out hashed callsigns and free text, and take a later grid for a station heard twice', () => {
    const spots = spotsOf([d('K1ABC <W9XYZ> -05'), d('TNX 73 GL'), d('W9XYZ K1ABC R-05'), d('CQ K1ABC FN42')], SLOT, 7_074_000, 'FT4');
    expect(spots.map((s) => [s.callsign, s.locator, s.mode])).toEqual([['K1ABC', 'FN42', 'FT4']]);
  });

  it('take the Fox of a multi-call message only once its callsign is known', () => {
    expect(spotsOf([d('K1ABC RR73; W9XYZ <...> -08')], SLOT, 14_074_000, 'FT8')).toEqual([]);
    expect(spotsOf([d('K1ABC RR73; W9XYZ <KH1/KH7Z> -08')], SLOT, 14_074_000, 'FT8')).toEqual([]);
  });
});
