import { describe, expect, it } from 'vitest';
import { placeCalls, waterfallCalls, type Placement, type WaterfallCall } from './calls';
import { rowFacts, type SlotDecodes } from '../decode/list';
import { defaultHighlights, highlightDecode } from '../decode/highlight';
import { buildLogIndex } from '../log/worked';
import { xOfHz } from './pick';

const T = Date.UTC(2026, 9, 15, 7, 0, 0);
const d = (text: string, freq_hz: number, snr_db = -10) => ({ text, freq_hz, dt_s: 0.1, snr_db });

describe('waterfallCalls', () => {
  // 9M2TRX is in the log on 20m FT8: its CQ takes the CQ colour and no new-call colour.
  const index = buildLogIndex([{ call: '9M2TRX', gridsquare: 'OJ02', band: '20m', mode: 'FT8', submode: '' }]);
  const entries = defaultHighlights();
  const facts = rowFacts('9V1NE', (dec, sent) => highlightDecode({ text: dec.text, sent }, '9V1NE', index, { band: '20m', mode: 'FT8' }, entries));
  const slot: SlotDecodes = {
    startUtcMs: T,
    mode: 'FT8',
    ms: 300,
    decodes: [d('JH1RRT YB0AZK -12', 400, -3), d('CQ 9M2TRX OJ02', 900, -15), d('9V1NE JA1KXM PM95', 1200, -20), d('CQ K1ABC FN42', 1500, -18), d('CQ <...> PM95', 1800), d('TNX 73 GL', 2000), d('JA1KXM 9V1NE R-12', 2100)],
  };

  it('labels each sender, messages to me first, then the decode colours in order, then CQs, then the strongest', () => {
    const calls = waterfallCalls([slot], facts, '9V1NE', entries);
    expect(calls.map((c) => c.text)).toEqual(['JA1KXM', 'K1ABC', '9M2TRX', 'YB0AZK']);
    expect(calls[0]).toMatchObject({ you: true, hz: 1200, slotStartMs: T });
    // K1ABC is in a new grid: the new-grid colour, which ranks above CQ.
    expect(calls[1].colour).toBe(entries.find((e) => e.id === 'newGrid')!.colour);
    expect(calls[2].colour).toBe(entries.find((e) => e.id === 'cq')!.colour);
    expect(calls[3].colour).toBeNull();
  });

  it('leaves out hashed calls, messages with no sender and my own call', () => {
    const texts = waterfallCalls([slot], facts, '9V1NE', entries).map((c) => c.text);
    expect(texts).not.toContain('<...>');
    expect(texts).not.toContain('9V1NE');
    expect(texts).toHaveLength(4);
  });
});

describe('placeCalls', () => {
  const call = (text: string, hz: number, slotStartMs = T): WaterfallCall => ({ slotStartMs, hz, text, colour: null, you: false });
  // 393 px across 0 to 3000 Hz; one slot line at y 100, 40 px slots; 6 px characters with 4 px padding.
  const base: Placement = { lines: [{ utcMs: T, y: 100 }], slotPx: 40, width: 393, bottom: 200, charPx: 6, padPx: 4, timeRight: 54, xOf: (hz) => xOfHz(hz, 'FT8') };

  it('puts a label over its signal in the row above the slot line', () => {
    expect(placeCalls([call('K1ABC', 1500)], base)).toEqual([{ ...call('K1ABC', 1500), key: `${T}-K1ABC-1500`, x: (1500 / 3000) * 393, top: 86 }]);
  });

  it('moves a label that would overlap to the row above, and leaves out one with no room', () => {
    const placed = placeCalls([call('K1ABC', 1500), call('JA1KXM', 1520), call('VK2LAW', 1540)], base);
    expect(placed.map((p) => [p.text, p.top])).toEqual([
      ['K1ABC', 86],
      ['JA1KXM', 72],
    ]);
  });

  it('keeps the time label clear in the first row, and labels near the right edge inside the picture', () => {
    const placed = placeCalls([call('K1ABC', 100), call('JA1KXM', 2990)], base);
    expect(placed[0].top).toBe(72);
    expect(placed[1].x + 6 * 6 + 4).toBeLessThanOrEqual(393);
  });

  it('takes one row in a short slot and none off the top of the picture', () => {
    expect(placeCalls([call('K1ABC', 1500), call('JA1KXM', 1520)], { ...base, slotPx: 20 })).toHaveLength(1);
    expect(placeCalls([call('K1ABC', 1500)], { ...base, lines: [{ utcMs: T, y: 10 }] })).toEqual([]);
    // A label for a slot not on screen goes nowhere.
    expect(placeCalls([call('K1ABC', 1500, T - 15_000)], base)).toEqual([]);
  });
});
