import { describe, expect, it } from 'vitest';
import { addDecodes, band, clearDecodes, deliverDecodes, markTransmitted, noteHeardBack, onSlotDecoded, recent, timingSnapshot, tx } from './station.svelte';

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
