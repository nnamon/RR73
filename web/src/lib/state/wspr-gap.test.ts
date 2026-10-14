// The beacon's gaps through the runtime, with a stand-in for the transmit scheduler that reports
// as the real one does: started, then ended, complete or cut short by Halt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxReport, TxRequest } from '../tx/scheduler';

const { fake } = vi.hoisted(() => ({ fake: { scheduled: [] as TxRequest[], report: null as ((r: TxReport) => void) | null } }));

vi.mock('../audio/unlock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../audio/unlock')>();
  return { ...real, playClip: () => 0 };
});

vi.mock('../tx/scheduler', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tx/scheduler')>();
  class StandIn {
    private readonly report: (r: TxReport) => void;
    constructor(opts: { report: (r: TxReport) => void }) {
      this.report = opts.report;
    }
    schedule(req: TxRequest) {
      if (req.mode === 'WSPR') {
        fake.scheduled.push(req);
        fake.report = this.report;
      }
      return Promise.resolve();
    }
    cancel() {}
    halt() {}
  }
  return { ...real, TxScheduler: StandIn };
});

import { haltWspr, resetWspr, setBeacon, tick, transmitNextSlot, wspr } from './wspr.svelte';
import { WSPR_DEFAULTS, updateSettings } from './settings.svelte';
import { audio } from './station.svelte';

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 14, h, m, s);
const TEXT = '9V1NE OJ11 37';
const random = Math.random;

/** The scheduled transmission in `slot` goes out from 1 s in; `endS` s in it ends, cut short unless it ran 110.6 s. */
function play(slot: number, endS = 111.6, halt = false) {
  expect(fake.scheduled.at(-1)?.slotStartMs).toBe(slot);
  vi.setSystemTime(slot + 1000);
  fake.report!({ type: 'started', slotStartMs: slot, text: TEXT, startUtcMs: slot + 1000, lateS: 0, skippedS: 0 });
  vi.setSystemTime(slot + endS * 1000);
  if (halt) haltWspr();
  fake.report!({ type: 'ended', slotStartMs: slot, text: TEXT, complete: !halt });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at(14, 5, 0));
  resetWspr();
  fake.scheduled.length = 0;
  audio.status = 'running';
  await updateSettings({ callsign: '9V1NE', grid: 'OJ11vi', band: '20m', mode: 'WSPR', wspr: { ...WSPR_DEFAULTS, txPct: 20 } });
});

afterEach(() => {
  Math.random = random;
  vi.useRealTimers();
});

describe('the beacon at 20%', () => {
  it('keeps a receive slot after a transmission Halt cut short, when Beacon turns on again', () => {
    Math.random = () => 0;
    setBeacon(true, at(14, 5, 28));
    expect(wspr.next?.slotStartMs).toBe(at(14, 6));
    tick(at(14, 5, 53));
    play(at(14, 6), 30, true);
    expect(wspr.beacon.on).toBe(false);
    expect(wspr.sent[0]).toMatchObject({ slotStartMs: at(14, 6), complete: false });
    // 14:08 would follow the cut transmission at once.
    setBeacon(true, at(14, 6, 40));
    expect(wspr.next?.slotStartMs).toBe(at(14, 10));
  });

  it('leaves a receive slot after each transmission at the lowest draw', () => {
    Math.random = () => 0;
    setBeacon(true, at(14, 5, 28));
    tick(at(14, 5, 53));
    play(at(14, 6));
    expect(wspr.next?.slotStartMs).toBe(at(14, 10));
  });

  it('draws its slot again when Transmit next slot leaves it closer than a receive slot', () => {
    Math.random = () => 0.5;
    setBeacon(true, at(14, 5, 28));
    expect(wspr.next?.slotStartMs).toBe(at(14, 12));
    transmitNextSlot(at(14, 9, 30));
    expect(wspr.next).toEqual({ slotStartMs: at(14, 10), once: true });
    tick(at(14, 9, 53));
    play(at(14, 10));
    // 14:12 would follow at once; a gap of 5 from 14:10.
    expect(wspr.next).toEqual({ slotStartMs: at(14, 20), once: false });
  });

  it('waits a slot with Transmit next slot tapped while the beacon is on air', () => {
    Math.random = () => 0;
    setBeacon(true, at(14, 5, 28));
    tick(at(14, 5, 53));
    expect(fake.scheduled.at(-1)?.slotStartMs).toBe(at(14, 6));
    // On air in 14:06; a tap at 14:06:30 would take 14:08, right after it.
    vi.setSystemTime(at(14, 6, 1));
    fake.report!({ type: 'started', slotStartMs: at(14, 6), text: TEXT, startUtcMs: at(14, 6, 1), lateS: 0, skippedS: 0 });
    transmitNextSlot(at(14, 6, 30));
    // The beacon draws a gap of 5 after 14:06: 14:16.
    Math.random = () => 0.5;
    vi.setSystemTime(at(14, 7, 51));
    fake.report!({ type: 'ended', slotStartMs: at(14, 6), text: TEXT, complete: true });
    expect(wspr.next).toEqual({ slotStartMs: at(14, 10), once: true });
  });

  it('waits a slot with Transmit next slot right after a transmission Halt cut short', () => {
    Math.random = () => 0;
    setBeacon(true, at(14, 5, 28));
    tick(at(14, 5, 53));
    play(at(14, 6), 30, true);
    transmitNextSlot(at(14, 6, 40));
    expect(wspr.next).toEqual({ slotStartMs: at(14, 10), once: true });
  });
});
