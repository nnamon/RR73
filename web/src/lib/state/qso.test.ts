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
import { callCq, callStation, clearDecodeList, configNow, dispatch, haltTx, qso, qsoContextNow, setFrequencies, setHound, setHoundDial, setHunt, setTxEnabled } from './qso.svelte';
import { band, deliverDecodes } from './station.svelte';
import { filterCounts } from '../decode/list';
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
  it('comes from the log: FT8 and FT4 QSOs that are not deleted, by UTC day and activation', async () => {
    const { workedFrom } = await import('./qso.svelte');
    const base = { gridsquare: '', submode: '', deletedAt: null, band: '20m', start: Date.UTC(2026, 9, 13, 23, 59), activationId: null } as const;
    const qsos = [
      { ...base, call: 'JA1KXM', mode: 'FT8', gridsquare: 'PM95', activationId: 'a1' },
      { ...base, call: 'K1ABC', mode: 'MFSK', submode: 'FT4', band: '40m' },
      { ...base, call: 'VK2ESN', mode: 'SSB' },
      { ...base, call: 'ZL1TQK', mode: 'FT8', deletedAt: 1 },
    ] as never[];
    expect(workedFrom(qsos)).toEqual([
      { call: 'JA1KXM', band: '20m', mode: 'FT8', day: '20261013', grid: 'PM95', activationId: 'a1' },
      { call: 'K1ABC', band: '40m', mode: 'FT4', day: '20261013', grid: null, activationId: null },
    ]);
  });
});

describe('a priori decoding', () => {
  it('gives the decoder the operator, and the station being worked at its frequency', async () => {
    dispatch({ type: 'endQso', nowMs: Date.now() });
    await updateSettings({ callsign: '', grid: 'OJ11' });
    expect(qsoContextNow()).toBeNull();
    await updateSettings({ callsign: '9V1NE' });
    expect(qsoContextNow()).toEqual({ myCall: '9V1NE', dxCall: '', dxHz: 0 });
    const { d, slot } = heard(1234);
    callStation(d, slot);
    expect(qsoContextNow()).toEqual({ myCall: '9V1NE', dxCall: 'JA1KXM', dxHz: 1234 });
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

describe('the running activation', () => {
  it('reaches the sequencer only while Activations is on, as the log attaches it to new QSOs', async () => {
    const { configPatch } = await import('./qso.svelte');
    const { log } = await import('../log/log.svelte');
    const running: Activation = { id: 'a1', refs: [{ programme: 'POTA', ref: 'VK-0921' }], callsign: '9V1NE', operator: '9V1NE', grid: 'QF22', gridSource: 'typed', wavelogStationId: null, startedAt: 1, endedAt: null, updatedAt: 1 };
    log.activations = [running];
    settings.features.activations = false;
    expect(configPatch().activationId).toBeNull();
    settings.features.activations = true;
    expect(configPatch().activationId).toBe('a1');
    log.activations = [{ ...running, endedAt: 2 }];
    expect(configPatch().activationId).toBeNull();
    settings.features.activations = false;
    log.activations = [];
  });
});

describe('Call CQ while audio is not running', () => {
  it('is refused for its slot and stays planned no more than 2 slots ahead', () => {
    const now = Date.now();
    callCq();
    expect(qso.notice?.text).toBe('Audio off');
    // Each refusal used to plan the next slot inside the same call, slot after slot, until the
    // stack overflowed hundreds of slots ahead.
    expect(qso.st.next!.slotStartMs).toBeLessThanOrEqual(slotStart(now, 'FT8') + 30_000);
    expect(qso.st.next!.scheduled).toBe(false);
  });
});

describe('the sequencer’s notices', () => {
  it('reach the status line: a station called answers another station', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // VK2LAW calls CQ in the odd slot before 13:15:00; we call in even slots.
      const t = Date.UTC(2026, 9, 13, 13, 15, 0);
      vi.setSystemTime(t + 1000);
      callStation(decode('CQ VK2LAW QF56', -8, 1200), t - 15_000);
      expect(qso.st.phase).toBe('answering');
      // In its next slot VK2LAW answers DV5CEL.
      vi.setSystemTime(t + 30_100);
      dispatch({ type: 'slotDecoded', slotStartMs: t + 15_000, pass: 'final', decodes: [decode('DV5CEL VK2LAW -05', -8, 1200)], nowMs: Date.now() });
      expect(qso.notice).toMatchObject({ kind: 'lost', text: 'VK2LAW answered DV5CEL' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Clear decodes', () => {
  it('empties the list, its selection and the Sent rows of ended slots, and leaves the QSO as it is', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // We called VK2LAW from 13:15:00 and are sending again at 13:15:30.
      const t = Date.UTC(2026, 9, 13, 13, 15, 0);
      vi.setSystemTime(t + 1000);
      const cq = decode('CQ VK2LAW QF56', -8, 1200);
      deliverDecodes({ startUtcMs: t - 15_000, mode: 'FT8', decodes: [cq, decode('CQ JA1KXM PM95', -12, 900)], ms: 80 });
      callStation(cq, t - 15_000);
      vi.setSystemTime(t + 30_100);
      dispatch({ type: 'slotDecoded', slotStartMs: t + 15_000, pass: 'final', decodes: [decode('CQ K1ABC FN42', -3, 600)], nowMs: Date.now() });
      qso.sent = [
        { slotStartMs: t + 30_000, text: 'VK2LAW 9V1NE OJ11', freqHz: 1500 },
        { slotStartMs: t, text: 'VK2LAW 9V1NE OJ11', freqHz: 1500 },
      ];
      qso.selected = { decode: cq, slotStartMs: t - 15_000, id: `${t - 15_000}-0` };
      const st = qso.st;
      expect(st.partner?.call).toBe('VK2LAW');

      clearDecodeList(Date.now());
      expect(band.slots).toEqual([]);
      expect(filterCounts(band.slots, '9V1NE', 1500)).toEqual({ all: 0, cq: 0, new: 0, me: 0, rx: 0 });
      expect(qso.selected).toBeNull();
      // The transmission of the slot under way stays; the one before goes.
      expect(qso.sent.map((x) => x.slotStartMs)).toEqual([t + 30_000]);
      // The sequencer saw nothing: partner, plan, Hunt's CQs and ignore list are as they were.
      expect(qso.st).toBe(st);
      expect(qso.notice).toMatchObject({ kind: 'info', text: 'Decodes cleared' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Hound dial frequency', () => {
  it('is the dial the sequencer logs with Hound on, and the usual one with Hound off', async () => {
    await updateSettings({ band: '20m', mode: 'FT8', houndBands: [], houndDialHz: {} });
    setHoundDial('20m', 14_090_000);
    expect(configNow().dialHz).toBe(14_074_000);
    setHound(true);
    expect(configNow().dialHz).toBe(14_090_000);
    expect(settings.houndDialHz).toEqual({ '20m': 14_090_000 });
    setHound(false);
    expect(configNow().dialHz).toBe(14_074_000);
  });
});
