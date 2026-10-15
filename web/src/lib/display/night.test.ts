import { describe, expect, it } from 'vitest';
import { NIGHT_HEARD, ftNight, heardIn, wsprNight } from './night';
import { nightDue } from '../state/night.svelte';

const T = Date.UTC(2026, 9, 15, 21, 4, 31);
const d = (text: string, snr_db: number) => ({ text, freq_hz: 1500, dt_s: 0.1, snr_db });

describe('the night display', () => {
  it('lists the newest slot’s stations once each, strongest first, without me or hashed calls', () => {
    const decodes = [d('CQ JA1KXM PM95', -12), d('9V1NE VK2LAW QF56', -3), d('JA1KXM K1ABC -10', -8), d('CQ <...> PM95', 0), d('K1ABC 9V1NE R-08', 5), d('CQ VK3/JA1KXM QF22', -2)];
    // JA1KXM counts once, as VK3/JA1KXM, its stronger decode.
    expect(heardIn(decodes, '9V1NE')).toEqual(['VK3/JA1KXM −02', 'VK2LAW −03', 'K1ABC −08']);
    const many = Array.from({ length: 10 }, (_, i) => d(`CQ K${i}AA FN42`, -i));
    expect(heardIn(many, '9V1NE')).toHaveLength(NIGHT_HEARD);
  });

  it('shows the clock, the transmission on air or next, and when the stations were heard', () => {
    const slot = { startUtcMs: T - 16_000, decodes: [d('CQ JA1KXM PM95', -12)] };
    expect(ftNight(T, { next: { text: 'CQ 9V1NE OJ11', slotStartMs: T + 14_000 }, onAir: null }, slot, '9V1NE')).toEqual({
      clock: '21:04:31',
      tx: 'Next at 21:04:45: CQ 9V1NE OJ11',
      onAir: false,
      heard: ['JA1KXM −12'],
      heardAt: '21:04:15',
    });
    expect(ftNight(T, { next: null, onAir: { text: 'JA1KXM 9V1NE -12' } }, null, '9V1NE')).toMatchObject({ tx: 'On air: JA1KXM 9V1NE -12', onAir: true, heard: [], heardAt: null });
    expect(ftNight(T, { next: null, onAir: null }, null, '9V1NE').tx).toBeNull();
  });

  it('shows the WSPR beacon’s next slot and the newest spots', () => {
    const slot = { startUtcMs: T - 120_000, spots: [{ call: 'K1ABC', snrDb: -22 }, { call: null, snrDb: -10 }, { call: 'VK2LAW', snrDb: -15 }] };
    expect(wsprNight(T, { nextSlotMs: T + 89_000, onAir: false }, slot)).toMatchObject({ tx: 'Beacon at 21:06:00', heard: ['VK2LAW −15', 'K1ABC −22'] });
    expect(wsprNight(T, { nextSlotMs: null, onAir: true }, null)).toMatchObject({ tx: 'On air: beacon', onAir: true });
  });

  it('comes on by itself after the idle time, in Operate only, never when off', () => {
    expect(nightDue(T, T - 5 * 60_000, 5, true)).toBe(true);
    expect(nightDue(T, T - 4 * 60_000, 5, true)).toBe(false);
    expect(nightDue(T, T - 60 * 60_000, 5, false)).toBe(false);
    expect(nightDue(T, T - 60 * 60_000, 0, true)).toBe(false);
  });
});
