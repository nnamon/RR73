import { describe, expect, it } from 'vitest';
import { SlotAssembler, type AssembledSlot, type EarlySlot, type StreamChunk } from './assembler';
import { prng } from '../testing/signal';

const CHUNK = 512;
const START = Date.UTC(2026, 9, 13, 13, 14, 52, 250);

/** Stream sample k carries the value of its own index modulo 10007, scaled, to check placement. */
const valueOf = (k: number) => ((k % 10007) + 1) / 10008;

interface Sim {
  index: number;
  /** UTC of stream sample 0 in this run, ms. */
  utc0: number;
}

function chunk(sim: Sim, jitterMs = 0, driftPpm = 0): StreamChunk {
  const samples = new Float32Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) samples[i] = valueOf(sim.index + i);
  const t = (sim.index / 12) * (1 + driftPpm * 1e-6);
  const c = { samples, index: sim.index, utcMs: sim.utc0 + t + jitterMs };
  sim.index += CHUNK;
  return c;
}

function runFor(a: SlotAssembler, sim: Sim, seconds: number, jitter?: () => number, driftPpm = 0): AssembledSlot[] {
  const out: AssembledSlot[] = [];
  const end = sim.index + seconds * 12000;
  while (sim.index < end) out.push(...a.push(chunk(sim, jitter?.() ?? 0, driftPpm)));
  return out;
}

/** UTC of a slot sample, by the simulation's own reckoning, back to its stream index. */
function streamIndexAt(sim0: Sim, utcMs: number): number {
  return Math.round((utcMs - sim0.utc0) * 12);
}

describe('SlotAssembler', () => {
  it('hands over the first 13.5 s of each FT8 slot once, as soon as they are written', () => {
    const early: { slot: EarlySlot; atIndex: number }[] = [];
    const sim = { index: 0, utc0: START };
    const a = new SlotAssembler('FT8', { earlyS: 13.5, onEarly: (slot) => early.push({ slot, atIndex: sim.index }) });
    const slots = runFor(a, sim, 40); // to 13:15:32.25
    expect(early.map((e) => e.slot.startUtcMs)).toEqual([Date.UTC(2026, 9, 13, 13, 14, 45), Date.UTC(2026, 9, 13, 13, 15, 0), Date.UTC(2026, 9, 13, 13, 15, 15)]);
    for (const { slot, atIndex } of early) {
      expect(slot.samples.length).toBe(162000);
      const full = slots.find((s) => s.startUtcMs === slot.startUtcMs)!;
      expect(slot.samples).toEqual(full.samples.subarray(0, 162000));
      // Handed over with the chunk that reached 13.5 s, before the slot ended.
      const reached = streamIndexAt({ index: 0, utc0: START }, slot.startUtcMs + 13_500);
      expect(atIndex - reached).toBeGreaterThanOrEqual(0);
      expect(atIndex - reached).toBeLessThanOrEqual(CHUNK);
    }
    // The first slot's audio began at 52.25 s, 7.25 s in: 6.25 s of it by 13.5 s.
    expect(early[0].slot.filled).toBe(75000);
    expect(early[1].slot.filled).toBe(162000);
    // A copy: later writes leave it alone.
    expect(early[2].slot.samples.buffer).not.toBe(slots[2].samples.buffer);
  });

  it('hands over nothing without onEarly, nor a slot whose audio began after the early point; FT4 at 6 s', () => {
    expect(runFor(new SlotAssembler('FT8', { earlyS: 13.5 }), { index: 0, utc0: START }, 20)).toHaveLength(1);
    const early: EarlySlot[] = [];
    runFor(new SlotAssembler('FT4', { earlyS: 6, onEarly: (s) => early.push(s) }), { index: 0, utc0: START }, 20);
    // Audio from 52.25 s: the FT4 slot from 45 s gets it 7.25 s in, past 6 s, and is left out.
    expect(early.map((s) => [s.startUtcMs, s.samples.length, s.filled])).toEqual([
      [Date.UTC(2026, 9, 13, 13, 14, 52, 500), 72000, 72000],
      [Date.UTC(2026, 9, 13, 13, 15, 0), 72000, 72000],
    ]);
  });

  it('emits UTC-aligned FT8 slots of exactly 180000 samples', () => {
    const a = new SlotAssembler('FT8');
    const sim = { index: 0, utc0: START };
    const slots = runFor(a, sim, 40); // to 13:15:32.25
    expect(slots.map((s) => s.startUtcMs)).toEqual([
      Date.UTC(2026, 9, 13, 13, 14, 45),
      Date.UTC(2026, 9, 13, 13, 15, 0),
      Date.UTC(2026, 9, 13, 13, 15, 15),
    ]);
    for (const s of slots) expect(s.samples.length).toBe(180000);
  });

  it('flags the first slot as a late start and counts its audio', () => {
    const a = new SlotAssembler('FT8');
    const slots = runFor(a, { index: 0, utc0: START }, 25);
    const [first, second] = slots;
    expect(first.lateStart).toBe(true);
    expect(first.gap).toBe(false);
    expect(first.filled).toBe(93000); // 7.75 s of the slot
    expect(Array.from(first.samples.subarray(0, 87000)).every((v) => v === 0)).toBe(true);
    expect(second.lateStart).toBe(false);
    expect(second.gap).toBe(false);
    expect(second.filled).toBe(180000);
  });

  it('puts every sample at its UTC position', () => {
    const a = new SlotAssembler('FT8');
    const sim0 = { index: 0, utc0: START };
    const slots = runFor(a, { ...sim0 }, 35);
    const full = slots.find((s) => !s.lateStart)!;
    for (const o of [0, 1, 12345, 90000, 179999]) {
      const k = streamIndexAt(sim0, full.startUtcMs + o / 12);
      expect(full.samples[o]).toBe(Math.fround(valueOf(k)));
    }
  });

  it('emits FT4 slots of exactly 90000 samples', () => {
    const a = new SlotAssembler('FT4');
    const slots = runFor(a, { index: 0, utc0: START }, 30);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    for (const s of slots) {
      expect(s.samples.length).toBe(90000);
      expect(s.startUtcMs % 7500).toBe(0);
    }
    expect(slots.filter((s) => !s.lateStart).every((s) => s.filled === 90000 && !s.gap)).toBe(true);
  });

  it('ignores a few ms of jitter in chunk times', () => {
    const a = new SlotAssembler('FT8');
    const r = prng(9);
    const slots = runFor(a, { index: 0, utc0: START }, 50, () => (r() - 0.5) * 6);
    const full = slots.filter((s) => !s.lateStart);
    expect(full.length).toBe(2);
    for (const s of full) {
      expect(s.filled).toBe(180000);
      expect(s.gap).toBe(false);
    }
    expect(a.dropped).toBe(0);
  });

  it('zero-fills an interruption and flags the slot', () => {
    const a = new SlotAssembler('FT8');
    const sim = { index: 0, utc0: START };
    const out = runFor(a, sim, 12); // into the 13:15:00 slot
    // Audio stops for 3.3 s: the stream index continues, but its times move on.
    sim.utc0 += 3300;
    out.push(...runFor(a, sim, 20));
    const hit = out.find((s) => s.startUtcMs === Date.UTC(2026, 9, 13, 13, 15, 0))!;
    expect(hit.gap).toBe(true);
    expect(hit.lateStart).toBe(false);
    expect(hit.samples.length).toBe(180000);
    expect(180000 - hit.filled).toBeGreaterThanOrEqual(3300 * 12 - CHUNK);
    expect(180000 - hit.filled).toBeLessThanOrEqual(3300 * 12 + CHUNK);
  });

  it('re-anchors when the capture restarts with a new index', () => {
    const a = new SlotAssembler('FT8');
    const out = runFor(a, { index: 0, utc0: START }, 10);
    const later = START + 10000 + 20000;
    out.push(...runFor(a, { index: 0, utc0: later }, 25));
    const starts = out.map((s) => s.startUtcMs);
    expect(new Set(starts).size).toBe(starts.length);
    for (const s of out) expect(s.samples.length).toBe(180000);
    // The slot that held the end of the first run ends early and says so.
    const cut = out.find((s) => s.startUtcMs === Date.UTC(2026, 9, 13, 13, 15, 0))!;
    expect(cut.gap).toBe(true);
    expect(Math.abs(cut.filled - 2.25 * 12000)).toBeLessThanOrEqual(CHUNK);
    // The second run starts mid-slot.
    expect(out.find((s) => s.startUtcMs === Date.UTC(2026, 9, 13, 13, 15, 15))!.lateStart).toBe(true);
  });

  it('moves the anchor at a slot boundary to follow drift, without flagging gaps', () => {
    const a = new SlotAssembler('FT8');
    // The audio clock runs 400 ppm slow against UTC: 6 ms per 15 s slot.
    const slots = runFor(a, { index: 0, utc0: START }, 92, undefined, 400);
    const full = slots.filter((s) => !s.lateStart);
    expect(full.length).toBeGreaterThanOrEqual(4);
    for (const s of full) {
      expect(s.samples.length).toBe(180000);
      expect(s.gap).toBe(false);
      expect(s.filled).toBeGreaterThan(180000 - 120);
    }
  });

  it('drops samples whose positions were already written', () => {
    const a = new SlotAssembler('FT8');
    const sim = { index: 0, utc0: START };
    runFor(a, sim, 3);
    sim.utc0 -= 500; // the clock steps back 0.5 s
    runFor(a, sim, 3);
    expect(a.dropped).toBe(6000);
  });

  it('flushes the slot in progress with its tail zero-filled and flagged', () => {
    const a = new SlotAssembler('FT8');
    runFor(a, { index: 0, utc0: START }, 10);
    const s = a.flush()!;
    expect(s.samples.length).toBe(180000);
    expect(s.gap).toBe(true);
    expect(a.flush()).toBeNull();
  });
});
