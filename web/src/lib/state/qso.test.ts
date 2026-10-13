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
import { slotStart } from '../clock/slots';
import { decode } from '../testing/qso-sim';
import { callCq, callStation, dispatch, haltTx, qso, setFrequencies, setHunt, setTxEnabled } from './qso.svelte';
import { settings, updateSettings } from './settings.svelte';
import type { Activation } from '../log/types';

beforeEach(async () => {
  haltTx();
  played.length = 0;
  await updateSettings({ mode: 'FT8', rxHz: 1500, txHz: 1500, holdTx: true, freqPicked: false });
  dispatch({ type: 'configure', patch: { myCall: '9V1NE', myGrid: 'OJ11', mode: 'FT8', txHz: 1500 }, nowMs: Date.now() });
});

/** A decode of JA1KXM calling CQ at `hz`, heard in the slot that just ended. */
function heard(hz: number) {
  const slot = slotStart(Date.now(), 'FT8') - 15_000;
  return { d: decode('CQ JA1KXM PM95', -8, hz), slot };
}

describe('taps that can transmit', () => {
  it('play the silent clip at once: Call CQ, Enable Tx, Hunt on, Call and double-tap', () => {
    callCq();
    expect(played).toEqual([silentClipUri()]);
    setTxEnabled(false);
    expect(played).toHaveLength(1);
    setTxEnabled(true);
    expect(played).toHaveLength(2);
    haltTx();
    setHunt(true);
    expect(played).toHaveLength(3);
    setHunt(false);
    expect(played).toHaveLength(3);
    haltTx();
    const { d, slot } = heard(1846);
    callStation(d, slot);
    expect(played).toEqual(Array(4).fill(silentClipUri()));
    // Halt plays nothing.
    haltTx();
    expect(played).toHaveLength(4);
  });
});

describe('frequencies', () => {
  it('set from the waterfall stay inside the mode limits and mark the hint used', () => {
    setFrequencies({ rxHz: 50, txHz: 3000 });
    expect(settings).toMatchObject({ rxHz: 200, txHz: 2800, freqPicked: true });
    settings.mode = 'FT4';
    setFrequencies({ txHz: 2800 });
    expect(settings.txHz).toBe(2767);
    expect(settings.rxHz).toBe(200);
  });

  it('follow the station called: Rx always, Tx only with Hold Tx off', async () => {
    let { d, slot } = heard(1846.4);
    callStation(d, slot);
    expect(qso.st.partner?.call).toBe('JA1KXM');
    expect(settings).toMatchObject({ rxHz: 1846, txHz: 1500, freqPicked: false });
    haltTx();
    await updateSettings({ holdTx: false });
    ({ d, slot } = heard(912));
    callStation({ ...d, text: 'CQ JA2XYZ PM85' }, slot);
    expect(qso.st.partner?.call).toBe('JA2XYZ');
    expect(settings).toMatchObject({ rxHz: 912, txHz: 912 });
  });
});

describe('worked before', () => {
  it('comes from the log: FT8 and FT4 QSOs that are not deleted, by UTC day', async () => {
    const { workedFrom } = await import('./qso.svelte');
    const base = { gridsquare: '', submode: '', deletedAt: null, band: '20m', start: Date.UTC(2026, 9, 13, 23, 59) } as const;
    const qsos = [
      { ...base, call: 'JA1KXM', mode: 'FT8', gridsquare: 'PM95' },
      { ...base, call: 'K1ABC', mode: 'MFSK', submode: 'FT4', band: '40m' },
      { ...base, call: 'VK2ESN', mode: 'SSB' },
      { ...base, call: 'ZL1TQK', mode: 'FT8', deletedAt: 1 },
    ] as never[];
    expect(workedFrom(qsos)).toEqual([
      { call: 'JA1KXM', band: '20m', mode: 'FT8', day: '20261013', grid: 'PM95' },
      { call: 'K1ABC', band: '40m', mode: 'FT4', day: '20261013', grid: null },
    ]);
  });
});

describe('the call on air', () => {
  it('comes from a running activation only while Activations is on', async () => {
    const { configNow } = await import('./qso.svelte');
    const { log } = await import('../log/log.svelte');
    await updateSettings({ callsign: '9V1NE', grid: 'OJ11' });
    const running: Activation = { id: 'a1', refs: [], callsign: 'VK3/9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'typed', wavelogStationId: null, startedAt: 1, endedAt: null, updatedAt: 1 };
    log.activations = [running];
    settings.features.activations = false;
    expect(configNow()).toMatchObject({ myCall: '9V1NE', myGrid: 'OJ11' });
    settings.features.activations = true;
    expect(configNow()).toMatchObject({ myCall: 'VK3/9V1NE', myGrid: 'QF22' });
    settings.features.activations = false;
    log.activations = [];
  });
});
