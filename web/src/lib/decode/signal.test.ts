import { describe, expect, it } from 'vitest';
import { SIGNAL_SLOTS, signalHistory } from './signal';
import type { SlotDecodes } from './list';

const T = Date.UTC(2026, 9, 15, 13, 0, 0);
const d = (text: string, snr_db: number) => ({ text, freq_hz: 1500, dt_s: 0.1, snr_db });
const slot = (i: number, decodes: ReturnType<typeof d>[], mode: 'FT8' | 'FT4' = 'FT8'): SlotDecodes => ({ startUtcMs: T + i * (mode === 'FT8' ? 15_000 : 7_500), mode, decodes, ms: 300 });

describe('signalHistory', () => {
  it('gives the last 8 slots of the station’s parity back from its latest decode, with gaps', () => {
    // VK3QRP sends in the even slots 0 to 18; slot 6 is missing and slot 10 lacks it.
    const slots = [0, 2, 4, 8, 10, 12, 14, 16, 18].map((i) => slot(i, i === 10 ? [d('CQ JA1KXM PM95', -3)] : [d(`9V1NE VK3QRP R-${10 + i}`, -i)]));
    slots.push(slot(19, [d('CQ VK3QRP QF22', -1)].slice(0, 0)));
    const h = signalHistory(slots, 'VK3QRP', 'FT8');
    expect(h).toHaveLength(SIGNAL_SLOTS);
    expect(h.map((p) => (p.slotStartMs - T) / 15_000)).toEqual([4, 6, 8, 10, 12, 14, 16, 18]);
    expect(h.map((p) => p.snrDb)).toEqual([-4, null, -8, null, -12, -14, -16, -18]);
  });

  it('matches by base callsign, takes the strongest of a slot, and ignores other modes', () => {
    const slots = [slot(0, [d('CQ VK3/9V1AB QF22', -15), d('JA1KXM 9V1AB R-02', -9)]), slot(1, [d('CQ 9V1AB OJ11', 0)], 'FT4')];
    const h = signalHistory(slots, '9V1AB', 'FT8');
    expect(h.at(-1)).toEqual({ slotStartMs: T, snrDb: -9 });
    expect(h.slice(0, -1).every((p) => p.snrDb === null)).toBe(true);
  });

  it('is empty for a station not heard, or heard only as the one called', () => {
    expect(signalHistory([slot(0, [d('VK3QRP 9V1NE -10', -5)])], 'VK3QRP', 'FT8')).toEqual([]);
    expect(signalHistory([], 'VK3QRP', 'FT8')).toEqual([]);
  });
});
