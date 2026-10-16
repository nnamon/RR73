import { describe, expect, it } from 'vitest';
import { addDecodes, band, clearDecodes, deliverDecodes, deliverEarly, markTransmitted, mergeDecodes, noteHeardBack, onSlotDecoded, recent, runningOutput, timingSnapshot, tx } from './station.svelte';
import { AudioClockMapper } from '../clock/mapping';

const d = (text: string, freq_hz = 1000) => ({ text, freq_hz, dt_s: 0.1, snr_db: -12 });

describe('later decoder stages', () => {
  it('add their decodes to the slot in the list, and to the sequencer as a later pass', () => {
    const heard: string[][] = [];
    const off = onSlotDecoded((_, decodes, pass) => heard.push([pass, ...decodes.map((x) => x.text)]));
    const start = Date.UTC(2026, 9, 14, 12, 0, 15);
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [d('CQ K1ABC FN42')], ms: 90 });
    addDecodes(start, [d('CQ K1ABC FN42', 1003), d('CQ 9V1NE OJ11', 1800)]);
    // A slot that is not in the list (gone, or never delivered) takes nothing.
    addDecodes(start - 15_000, [d('CQ JA1KXM PM95')]);
    off();
    const slot = band.slots.find((s) => s.startUtcMs === start);
    expect(slot?.decodes.map((x) => x.text)).toEqual(['CQ K1ABC FN42', 'CQ 9V1NE OJ11']);
    expect(slot?.ms).toBe(90);
    expect(band.slots.some((s) => s.startUtcMs === start - 15_000)).toBe(false);
    expect(heard).toEqual([
      ['final', 'CQ K1ABC FN42'],
      ['late', 'CQ 9V1NE OJ11'],
    ]);
  });
});

describe('the early pass', () => {
  const e = (text: string, freq_hz: number, snr_db: number) => ({ text, freq_hz, dt_s: 0.1, snr_db });

  it('lists a slot before it ends; the full slot keeps those rows in place and adds its own after them', () => {
    clearDecodes();
    const heard: string[][] = [];
    const off = onSlotDecoded((_, decodes, pass) => heard.push([pass, ...decodes.map((x) => x.text)]));
    const start = Date.UTC(2026, 9, 15, 9, 0, 0);
    deliverEarly({ startUtcMs: start, mode: 'FT8', decodes: [e('CQ K1ABC FN42', 1000, -12), e('CQ JA1KXM PM95', 1500, -20)], ms: 60, early: true });
    expect(band.slots[0].decodes.map((x) => x.text)).toEqual(['CQ K1ABC FN42', 'CQ JA1KXM PM95']);
    expect(band.slots[0].early).toBe(true);
    // The full slot: a new message first in its order, K1ABC again with a better SNR, JA1KXM missed.
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [e('CQ VK2LAW QF56', 800, -3), e('CQ K1ABC FN42', 1001, -11)], ms: 90 });
    // An early pass that comes after the full slot changes nothing.
    deliverEarly({ startUtcMs: start, mode: 'FT8', decodes: [e('CQ ZL1TQK RF70', 600, -9)], ms: 60, early: true });
    off();
    const slot = band.slots[0];
    expect(slot.decodes).toEqual([e('CQ K1ABC FN42', 1001, -11), e('CQ JA1KXM PM95', 1500, -20), e('CQ VK2LAW QF56', 800, -3)]);
    expect(slot.early).toBeUndefined();
    expect(slot.ms).toBe(90);
    expect(heard).toEqual([
      ['early', 'CQ K1ABC FN42', 'CQ JA1KXM PM95'],
      ['final', 'CQ K1ABC FN42', 'CQ JA1KXM PM95', 'CQ VK2LAW QF56'],
    ]);
    clearDecodes();
  });

  it('cleared after the early pass: the full slot reaches the sequencer and stays out of the list', () => {
    clearDecodes();
    const heard: string[][] = [];
    const off = onSlotDecoded((_, decodes, pass) => heard.push([pass, ...decodes.map((x) => x.text)]));
    const start = Date.UTC(2026, 9, 15, 9, 0, 30);
    deliverEarly({ startUtcMs: start, mode: 'FT8', decodes: [e('CQ K1ABC FN42', 1000, -12)], ms: 60, early: true });
    clearDecodes();
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [e('9V1NE VK2LAW -12', 1800, -14)], ms: 90 });
    addDecodes(start, [e('CQ JA1KXM PM95', 1500, -20)]);
    off();
    expect(band.slots).toEqual([]);
    expect(heard).toEqual([
      ['early', 'CQ K1ABC FN42'],
      ['final', 'CQ K1ABC FN42', '9V1NE VK2LAW -12'],
      ['late', 'CQ JA1KXM PM95'],
    ]);
  });

  it('a slot RR73 transmits in has none', () => {
    clearDecodes();
    const start = Date.UTC(2026, 9, 15, 9, 1, 0);
    markTransmitted(start + 500, start + 501, 'FT8');
    deliverEarly({ startUtcMs: start, mode: 'FT8', decodes: [e('CQ K1ABC FN42', 1000, -12)], ms: 60, early: true });
    expect(band.slots).toEqual([]);
  });

  it('merges by message text', () => {
    expect(mergeDecodes([], [e('A', 1, 1)])).toEqual([e('A', 1, 1)]);
    expect(mergeDecodes([e('A', 1, 1)], [])).toEqual([e('A', 1, 1)]);
    expect(mergeDecodes([e('A', 1, 1), e('B', 2, 2)], [e('C', 3, 3), e('B', 4, 4)])).toEqual([e('A', 1, 1), e('B', 4, 4), e('C', 3, 3)]);
  });
});

describe('band activity', () => {
  it('keeps the slots of the last hour', () => {
    clearDecodes();
    const start = Date.UTC(2026, 9, 14, 15, 0, 0);
    // 250 FT8 slots: 62.5 minutes.
    for (let i = 0; i < 250; i++) deliverDecodes({ startUtcMs: start + i * 15_000, mode: 'FT8', decodes: [d(`CQ K1AB${i % 10} FN42`)], ms: 80 });
    expect(band.slots).toHaveLength(240);
    expect(band.slots[0].startUtcMs).toBe(start + 249 * 15_000);
    expect(band.slots.at(-1)!.startUtcMs).toBe(start + 10 * 15_000);
    clearDecodes();
  });
});

describe('Clear decodes', () => {
  it('empties the list and keeps saved slots, transmitted slots and Your Tx heard back', () => {
    const start = Date.UTC(2026, 9, 14, 13, 0, 0);
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [d('CQ K1ABC FN42')], ms: 80 });
    deliverDecodes({ startUtcMs: start + 15_000, mode: 'FT8', decodes: [d('CQ JA1KXM PM95')], ms: 80 });
    markTransmitted(start + 30_000, start + 30_001, 'FT8', { text: 'CQ 9V1NE OJ11', f0Hz: 1500 });
    noteHeardBack(start + 30_000, { text: 'CQ 9V1NE OJ11', f0Hz: 1500 }, [d('CQ 9V1NE OJ11', 1500)]);
    recent.slots = [{ startUtcMs: start, mode: 'FT8', filled: 1, lateStart: false, gap: false }];
    const sentSlots = [...tx.slots];
    const heardBack = timingSnapshot().heardBack;

    clearDecodes();
    expect(band.slots).toEqual([]);
    expect(recent.slots.map((s) => s.startUtcMs)).toEqual([start]);
    expect(tx.slots).toEqual(sentSlots);
    expect(timingSnapshot().heardBack).toEqual(heardBack);

    // A slot decoded after the clear appears as usual.
    deliverDecodes({ startUtcMs: start + 45_000, mode: 'FT8', decodes: [d('CQ VK2LAW QF56')], ms: 80 });
    expect(band.slots.map((s) => s.decodes.map((x) => x.text))).toEqual([['CQ VK2LAW QF56']]);
  });

  it('passes later stages of the newest slot cleared to the sequencer, and keeps them out of the list', () => {
    const heard: string[][] = [];
    const off = onSlotDecoded((at, decodes, pass) => heard.push([String(at), pass, ...decodes.map((x) => x.text)]));
    const start = Date.UTC(2026, 9, 14, 14, 0, 0);
    deliverDecodes({ startUtcMs: start, mode: 'FT8', decodes: [d('CQ K1ABC FN42')], ms: 80 });
    clearDecodes();
    addDecodes(start, [d('CQ K1ABC FN42'), d('9V1NE VK2LAW -12', 1800)]);
    addDecodes(start, [d('9V1NE VK2LAW -12', 1800)]);
    off();
    expect(band.slots).toEqual([]);
    expect(heard).toEqual([
      [String(start), 'final', 'CQ K1ABC FN42'],
      [String(start), 'late', '9V1NE VK2LAW -12'],
    ]);
  });
});

describe('the transmit output', () => {
  it('is the running context and its mapper before the mapper has its first observation', () => {
    // A CQ tapped right after Start audio: the scheduler times its wait by the page's clock and
    // needs the mapping only at the pre-roll. Refused here, the CQ went out a cycle later.
    const ctx = {} as AudioContext;
    const mapper = new AudioClockMapper();
    expect(mapper.ready).toBe(false);
    expect(runningOutput(ctx, mapper, 'running')).toEqual({ ctx, mapper });
    expect(runningOutput(ctx, mapper, 'off')).toBeNull();
    expect(runningOutput(null, mapper, 'running')).toBeNull();
  });
});
