// The practice band's stations against the real sequencer (lib/testing/qso-sim.ts), one
// scenario at a time with fixed seeds. Decodes are what the band sent at −21 dB or better: the
// decoder's reach, without the audio.
import { describe, expect, it } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';
import { bare, parseExchange } from '../qso/messages';
import type { SeqConfig } from '../qso/sequencer';
import { Sim, decode } from '../testing/qso-sim';
import { BAND_ENTITIES, continentOf, nonstandard } from './calls';
import type { ScenarioId } from './scenarios';
import { CLOCK_OFF_S, PracticeBand, STATIONS_PER_SLOT, type SimSignal } from './sim';

/** The prefixes of the New ones entities (calls.ts, RARE). */
const RARE_PREFIX = /^(TF|OY|9H|5B|JT|9N|4S|5Z|5R|V5|A3|CP|OX|6Y)/;

const ME = '9V1NE';

class Session {
  readonly sim: Sim;
  readonly band: PracticeBand;
  readonly slots: SimSignal[][] = [];

  constructor(scenario: ScenarioId, seed: number, over: Partial<SeqConfig> = {}, crowded = false) {
    this.sim = new Sim(over);
    const c = this.sim.st.config;
    this.band = new PracticeBand({ seed, scenario, crowded, myCall: c.myCall, myGrid: c.myGrid, mode: 'FT8' });
  }

  /** Slot i: the band transmits, ours plays, and the slot's decodes arrive unless we transmitted. */
  step(i: number): SimSignal[] {
    const ours = this.sim.sent.find((t) => t.slot === i - 1);
    const signals = this.band.slot(this.sim.at(i), ours ? { text: ours.text, freqHz: ours.freqHz ?? this.sim.st.config.txHz } : null);
    this.slots[i] = signals;
    this.sim.play(i);
    if (!this.sim.sent.some((t) => t.slot === i)) this.sim.hear(i, signals.filter((s) => s.snrDb >= -21).map((s) => decode(s.text, Math.round(s.snrDb), s.freqHz, s.dtS)));
    return signals;
  }

  run(from: number, to: number) {
    for (let i = from; i <= to; i++) this.step(i);
  }

  /** Every message from `call` in slots from..to, with its slot. */
  from(call: string, from = 0, to = this.slots.length - 1): { slot: number; text: string }[] {
    const out: { slot: number; text: string }[] = [];
    for (let i = from; i <= to; i++) for (const s of this.slots[i] ?? []) if (s.call === call) out.push({ slot: i, text: s.text });
    return out;
  }

  toMe(i: number): SimSignal[] {
    return (this.slots[i] ?? []).filter((s) => parseExchange(s.text).to === ME);
  }

  sentTexts(): string[] {
    return this.sim.sent.map((t) => t.text);
  }
}

function callCq(s: Session) {
  s.sim.send({ type: 'callCq', nowMs: s.sim.at(0, 0.1) });
}

/** A plain CQ in slot i from a station that is not directed. */
function plainCq(s: Session, i: number): SimSignal {
  const cq = s.slots[i].find((x) => /^CQ [A-Z0-9]+ [A-R]{2}\d{2}$/.test(x.text) && x.snrDb >= -18 && !x.text.startsWith('CQ DX') && !x.text.startsWith('CQ NA'));
  expect(cq, `a plain CQ in slot ${i}`).toBeDefined();
  return cq!;
}

describe('calling CQ', () => {
  it('one caller answers, completes the QSO and sends 73', () => {
    const s = new Session('cq-one', 1);
    callCq(s);
    s.run(0, 1);
    const callers = s.toMe(1);
    expect(callers).toHaveLength(1);
    const call = callers[0].call;
    expect(callers[0].text).toMatch(new RegExp(`^${ME} ${call} [A-R]{2}\\d{2}$`));
    s.run(2, 8);
    expect(s.sim.logged().map((r) => r.call)).toEqual([call]);
    const theirs = s.from(call).map((m) => m.text);
    expect(theirs[1]).toMatch(new RegExp(`^${ME} ${call} R[+-]\\d{2}$`));
    expect(theirs.at(-1)).toBe(`${ME} ${call} 73`);
  });

  it('a pile-up brings 3 to 5 callers, and Run works more than one of them', () => {
    for (const seed of [2, 3, 4]) {
      const s = new Session('cq-pileup', seed, { run: true });
      callCq(s);
      s.run(0, 1);
      const n = s.toMe(1).length;
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(5);
      s.run(2, 30);
      expect(s.sim.logged().length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      // Each QSO is with one of the callers in the pile-up.
      const pile = new Set(s.toMe(1).map((c) => c.call));
      for (const r of s.sim.logged()) expect(pile.has(r.call) || s.from(r.call).length > 0).toBe(true);
    }
  });

  it('a caller who goes quiet stops after our report, and nothing is logged', () => {
    const s = new Session('cq-quiet', 5);
    callCq(s);
    s.run(0, 1);
    const call = s.toMe(1)[0].call;
    s.run(2, 12);
    expect(s.sentTexts()[1]).toMatch(new RegExp(`^${call} ${ME} [+-]\\d{2}$`));
    expect(s.from(call, 2)).toEqual([]);
    expect(s.sim.logged()).toEqual([]);
  });

  it('a caller who misses the RR73 sends the R-report again, then 73, and the QSO is logged once', () => {
    const s = new Session('cq-repeat', 6);
    callCq(s);
    s.run(0, 1);
    const call = s.toMe(1)[0].call;
    s.run(2, 10);
    const theirs = s.from(call).map((m) => m.text);
    const r = theirs[1];
    expect(r).toMatch(/ R[+-]\d{2}$/);
    expect(theirs.slice(0, 4)).toEqual([expect.stringMatching(/[A-R]{2}\d{2}$/), r, r, `${ME} ${call} 73`]);
    expect(s.sentTexts().filter((t) => t.endsWith('RR73'))).toHaveLength(2);
    expect(s.sim.logged().map((q) => q.call)).toEqual([call]);
  });
});

describe('calling a station', () => {
  it('the station answers with a report, sends RR73 after our R-report, and the QSO is logged', () => {
    const s = new Session('answer', 7);
    s.run(0, 0);
    const cq = plainCq(s, 0);
    s.sim.call(0, decode(cq.text, Math.round(cq.snrDb), cq.freqHz, cq.dtS));
    s.run(1, 8);
    const theirs = s.from(cq.call, 1).map((m) => m.text);
    expect(theirs[0]).toMatch(new RegExp(`^${ME} ${cq.call} [+-]\\d{2}$`));
    expect(theirs[1]).toMatch(new RegExp(`^${ME} ${cq.call} (RR73|RRR)$`));
    expect(s.sim.logged().map((q) => q.call)).toEqual([cq.call]);
    expect(s.sentTexts().at(-1)).toBe(`${cq.call} ${ME} 73`);
  });

  it('the station works someone else to RR73 or 73, then answers our one tail-end call, and the QSO is logged', () => {
    for (const seed of [8, 9, 10, 11, 12, 13]) {
      const s = new Session('answer-busy', seed);
      s.run(0, 0);
      const cq = plainCq(s, 0);
      s.sim.call(0, decode(cq.text, Math.round(cq.snrDb), cq.freqHz, cq.dtS));
      s.run(1, 16);
      const theirs = s.from(cq.call, 1).map((m) => ({ slot: m.slot, ex: parseExchange(m.text) }));
      const other = theirs[0].ex.to!;
      expect(other, `seed ${seed}`).not.toBe(ME);
      expect(theirs[0].ex.kind, `seed ${seed}`).toBe('report');
      const end = theirs.find((x) => x.ex.to === other && (x.ex.kind === 'rr73' || x.ex.kind === '73'));
      expect(end, `seed ${seed}: ends the QSO with ${other} by RR73 or 73`).toBeDefined();
      // Our calls: the first one, nothing while they work, one more in the slot after the end.
      const ours = s.sim.sent.filter((t) => t.text === `${cq.call} ${ME} OJ11`).map((t) => t.slot);
      expect(ours, `seed ${seed}`).toEqual([1, end!.slot + 1]);
      expect(theirs.find((x) => x.ex.to === ME)?.slot, `seed ${seed}`).toBe(end!.slot + 2);
      expect(s.sim.logged().map((q) => q.call), `seed ${seed}`).toEqual([cq.call]);
      expect(s.sim.notices()[0], `seed ${seed}`).toMatchObject({ kind: 'lost', text: `${cq.call} answered ${other}` });
    }
  });

  it('the station never hears us and keeps calling CQ', () => {
    const s = new Session('answer-deaf', 14);
    s.run(0, 0);
    const cq = plainCq(s, 0);
    s.sim.call(0, decode(cq.text, Math.round(cq.snrDb), cq.freqHz, cq.dtS));
    s.run(1, 10);
    const theirs = s.from(cq.call, 1).map((m) => m.text);
    expect(theirs.length).toBeGreaterThan(2);
    for (const t of theirs) expect(parseExchange(t).to).not.toBe(ME);
    expect(theirs[0]).toBe(cq.text);
    expect(s.sentTexts().filter((t) => t.startsWith(`${cq.call} ${ME}`)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Hunt: busy band', () => {
  function hunt(seed: number, over: Partial<SeqConfig> = {}) {
    const s = new Session('hunt-busy', seed, over);
    s.sim.send({ type: 'hunt', on: true, nowMs: s.sim.at(0, 5) });
    return s;
  }

  it('carries at least 6 plain CQs a slot, and the weaker stations ignore us', () => {
    const s = hunt(71);
    s.run(0, 12);
    for (let i = 0; i <= 12; i++) {
      const plain = (s.slots[i] ?? []).filter((x) => /^CQ [A-Z0-9/]+ [A-R]{2}\d{2}$/.test(x.text));
      expect(plain.length, `slot ${i}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('Hunt works one station after another and logs each QSO', () => {
    for (const seed of [71, 72, 73]) {
      const s = hunt(seed);
      s.run(0, 24);
      const calls = s.sim.logged().map((q) => q.call);
      expect(calls.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(new Set(calls).size, `seed ${seed}`).toBe(calls.length);
      expect(s.sim.st.huntQsos, `seed ${seed}`).toBe(calls.length);
    }
  });

  it('Hunt gives up on a station that does not hear us and does not call it again', () => {
    // Farthest first reaches the weak stations, which ignore us. Seed 76: on 74's band since the
    // realism changes, Hunt calls a station, moves on when it answers someone else, and calls it
    // again later, so its calls add up to more than one run.
    const s = hunt(76, { huntOrder: 'farthest' });
    s.run(0, 60);
    const ignored = s.sim.st.ignored;
    expect(ignored.length).toBeGreaterThan(0);
    for (const { call, atMs } of ignored) {
      const calls = s.sim.sent.filter((t) => t.text.startsWith(`${call} ${ME} `)).map((t) => s.sim.at(t.slot));
      // 4 calls, or 5 with a tail-end call when the station answered someone else; none after giving up.
      expect(calls.length, call).toBeGreaterThanOrEqual(4);
      expect(calls.length, call).toBeLessThanOrEqual(5);
      expect(calls.every((t) => t < atMs), call).toBe(true);
      expect(s.from(call).some((m) => m.text.startsWith(`${ME} `)), call).toBe(false);
    }
    expect(s.sim.logged().length).toBeGreaterThan(0);
  });
});

describe('a scenario chosen while the band runs', () => {
  it('applies to the stations already on the band', () => {
    const s = new Session('random', 61);
    s.run(0, 5);
    s.band.configure({ scenario: 'answer-deaf' });
    s.run(6, 6);
    const deaf = plainCq(s, 6);
    s.sim.call(6, decode(deaf.text, -5, deaf.freqHz));
    s.run(7, 12);
    expect(s.from(deaf.call, 7).some((m) => parseExchange(m.text).to === ME)).toBe(false);

    const t = new Session('random', 62);
    t.run(0, 5);
    t.band.configure({ scenario: 'answer', crowded: true });
    t.run(6, 6);
    const cq = plainCq(t, 6);
    t.sim.call(6, decode(cq.text, -5, cq.freqHz));
    t.run(7, 14);
    expect(t.from(cq.call, 7)[0].text).toMatch(new RegExp(`^${ME} ${cq.call} [+-]\\d{2}$`));
    expect(t.sim.logged().map((q) => q.call)).toEqual([cq.call]);
    expect(t.slots[14].length).toBeGreaterThanOrEqual(STATIONS_PER_SLOT.crowded[0]);
  });
});

describe('directed CQs', () => {
  function directed(s: Session, i: number, modifier: 'DX' | 'NA'): SimSignal {
    const cq = s.slots[i].find((x) => x.text.startsWith(`CQ ${modifier} `));
    expect(cq, `CQ ${modifier} in slot ${i}`).toBeDefined();
    return cq!;
  }

  it('the band always carries CQ DX and CQ NA, and their callsigns fit them', () => {
    const s = new Session('directed', 15);
    s.run(0, 20);
    for (let i = 0; i <= 20; i++) {
      const dx = directed(s, i, 'DX');
      const na = directed(s, i, 'NA');
      expect(continentOf(na.call)).toBe('NA');
      expect(continentOf(dx.call)).not.toBe('AS');
    }
  });

  it('CQ NA ignores a station in Asia; CQ DX from another continent answers it', () => {
    const na = new Session('directed', 16);
    na.run(0, 0);
    const n = directed(na, 0, 'NA');
    na.sim.call(0, decode(n.text, -5, n.freqHz));
    na.run(1, 8);
    expect(na.from(n.call, 1).some((m) => parseExchange(m.text).to === ME)).toBe(false);

    const dx = new Session('directed', 17);
    dx.run(0, 0);
    const d = directed(dx, 0, 'DX');
    dx.sim.call(0, decode(d.text, -5, d.freqHz));
    dx.run(1, 8);
    expect(dx.from(d.call, 1)[0].text).toMatch(new RegExp(`^${ME} ${d.call} [+-]\\d{2}$`));
  });

  it('CQ NA answers a station in North America', () => {
    const s = new Session('directed', 18, { myCall: 'K1ABC', myGrid: 'FN42' });
    s.run(0, 0);
    const n = directed(s, 0, 'NA');
    s.sim.call(0, decode(n.text, -5, n.freqHz));
    s.run(1, 8);
    expect(s.from(n.call, 1)[0].text).toMatch(new RegExp(`^K1ABC ${n.call} [+-]\\d{2}$`));
    expect(s.sim.logged().map((q) => q.call)).toEqual([n.call]);
  });
});

describe('the band', () => {
  for (const crowded of [false, true]) {
    const [lo, hi] = crowded ? STATIONS_PER_SLOT.crowded : STATIONS_PER_SLOT.normal;
    it(`carries ${lo} to ${hi} stations a slot${crowded ? ' when crowded' : ''}, −24 to +5 dB, some fading`, () => {
      for (const seed of [21, 22, 23]) {
        const s = new Session('random', seed, {}, crowded);
        s.run(0, 60);
        const all = s.slots.flat();
        for (const [i, slot] of s.slots.entries()) {
          expect(slot.length, `seed ${seed} slot ${i}`).toBeGreaterThanOrEqual(lo);
          expect(slot.length, `seed ${seed} slot ${i}`).toBeLessThanOrEqual(hi);
          // One transmission per station in a slot.
          expect(new Set(slot.map((x) => x.call)).size).toBe(slot.length);
        }
        for (const x of all) {
          expect(x.snrDb).toBeGreaterThanOrEqual(-25);
          expect(x.snrDb).toBeLessThanOrEqual(6);
          expect(x.freqHz).toBeGreaterThanOrEqual(200);
          expect(x.freqHz).toBeLessThanOrEqual(2850);
        }
        expect(all.some((x) => x.fading)).toBe(true);
        expect(Math.min(...all.map((x) => x.snrDb))).toBeLessThan(-18);
        expect(Math.max(...all.map((x) => x.snrDb))).toBeGreaterThan(0);
      }
    });
  }

  it('carries QSOs between its stations through every step', () => {
    const s = new Session('random', 31);
    s.run(0, 40);
    const texts = s.slots.flat().map((x) => x.text);
    const complete = texts.filter((t) => / [A-R]{2}\d{2}$/.test(t) && !t.startsWith('CQ')).filter((call) => {
      const [a, b] = call.split(' ');
      const has = (re: RegExp) => texts.some((t) => re.test(t));
      return has(new RegExp(`^${b} ${a} [+-]\\d{2}$`)) && has(new RegExp(`^${a} ${b} R[+-]\\d{2}$`)) && has(new RegExp(`^${b} ${a} (RR73|RRR|73)$`));
    });
    expect(complete.length).toBeGreaterThanOrEqual(2);
  });

  it('gives the same band for the same seed and the same transmissions', () => {
    const run = () => {
      const s = new Session('random', 41);
      callCq(s);
      s.run(0, 25);
      return JSON.stringify(s.slots);
    };
    expect(run()).toBe(run());
    const other = new Session('random', 42);
    other.run(0, 25);
    expect(JSON.stringify(other.slots)).not.toBe(run());
  });

  it('sends only messages that encode', async () => {
    const wasm = await loadWasm();
    expect(wasm, 'the wasm package in src/wasm/pkg').not.toBeNull();
    if (!wasm) return;
    const texts = new Set<string>();
    for (const sc of ['random', 'cq-pileup', 'directed', 'answer-busy', 'hunt-busy'] as const) {
      const s = new Session(sc, 51, {}, sc === 'random');
      callCq(s);
      s.run(0, 30);
      for (const x of s.slots.flat()) texts.add(x.text);
    }
    for (const t of texts) expect(JSON.parse(wasm.pack_message(t, 'FT8')), t).toMatchObject({ ok: true, text: t });
  });
});

describe('Fox (DXpedition)', () => {
  /** Hound on, the Fox's first message (its CQ) double-tapped, then `slots` slots of the band. */
  function workFox(seed: number, slots = 30, over: Partial<SeqConfig> = { hound: true }) {
    const s = new Session('fox', seed, over);
    s.step(0);
    const first = s.slots[0][0];
    s.sim.call(0, decode(first.text, Math.round(first.snrDb), first.freqHz, first.dtS));
    s.run(1, slots);
    return { s, fox: first.call };
  }

  it('calls CQ first, then works up to 3 Hounds a slot from 300 Hz, 60 Hz apart, in even slots', () => {
    const { s, fox } = workFox(1, 20);
    expect(s.slots[0].map((x) => x.text)).toEqual([expect.stringMatching(new RegExp(`^CQ ${fox} [A-R]{2}\\d{2}$`))]);
    const foxSlots = s.slots.map((xs) => xs.filter((x) => x.call === fox));
    expect(foxSlots.filter((xs, i) => i % 2 === 1 && xs.length)).toEqual([]);
    expect(Math.max(...foxSlots.map((xs) => xs.length))).toBe(3);
    for (const x of foxSlots.flat()) expect([300, 360, 420]).toContain(x.freqHz);
    expect(foxSlots.flat().some((x) => / RR73; /.test(x.text))).toBe(true);
    // The Hounds call between 1000 and 2850 Hz and answer on the Fox's stream.
    for (const x of s.slots.filter((_, i) => i % 2 === 1).flat()) {
      if (/ [A-R]{2}\d{2}$/.test(x.text)) expect(x.freqHz).toBeGreaterThanOrEqual(1000);
      else expect([300, 360, 420]).toContain(x.freqHz);
    }
  });

  it('answers us after 2 to 4 calls; the R-report goes on its frequency and RR73 logs the QSO', () => {
    const multi: boolean[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { s, fox } = workFox(seed);
      const calls = s.sim.sent.filter((t) => t.tx === 1).length;
      expect(calls, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(calls, `seed ${seed}`).toBeLessThanOrEqual(5);
      const toMe = s.slots.flatMap((xs, i) => xs.filter((x) => x.call === fox && x.text.includes(`${ME} <${fox}>`) || x.text.startsWith(`${ME} ${fox} -`) || x.text.startsWith(`${ME} ${fox} +`)).map((x) => ({ ...x, slot: i })));
      expect(toMe.length, `seed ${seed}`).toBeGreaterThan(0);
      multi.push(toMe[0].text.includes(';'));
      const r = s.sim.sent.find((t) => t.tx === 3)!;
      expect(r.slot, `seed ${seed}`).toBe(toMe[0].slot + 1);
      expect(r.freqHz, `seed ${seed}`).toBe(Math.round(toMe[0].freqHz));
      expect(s.sim.logged().map((q) => q.call), `seed ${seed}`).toEqual([fox]);
      expect(s.sim.notices().map((n) => n.kind), `seed ${seed}`).toEqual([]);
    }
    // Sometimes the report comes inside a multi-call message, sometimes alone.
    expect(multi).toContain(true);
    expect(multi).toContain(false);
  });

  it('never answers a call below 1000 Hz', () => {
    const { s } = workFox(1, 20, { hound: false, txHz: 600 });
    expect(s.sim.sent.every((t) => t.tx === 1)).toBe(true);
    expect(s.sim.logged()).toEqual([]);
  });

  it('sends only messages that encode', async () => {
    const wasm = await loadWasm();
    if (!wasm) return;
    const { s } = workFox(9, 40);
    for (const t of new Set(s.slots.flat().map((x) => x.text))) expect(JSON.parse(wasm.pack_message(t, 'FT8')), t).toMatchObject({ ok: true, text: t });
  });
});

describe('the band, as on the air', () => {
  const runs = [21, 22, 23].map((seed) => {
    const s = new Session('random', seed);
    callCq(s);
    s.run(0, 80);
    return s;
  });
  const all = runs.flatMap((s) => s.slots.flat());

  it('spreads DT from −0.5 to +2.5 s, with the odd station several seconds off', () => {
    const dts = all.map((x) => x.dtS).sort((a, b) => a - b);
    const share = (lo: number, hi: number) => dts.filter((d) => d >= lo && d <= hi).length / dts.length;
    expect(share(-0.6, 0.85)).toBeGreaterThan(0.75);
    expect(share(0.85, 2.6)).toBeGreaterThan(0.04);
    expect(dts.some((d) => d > 2.6 || d < -0.9)).toBe(true);
    expect(dts[0]).toBeGreaterThanOrEqual(-2.1);
    expect(dts.at(-1)!).toBeLessThanOrEqual(4.1);
    // Clocks scatter around a median near 0, so the Clock badge stays off.
    expect(Math.abs(dts[dts.length >> 1])).toBeLessThan(0.5);
  });

  it('lets some stations drift slowly, moving on between their transmissions', () => {
    const drifting = all.filter((x) => x.driftHzPerS);
    expect(drifting.length).toBeGreaterThan(0);
    for (const x of drifting) expect(Math.abs(x.driftHzPerS!)).toBeLessThanOrEqual(0.3);
    const s = runs.find((r) => r.slots.flat().some((x) => x.driftHzPerS && r.from(x.call).length >= 3))!;
    const call = s.slots.flat().find((x) => x.driftHzPerS && s.from(x.call).length >= 3)!.call;
    const f = s.slots.flatMap((xs) => xs.filter((x) => x.call === call).map((x) => x.freqHz));
    expect(f[1]).not.toBe(f[0]);
  });

  it('puts some pairs of stations on nearly the same frequency', () => {
    const close = runs.flatMap((s) => s.slots).filter((xs) => xs.some((a, i) => xs.some((b, j) => i !== j && Math.abs(a.freqHz - b.freqHz) <= 20)));
    expect(close.length).toBeGreaterThan(3);
  });

  it('gives some paths multipath fading as well as slow QSB', () => {
    const mp = all.filter((x) => x.multipath);
    expect(mp.length).toBeGreaterThan(0);
    for (const x of mp) {
      expect(x.multipath!.spreadHz).toBeGreaterThanOrEqual(0.1);
      expect(x.multipath!.spreadHz).toBeLessThanOrEqual(1.5);
      expect(x.multipath!.delayMs).toBeGreaterThanOrEqual(0.5);
      expect(x.multipath!.delayMs).toBeLessThanOrEqual(3);
    }
    expect(all.some((x) => x.multipath && x.fading)).toBe(true);
  });

  it('opens and closes over 10 to 20 minutes, with more stations open than closed', () => {
    const band = new PracticeBand({ seed: 24, scenario: 'random', crowded: false, myCall: ME, myGrid: 'OJ11', mode: 'FT8' });
    // Openness over 2 hours, a slot at a time: each swing from closed to open takes 10 to 20 min.
    const T = Date.UTC(2026, 9, 13, 0, 0, 0);
    const p = Array.from({ length: 480 }, (_, i) => band.openness(T + i * 15_000));
    const turns = p.map((v, i) => i).filter((i) => i > 0 && i < p.length - 1 && (p[i] - p[i - 1]) * (p[i + 1] - p[i]) < 0);
    expect(turns.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < turns.length; i++) {
      const min = ((turns[i] - turns[i - 1]) * 15) / 60;
      expect(min).toBeGreaterThanOrEqual(9.5);
      expect(min).toBeLessThanOrEqual(20.5);
    }
    const counts = p.map((_, i) => band.slot(T + i * 15_000, null).length);
    const by = (open: boolean) => {
      const xs = counts.filter((_, i) => (open ? p[i] > 0.8 : p[i] < 0.2));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(by(true) - by(false)).toBeGreaterThan(2);
  });

  it('raises and lowers the noise floor, with static crashes and the odd carrier, the same for the same seed', () => {
    const band = new PracticeBand({ seed: 25, scenario: 'random', crowded: false, myCall: ME, myGrid: 'OJ11', mode: 'FT8' });
    const T = Date.UTC(2026, 9, 13, 0, 0, 0);
    const c = Array.from({ length: 400 }, (_, i) => band.conditions(T + i * 15_000));
    const rises = c.map((x) => x.riseDb[0]);
    expect(Math.min(...rises)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rises)).toBeLessThanOrEqual(3);
    expect(Math.max(...rises) - Math.min(...rises)).toBeGreaterThan(1.5);
    // Each slot ends where the next starts.
    for (let i = 1; i < c.length; i++) expect(c[i].riseDb[0]).toBe(c[i - 1].riseDb[1]);
    const crashed = c.filter((x) => x.crashes.length).length / c.length;
    expect(crashed).toBeGreaterThan(0.05);
    expect(crashed).toBeLessThan(0.3);
    const carried = c.filter((x) => x.carriers.length);
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.length).toBeLessThan(c.length / 2);
    expect(new PracticeBand({ ...band.options, seed: 25 }).conditions(T + 7 * 15_000)).toEqual(c[7]);
    const weak = new PracticeBand({ ...band.options, scenario: 'weak' });
    for (let i = 0; i < 100; i++) {
      const r = weak.conditions(T + i * 15_000).riseDb[0];
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it('carries compound callsigns, hashed in reports and in full in CQs and calls', () => {
    const texts = runs.flatMap((s) => s.slots.flat().map((x) => x.text));
    expect(texts.some((t) => /\/P\b/.test(t))).toBe(true);
    expect(texts.some((t) => /^CQ [A-Z0-9]+\/[A-Z0-9]+$/.test(t))).toBe(true);
    expect(texts.some((t) => /<[A-Z0-9/]+>/.test(t))).toBe(true);
    // A compound station heard first in a QSO, its callsign hashed, comes in full later.
    const later = runs.some((s) => {
      const calls = new Set(s.slots.flat().filter((x) => nonstandard(x.call)).map((x) => x.call));
      return [...calls].some((call) => {
        const theirs = s.from(call).map((m) => m.text);
        return theirs[0].includes(`<${call}>`) && theirs.slice(1).some((t) => t.split(' ').includes(call));
      });
    });
    expect(later).toBe(true);
  });

  it('brings callers who open with a report and end with 73, and tail-enders, and Repeat CQ logs them', () => {
    let direct = 0;
    let tail = 0;
    for (let seed = 100; seed < 130; seed++) {
      const s = new Session('random', seed, { run: true });
      callCq(s);
      s.run(0, 40);
      const logged = new Set(s.sim.logged().map((q) => q.call));
      for (const call of new Set(s.slots.flat().filter((x) => parseExchange(x.text).to === ME).map((x) => x.call))) {
        const theirs = s.from(call).filter((m) => parseExchange(m.text).to === ME);
        const first = parseExchange(theirs[0].text);
        if (first.kind === 'report' && logged.has(call)) {
          expect(theirs.at(-1)!.text, `seed ${seed}`).toBe(`${ME} ${call} 73`);
          direct++;
        }
        // A tail-ender calls in the slot after our RR73 to another station.
        const ended = s.sim.sent.some((t) => t.slot === theirs[0].slot - 1 && / RR73$/.test(t.text) && !t.text.startsWith(`${call} `));
        if (ended && (first.kind === 'grid' || first.kind === 'call')) tail++;
      }
    }
    expect(direct).toBeGreaterThan(0);
    expect(tail).toBeGreaterThan(0);
  });
});

describe('Contest exchanges', () => {
  const formats = (text: string) => parseExchange(text, true);
  const contest = (seed: number, exchange: string, over: Partial<SeqConfig> = {}) => new Session('contest', seed, { exchange, myGrid: 'OJ11AB', ...over });
  /** The CQ with `modifier` in slot i. */
  function cqOf(s: Session, i: number, modifier: string): SimSignal {
    const cq = s.slots[i].find((x) => x.text.startsWith(`CQ ${modifier} `));
    expect(cq, `CQ ${modifier} in slot ${i}`).toBeDefined();
    return cq!;
  }

  it('carries CQ FD and CQ RU from North America and CQ TEST from Europe in every slot', () => {
    const s = contest(1, '6A WI');
    s.run(0, 12);
    for (let i = 0; i <= 12; i++) {
      expect(continentOf(cqOf(s, i, 'FD').call)).toBe('NA');
      expect(continentOf(cqOf(s, i, 'RU').call)).toBe('NA');
      expect(continentOf(cqOf(s, i, 'TEST').call)).toBe('EU');
    }
  });

  it('a CQ FD station answers our exchange with R and its own, and the QSO is logged with both', () => {
    for (const seed of [2, 3, 4]) {
      const s = contest(seed, '6A WI');
      s.run(0, 0);
      const cq = cqOf(s, 0, 'FD');
      s.sim.call(0, decode(cq.text, -5, cq.freqHz));
      s.run(1, 8);
      expect(s.sentTexts()[0], `seed ${seed}`).toBe(`${cq.call} ${ME} 6A WI`);
      const reply = s.from(cq.call, 1)[0].text;
      expect(reply, `seed ${seed}`).toMatch(new RegExp(`^${ME} ${cq.call} R \\d{1,2}[A-H] [A-Z]{2,3}$`));
      const q = s.sim.logged();
      expect(q.map((r) => r.call), `seed ${seed}`).toEqual([cq.call]);
      expect(q[0], `seed ${seed}`).toMatchObject({ stx: '6A WI', srx: reply.split(' ').slice(3).join(' ') });
    }
  });

  it('a CQ RU station takes a serial number and sends its state, and a CQ TEST station works the EU VHF format', () => {
    const ru = contest(5, '#');
    ru.run(0, 0);
    const r = cqOf(ru, 0, 'RU');
    ru.sim.call(0, decode(r.text, -5, r.freqHz));
    ru.run(1, 8);
    expect(ru.sentTexts()[0]).toMatch(new RegExp(`^${r.call} ${ME} 5\\d9 0001$`));
    expect(formats(ru.from(r.call, 1)[0].text)).toMatchObject({ kind: 'rreport', format: 'ru' });
    expect(ru.sim.logged()).toHaveLength(1);

    const vhf = contest(6, '#');
    vhf.run(0, 0);
    const t = cqOf(vhf, 0, 'TEST');
    vhf.sim.call(0, decode(t.text, -5, t.freqHz));
    vhf.run(1, 10);
    const theirs = vhf.from(t.call, 1).map((m) => formats(m.text));
    expect(theirs[0]).toMatchObject({ kind: 'report', format: 'vhf' });
    expect(vhf.sentTexts()[1]).toMatch(new RegExp(`^<${t.call}> <${ME}> R 5\\d0001 OJ11AB$`));
    expect(vhf.sim.logged().map((q) => q.call)).toEqual([t.call]);
  });

  it('callers to our CQ FD open with their exchange and are logged after R and ours', () => {
    const s = contest(7, '6A WI', { cqModifier: 'FD' });
    callCq(s);
    s.run(0, 1);
    const callers = s.slots[1].filter((x) => formats(x.text).to === ME);
    expect(callers.length).toBeGreaterThanOrEqual(1);
    for (const c of callers) expect(formats(c.text)).toMatchObject({ kind: 'report', format: 'fd' });
    s.run(2, 8);
    expect(s.sentTexts()[1]).toMatch(/ R 6A WI$/);
    expect(s.sim.logged()).toHaveLength(1);
    expect(s.sim.logged()[0].srx).toMatch(/^\d{1,2}[A-H] [A-Z]{2,3}$/);
  });

  it('callers to a plain CQ come in all three formats, and each QSO is logged in its format', () => {
    const seen = new Set<string>();
    for (const seed of [8, 9, 10, 11, 12]) {
      const s = contest(seed, '6A WI #', { run: true });
      callCq(s);
      s.run(0, 30);
      for (const x of s.slots.flat()) {
        const ex = formats(x.text);
        if (bare(ex.to ?? '') !== ME || !['grid', 'report', 'rreport'].includes(ex.kind)) continue;
        seen.add(ex.format ?? (ex.kind === 'grid' ? 'grid' : 'standard'));
      }
      expect(s.sim.logged().length, `seed ${seed}`).toBeGreaterThan(0);
    }
    // EU VHF callers open with the grid, then send their exchange in type 5.
    expect([...seen].sort()).toEqual(['fd', 'grid', 'ru', 'vhf']);
  });

  it('Custom exchange missing a part: nothing goes out to a caller, who keeps sending its exchange', () => {
    const s = contest(13, '6A', { cqModifier: 'FD' });
    callCq(s);
    s.run(0, 12);
    const caller = s.slots[1].find((x) => formats(x.text).to === ME)!;
    expect(caller).toBeDefined();
    expect(s.from(caller.call).length).toBeGreaterThanOrEqual(4);
    expect(s.sentTexts().some((t) => t.startsWith(`${caller.call} `))).toBe(false);
    expect(s.sim.logged()).toEqual([]);
  });

  it('without Custom exchange, a CQ FD station gets the grid, answers with its exchange, and nothing is logged', () => {
    const s = contest(14, '');
    s.run(0, 0);
    const cq = cqOf(s, 0, 'FD');
    s.sim.call(0, decode(cq.text, -5, cq.freqHz));
    s.run(1, 10);
    expect(s.sentTexts()[0]).toBe(`${cq.call} ${ME} OJ11`);
    expect(formats(s.from(cq.call, 1)[0].text)).toMatchObject({ kind: 'report', format: 'fd' });
    expect(s.sim.logged()).toEqual([]);
  });
});

describe('Clock off', () => {
  it('puts every station 1.5 s early or late, the same way for the whole band', () => {
    const signs = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = new Session('clock', seed);
      s.run(0, 20);
      const dts = s.slots.flat().map((x) => x.dtS).sort((a, b) => a - b);
      const median = dts[dts.length >> 1];
      const sign = Math.sign(median);
      signs.add(sign);
      expect(Math.abs(median - sign * CLOCK_OFF_S), `seed ${seed}`).toBeLessThan(0.3);
      for (const d of dts) expect(Math.abs(d - sign * CLOCK_OFF_S), `seed ${seed}`).toBeLessThan(0.5);
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });
});

describe('Worked stations', () => {
  it('seeds 2 dupes, 2 stations from earlier days and 2 from another band or mode, all calling CQ', () => {
    const s = new Session('worked', 1);
    const seeds = s.band.logSeed();
    expect(seeds.map((q) => [q.sameBand, q.sameMode, q.daysAgo > 0])).toEqual([
      [true, true, false],
      [true, true, false],
      [true, true, true],
      [true, true, true],
      [false, true, false],
      [true, false, true],
    ]);
    s.run(0, 30);
    for (const q of seeds) {
      const cqs = s.from(q.call).filter((m) => m.text.startsWith('CQ '));
      expect(cqs.length, q.call).toBeGreaterThanOrEqual(6);
    }
    // The same seed gives the same QSOs.
    expect(new Session('worked', 1).band.logSeed()).toEqual(seeds);
  });

  it('a dupe calls our CQ with a new station, and Repeat CQ skips the dupe', () => {
    const s = new Session('worked', 2, { run: true });
    const seeds = s.band.logSeed();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    s.sim.send({ type: 'setWorked', worked: seeds.filter((q) => q.sameBand && q.sameMode).map((q) => ({ call: q.call, band: '20m', mode: 'FT8', day: day(s.sim.at(0) - q.daysAgo * 86_400_000), grid: q.grid, activationId: null })), nowMs: s.sim.at(0) });
    callCq(s);
    s.run(0, 1);
    const callers = s.toMe(1).map((x) => x.call);
    const dupes = seeds.filter((q) => q.daysAgo === 0 && q.sameBand && q.sameMode).map((q) => q.call);
    expect(callers.some((c) => dupes.includes(c))).toBe(true);
    expect(callers.some((c) => !dupes.includes(c))).toBe(true);
    s.run(2, 12);
    const logged = s.sim.logged().map((q) => q.call);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.some((c) => dupes.includes(c))).toBe(false);
  });
});

describe('Hunt: a station calls you', () => {
  it('the station Hunt calls stays silent, another calls us, and Hunt works it', () => {
    for (const seed of [1, 2, 3]) {
      const s = new Session('hunt-caller', seed);
      s.sim.send({ type: 'hunt', on: true, nowMs: s.sim.at(0, 5) });
      s.run(0, 24);
      const first = s.sim.sent[0];
      const called = parseExchange(first.text).to!;
      expect(s.from(called).some((m) => parseExchange(m.text).to === ME), `seed ${seed}`).toBe(false);
      const caller = s.toMe(first.slot + 1);
      expect(caller, `seed ${seed}`).toHaveLength(1);
      expect(s.sim.logged().map((q) => q.call), `seed ${seed}`).toContain(caller[0].call);
    }
  });
});

describe('Station answers someone else', () => {
  it('the called station answers another caller each time, and nothing is logged', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = new Session('lost', seed);
      s.run(0, 0);
      const cq = plainCq(s, 0);
      s.sim.call(0, decode(cq.text, Math.round(cq.snrDb), cq.freqHz, cq.dtS));
      s.run(1, 20);
      const theirs = s.from(cq.call, 1).map((m) => parseExchange(m.text));
      expect(theirs[0].to, `seed ${seed}`).not.toBe(ME);
      expect(theirs.some((x) => x.to === ME), `seed ${seed}`).toBe(false);
      expect(s.sim.logged(), `seed ${seed}`).toEqual([]);
      expect(s.sim.notices()[0], `seed ${seed}`).toMatchObject({ kind: 'lost' });
    }
  });
});

describe('Activation callers', () => {
  it('callers keep coming to CQ POTA, so Repeat CQ logs 10 QSOs or more in 15 minutes', () => {
    for (const seed of [1, 2, 3]) {
      const s = new Session('activation', seed, { run: true, cqModifier: 'POTA' });
      callCq(s);
      s.run(0, 60);
      const calls = s.sim.logged().map((q) => q.call);
      expect(calls.length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(new Set(calls).size, `seed ${seed}`).toBe(calls.length);
    }
  });
});

describe('New ones', () => {
  it('seeds a QSO from each entity of the band, and the band carries CQs from entities it leaves out', () => {
    const s = new Session('new-ones', 1);
    const seeds = s.band.logSeed();
    expect(seeds).toHaveLength(BAND_ENTITIES.length);
    expect(seeds.every((q) => q.daysAgo > 0 && q.sameBand && q.sameMode)).toBe(true);
    const fields = new Set(seeds.map((q) => q.grid!.slice(0, 2)));
    s.run(0, 12);
    for (let i = 0; i <= 12; i++) {
      const rare = s.slots[i].filter((x) => x.text.startsWith('CQ ') && RARE_PREFIX.test(x.call));
      expect(rare.length, `slot ${i}`).toBeGreaterThanOrEqual(2);
      for (const x of rare) expect(fields.has(parseExchange(x.text).grid!.slice(0, 2)), x.text).toBe(false);
    }
  });

  it('after a QSO with one, the band calls from other entities', () => {
    const s = new Session('new-ones', 2);
    s.run(0, 0);
    const cq = s.slots[0].find((x) => x.text.startsWith('CQ ') && RARE_PREFIX.test(x.call))!;
    s.sim.call(0, decode(cq.text, -5, cq.freqHz));
    s.run(1, 10);
    expect(s.sim.logged().map((q) => q.call)).toEqual([cq.call]);
    const prefix = RARE_PREFIX.exec(cq.call)![0];
    s.run(11, 40);
    const fresh = s.slots.slice(20).flat().filter((x) => x.text.startsWith('CQ ') && RARE_PREFIX.test(x.call) && x.call !== cq.call);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((x) => x.call.startsWith(prefix) && s.from(x.call, 0, 10).length === 0)).toBe(false);
  });
});

describe('Weak and crowded', () => {
  it('brings 1 to 3 callers near −22 dB on a crowded band', () => {
    for (const seed of [1, 2, 3]) {
      const s = new Session('weak', seed);
      callCq(s);
      s.run(0, 1);
      const callers = s.toMe(1);
      expect(callers.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(callers.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      for (const c of callers) {
        expect(c.snrDb).toBeGreaterThanOrEqual(-24.5);
        expect(c.snrDb).toBeLessThanOrEqual(-18.5);
      }
      for (const slot of s.slots) expect(slot.length).toBeGreaterThanOrEqual(STATIONS_PER_SLOT.crowded[0]);
    }
  });
});

describe('every scenario', () => {
  it('sends only messages that encode', async () => {
    const wasm = await loadWasm();
    if (!wasm) return;
    const texts = new Set<string>();
    const runs: [ScenarioId, Partial<SeqConfig>][] = [
      ['contest', { exchange: '6A WI #', myGrid: 'OJ11AB', run: true }],
      ['activation', { run: true, cqModifier: 'POTA' }],
      ['weak', { run: true }],
      ['worked', { run: true }],
      ['new-ones', {}],
      ['clock', {}],
      ['lost', {}],
      ['hunt-caller', {}],
    ];
    for (const [sc, over] of runs) {
      for (const seed of [1, 2]) {
        const s = new Session(sc, seed, over);
        if (sc === 'hunt-caller') s.sim.send({ type: 'hunt', on: true, nowMs: s.sim.at(0, 5) });
        else callCq(s);
        s.run(0, 40);
        for (const x of s.slots.flat()) texts.add(x.text);
      }
    }
    for (const seed of [21, 22, 23, 24, 25]) {
      const s = new Session('random', seed, { run: true });
      callCq(s);
      s.run(0, 60);
      for (const x of s.slots.flat()) texts.add(x.text);
    }
    for (const t of texts) expect(JSON.parse(wasm.pack_message(t, 'FT8')), t).toMatchObject({ ok: true, text: t });
  });
});
