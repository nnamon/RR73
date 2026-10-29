// The practice band in LQ8 against the real sequencer: its stations run LQ8's 4-message QSO
// (docs/design/lq8.md). Decodes are what the band sent at −21 dB or better, in the text the
// codec gives it (callsigns hashed where LQ8's types need), as the decoder shows it.
import { describe, expect, it } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import { parseExchange } from '../qso/messages';
import { Sim, decode } from '../testing/qso-sim';
import { scenarioIn, scenariosIn, type ScenarioId } from './scenarios';
import { PracticeBand, type SimSignal } from './sim';

const ME = '9V1NE';

class Session {
  readonly sim = new Sim({ mode: 'LQ8', dialHz: 14_084_000 });
  readonly band: PracticeBand;
  readonly slots: SimSignal[][] = [];

  constructor(
    scenario: ScenarioId,
    seed: number,
    private readonly wasm: Wasm,
  ) {
    const c = this.sim.st.config;
    this.band = new PracticeBand({ seed, scenario, crowded: false, myCall: c.myCall, myGrid: c.myGrid, mode: 'LQ8' });
  }

  shown(text: string): string {
    const p = JSON.parse(this.wasm.pack_message(text, 'LQ8')) as { ok: boolean; text: string };
    expect(p.ok, text).toBe(true);
    return p.text;
  }

  step(i: number) {
    const ours = this.sim.sent.find((t) => t.slot === i - 1);
    const signals = this.band.slot(this.sim.at(i), ours ? { text: ours.text, freqHz: ours.freqHz ?? this.sim.st.config.txHz } : null);
    this.slots[i] = signals;
    this.sim.play(i);
    if (!this.sim.sent.some((t) => t.slot === i)) this.sim.hear(i, signals.filter((s) => s.snrDb >= -21).map((s) => decode(this.shown(s.text), Math.round(s.snrDb), s.freqHz, s.dtS)));
  }

  run(from: number, to: number) {
    for (let i = from; i <= to; i++) this.step(i);
  }

  toMe(i: number): SimSignal[] {
    return (this.slots[i] ?? []).filter((s) => parseExchange(s.text).to === ME);
  }
}

async function wasm(): Promise<Wasm> {
  const w = await loadWasm();
  expect(w, 'the wasm package in src/wasm/pkg').not.toBeNull();
  return w!;
}

describe('the practice band in LQ8', () => {
  it('a caller to our CQ sends its grid and report, gets REPORT+73 and ends with 73', async () => {
    const s = new Session('cq-one', 1, await wasm());
    s.sim.send({ type: 'callCq', nowMs: s.sim.at(0, 0.1) });
    s.run(0, 1);
    const [caller] = s.toMe(1);
    expect(caller.text).toMatch(new RegExp(`^${ME} ${caller.call} [A-R]{2}\\d{2} [+-]\\d{2}$`));
    s.run(2, 4);
    expect(s.sim.sent.map((t) => t.text)).toEqual([`CQ ${ME} OJ11`, expect.stringMatching(new RegExp(`^${caller.call} ${ME} R[+-]\\d{2}$`))]);
    expect(s.toMe(3).map((x) => x.text)).toEqual([`${ME} ${caller.call} 73`]);
    expect(s.sim.logged()).toMatchObject([{ call: caller.call, mode: 'LQ8' }]);
  });

  it('a station calling CQ answers our call with REPORT+73 and we log it with 73', async () => {
    const s = new Session('answer', 3, await wasm());
    s.run(0, 1);
    const cq = s.slots[1].find((x) => /^CQ [A-Z0-9]+ [A-R]{2}\d{2}$/.test(x.text) && x.snrDb >= -18);
    expect(cq).toBeDefined();
    s.sim.call(1, decode(cq!.text, -10, cq!.freqHz));
    s.run(2, 5);
    const reply = s.toMe(3);
    expect(reply.map((x) => x.text)).toEqual([expect.stringMatching(new RegExp(`^${ME} ${cq!.call} R[+-]\\d{2}$`))]);
    expect(s.sim.sent.map((t) => t.text)).toEqual([expect.stringMatching(new RegExp(`^${cq!.call} ${ME} OJ11 [+-]\\d{2}$`)), `${cq!.call} ${ME} 73`]);
    expect(s.sim.logged()).toMatchObject([{ call: cq!.call, mode: 'LQ8' }]);
  });

  it('a caller who misses our REPORT+73 calls again and gets it again, logged once', async () => {
    const s = new Session('cq-repeat', 5, await wasm());
    s.sim.send({ type: 'callCq', nowMs: s.sim.at(0, 0.1) });
    s.run(0, 7);
    const [caller] = s.toMe(1);
    expect(s.toMe(3).map((x) => x.text)).toEqual([caller.text]);
    expect(s.sim.sent.filter((t) => new RegExp(`^${caller.call} ${ME} R[+-]\\d{2}$`).test(t.text))).toHaveLength(2);
    expect(s.sim.logged()).toHaveLength(1);
  });

  it('every message the band sends packs as LQ8', async () => {
    const w = await wasm();
    for (const sc of ['random', 'cq-pileup', 'activation', 'answer-busy', 'hunt-busy'] as const) {
      const s = new Session(sc, 51, w);
      s.sim.send({ type: 'callCq', nowMs: s.sim.at(0, 0.1) });
      s.run(0, 24);
    }
  });

  it('offers no contest or Fox scenario in LQ8, and runs the random band for them', () => {
    const ids = scenariosIn('LQ8').map((x) => x.id);
    expect(ids).not.toContain('contest');
    expect(ids).not.toContain('fox');
    expect(scenariosIn('FT8').map((x) => x.id)).toContain('fox');
    expect(scenarioIn('fox', 'LQ8')).toBe('random');
    expect(scenarioIn('fox', 'FT8')).toBe('fox');
    const band = new PracticeBand({ seed: 2, scenario: 'fox', crowded: false, myCall: ME, myGrid: 'OJ11', mode: 'LQ8' });
    expect(band.options.scenario).toBe('random');
  });
});
