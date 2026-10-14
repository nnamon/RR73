import { beforeEach, describe, expect, it, vi } from 'vitest';

const { played } = vi.hoisted(() => ({ played: [] as string[] }));

vi.mock('../audio/unlock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/unlock')>();
  return {
    ...real,
    playClip: (uri: string) => {
      played.push(uri);
      return 0;
    },
  };
});

import { silentClipUri } from '../audio/unlock';
import { addSlot, clearSpots, haltWspr, nextText, resetWspr, setBeacon, setPowerDbm, setTxPct, stepSort, stepStopAfter, tick, transmitNextSlot, wspr } from './wspr.svelte';
import { WSPR_DEFAULTS, settings, updateSettings } from './settings.svelte';
import { audio } from './station.svelte';

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);

beforeEach(async () => {
  resetWspr();
  played.length = 0;
  audio.status = 'running';
  await updateSettings({ callsign: '9V1NE', grid: 'OJ11vi', band: '20m', mode: 'WSPR', wspr: { ...WSPR_DEFAULTS, txPct: 100 } });
});

describe('the beacon', () => {
  it('plays the silent clip inside the tap, and takes the next slot at least 10 s away', () => {
    setBeacon(true, at(14, 5, 28));
    expect(played).toEqual([silentClipUri()]);
    expect(wspr.beacon).toEqual({ on: true, startedAtMs: at(14, 5, 28), stopsAtMs: at(15, 5, 28) });
    expect(wspr.next).toEqual({ slotStartMs: at(14, 6), once: false });
    resetWspr();
    setBeacon(true, at(14, 5, 55));
    expect(wspr.next).toEqual({ slotStartMs: at(14, 8), once: false });
  });

  it('stays on when no decoder could load to check the callsign', async () => {
    // Under vitest there is no Worker, so the decoder is the null decoder and packing fails for any text.
    setBeacon(true, at(14, 5, 28));
    await new Promise((r) => setTimeout(r, 10));
    expect(wspr.beacon.on).toBe(true);
    expect(wspr.notice).toBeNull();
  });

  it('stays off without running audio or without a callsign and grid, and says why', async () => {
    audio.status = 'off';
    setBeacon(true, at(14, 5, 28));
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.notice?.text).toBe('Audio off');
    audio.status = 'running';
    await updateSettings({ grid: '' });
    setBeacon(true, at(14, 5, 29));
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.notice?.text).toBe('Set callsign and grid in Settings');
  });

  it('turns off after Stop beacon after, counted from Beacon on, with a notice', () => {
    setBeacon(true, at(14, 5, 28));
    tick(at(14, 5, 40));
    expect(wspr.beacon.on).toBe(true);
    tick(at(15, 5, 28));
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.next).toBeNull();
    expect(wspr.notice?.text).toBe('Beacon stopped after 1 h');
  });

  it('never stops by itself with Stop beacon after Off', async () => {
    await updateSettings({ wspr: { ...settings.wspr, stopAfterMin: 0 } });
    setBeacon(true, at(14, 5, 28));
    expect(wspr.beacon.stopsAtMs).toBeNull();
    tick(at(14, 5, 40));
    expect(wspr.beacon.on).toBe(true);
  });

  it('applies a new Stop beacon after to a running beacon, from when it turned on', () => {
    setBeacon(true, at(14, 5, 28));
    stepStopAfter(at(14, 5, 40));
    expect(settings.wspr.stopAfterMin).toBe(120);
    expect(wspr.beacon.stopsAtMs).toBe(at(16, 5, 28));
    expect(wspr.notice?.text).toBe('Stop beacon after 2 h');
  });

  it('draws the next slot again when the percentage changes', () => {
    const random = Math.random;
    try {
      Math.random = () => 0.5;
      setBeacon(true, at(14, 5, 28));
      expect(wspr.next?.slotStartMs).toBe(at(14, 6));
      // At 20%, 0.5 draws x = 3: a gap of 5 slots, the shortest (2) landing on the first slot.
      setTxPct(20, at(14, 5, 30));
      expect(settings.wspr.txPct).toBe(20);
      expect(wspr.next?.slotStartMs).toBe(at(14, 12));
    } finally {
      Math.random = random;
    }
  });

  it('sends a new power from the next message on, and says so; the beacon keeps its slot', () => {
    setBeacon(true, at(14, 5, 28));
    expect(nextText()).toBe('9V1NE OJ11 37');
    setPowerDbm(27, at(14, 5, 30));
    expect(settings.wspr.powerDbm).toBe(27);
    expect(nextText()).toBe('9V1NE OJ11 27');
    expect(wspr.notice?.text).toBe('Power set to 27 dBm');
    expect(wspr.next?.slotStartMs).toBe(at(14, 6));
  });

  it('sends once in the next slot with Transmit next slot, the beacon off', () => {
    transmitNextSlot(at(14, 5, 28));
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.next).toEqual({ slotStartMs: at(14, 6), once: true });
  });

  it('stops everything with Halt', () => {
    setBeacon(true, at(14, 5, 28));
    transmitNextSlot(at(14, 5, 29));
    haltWspr();
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.next).toBeNull();
  });

  it('turns off when it cannot transmit when its slot comes', async () => {
    setBeacon(true, at(14, 5, 28));
    // 8 s before the slot the transmission goes to the scheduler, which finds no audio output.
    tick(at(14, 5, 53));
    await vi.waitFor(() => expect(wspr.beacon.on).toBe(false));
    expect(wspr.next).toBeNull();
  });
});

describe('spots', () => {
  it('reach the list as one slot, with distance from the station grid', () => {
    addSlot({ startUtcMs: at(14, 2), ms: 400, decodes: [{ text: 'ZL2BRG RE78 23', freq_hz: 1563, dt_s: 0.2, drift_hz_per_s: 0, snr_db: -23 }] });
    expect(wspr.slots).toHaveLength(1);
    const [s] = wspr.slots[0].spots;
    expect(s).toMatchObject({ call: 'ZL2BRG', grid: 'RE78', powerDbm: 23, freqHz: 14_095_600 + 1563 });
    expect(Math.round(s.km!)).toBe(8558);
    expect(wspr.slots[0]).toMatchObject({ band: '20m', dialHz: 14_095_600 });
  });

  it('give a Type 2 spot the grid its station sent in a Type 3 message', () => {
    addSlot({ startUtcMs: at(14, 2), ms: 400, decodes: [{ text: '<PJ4/K1ABC> FK52UD 33', freq_hz: 1500, dt_s: 0, drift_hz_per_s: 0, snr_db: -20 }] });
    addSlot({ startUtcMs: at(14, 4), ms: 400, decodes: [{ text: 'PJ4/K1ABC 33', freq_hz: 1500, dt_s: 0, drift_hz_per_s: 0, snr_db: -20 }] });
    expect(wspr.slots[0].spots[0]).toMatchObject({ call: 'PJ4/K1ABC', grid: 'FK52ud', gridHeard: true });
  });

  it('keep 2 hours of slots, newest first', () => {
    for (let i = 0; i < 70; i++) addSlot({ startUtcMs: at(12, 0) + i * 120_000, ms: 0, decodes: [] });
    expect(wspr.slots).toHaveLength(60);
    expect(wspr.slots[0].startUtcMs).toBe(at(12, 0) + 69 * 120_000);
  });

  it('clear from the ••• menu with their selection and past Sent rows; the beacon goes on', () => {
    setBeacon(true, at(14, 5, 28));
    addSlot({ startUtcMs: at(14, 2), ms: 400, decodes: [{ text: '<PJ4/K1ABC> FK52UD 33', freq_hz: 1500, dt_s: 0, drift_hz_per_s: 0, snr_db: -20 }] });
    wspr.sent = [
      { slotStartMs: at(14, 4), text: '9V1NE OJ11 37', freqHz: 1500, complete: true },
      { slotStartMs: at(14, 0), text: '9V1NE OJ11 37', freqHz: 1500, complete: true },
    ];
    wspr.selected = wspr.slots[0].spots[0].id;
    const next = wspr.next;
    clearSpots(at(14, 5, 30));
    expect(wspr.slots).toEqual([]);
    expect(wspr.selected).toBeNull();
    // The transmission of the slot under way stays.
    expect(wspr.sent.map((x) => x.slotStartMs)).toEqual([at(14, 4)]);
    expect(wspr.beacon.on).toBe(true);
    expect(wspr.next).toEqual(next);
    expect(wspr.notice?.text).toBe('Spots cleared');
    // Spots after the clear list as usual, with the grids heard before it.
    addSlot({ startUtcMs: at(14, 6), ms: 400, decodes: [{ text: 'PJ4/K1ABC 33', freq_hz: 1500, dt_s: 0, drift_hz_per_s: 0, snr_db: -20 }] });
    expect(wspr.slots).toHaveLength(1);
    expect(wspr.slots[0].spots[0]).toMatchObject({ call: 'PJ4/K1ABC', grid: 'FK52ud' });
  });

  it('change order from the ••• menu: distance, SNR, callsign, then distance', () => {
    expect(settings.wspr.sort).toBe('distance');
    stepSort();
    expect(settings.wspr.sort).toBe('snr');
    expect(wspr.notice?.text).toBe('Spots sorted by SNR');
    stepSort();
    expect(settings.wspr.sort).toBe('call');
    stepSort();
    expect(settings.wspr.sort).toBe('distance');
  });
});
