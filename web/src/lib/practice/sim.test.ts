// The practice band's stations against the real sequencer (lib/testing/qso-sim.ts), one
// scenario at a time with fixed seeds. Decodes are what the band sent at −21 dB or better: the
// decoder's reach, without the audio.
import { describe, expect, it } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';
import { parseExchange } from '../qso/messages';
import type { SeqConfig } from '../qso/sequencer';
import { Sim, decode } from '../testing/qso-sim';
import { continentOf } from './calls';
import type { ScenarioId } from './scenarios';
import { PracticeBand, STATIONS_PER_SLOT, type SimSignal } from './sim';

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

  it('a caller who misses the RR73 sends his R-report again, then 73, and the QSO is logged once', () => {
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
  it('he answers with a report, sends RR73 after our R-report, and the QSO is logged', () => {
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

  it('he works someone else to RR73 or 73, then answers our one tail-end call, and the QSO is logged', () => {
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
      expect(s.sim.notices()[0], `seed ${seed}`).toMatchObject({ kind: 'lost', text: `${cq.call} answered ${other}. Calling once more when they finish.` });
    }
  });

  it('he never hears us and keeps calling CQ', () => {
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
    // Farthest first reaches the weak stations, which ignore us.
    const s = hunt(74, { huntOrder: 'farthest' });
    s.run(0, 60);
    const ignored = s.sim.st.ignored;
    expect(ignored.length).toBeGreaterThan(0);
    for (const { call, atMs } of ignored) {
      const calls = s.sim.sent.filter((t) => t.text.startsWith(`${call} ${ME} `)).map((t) => s.sim.at(t.slot));
      // 4 calls, or 5 with a tail-end call when he answered someone else; none after giving up.
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
