import { describe, expect, it } from 'vitest';
import { addDecodes, band, deliverDecodes, onSlotDecoded } from './station.svelte';

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
