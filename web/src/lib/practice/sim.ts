/**
 * The practice band's stations: who transmits in each slot and what. A pure, seeded model; the
 * audio comes from render.ts and the decoder hears it as on the air.
 *
 * Every station reacts to the messages of the slot before, as an operator with auto-sequencing
 * does: a station calling CQ answers a caller with a report and ends with RR73 (or 73), a caller
 * answers a report with an R-report and ends with 73. Stations work each other this way, so
 * the band carries CQs and QSOs through their steps. The operator's transmissions arrive the
 * same way, read from the sequencer; the scenario decides how the stations that answer the
 * operator's CQ, or that the operator calls, treat them.
 */

import { SLOT_MS, type Mode } from '../clock/slots';
import { formatReport, parseExchange, sameCall, type Exchange } from '../qso/messages';
import { Rng, continentOf, newCallsign, type Continent } from './calls';
import type { ScenarioId } from './scenarios';

/** Slow fading (QSB): the level swings `depthDb` peak to peak with a period of `periodS`. */
export interface Fading {
  periodS: number;
  depthDb: number;
  /** Phase at the slot start, radians. */
  phase: number;
}

/** One transmission in a slot. */
export interface SimSignal {
  /** The sender. */
  call: string;
  /** Message text as sent. */
  text: string;
  /** Lowest tone, Hz. */
  freqHz: number;
  /** Start after the slot start plus 0.5 s, s. */
  dtS: number;
  /** SNR in 2500 Hz, dB. */
  snrDb: number;
  fading: Fading | null;
}

/** What the operator sent in a slot, from the sequencer. */
export interface OperatorTx {
  text: string;
  /** Tx audio frequency, Hz. */
  freqHz: number;
}

export interface BandOptions {
  seed: number;
  scenario: ScenarioId;
  crowded: boolean;
  /** The callsign and grid the sequencer sends. */
  myCall: string;
  myGrid: string;
  mode: Mode;
}

/** Stations transmitting in a slot: 8 to 15, or 25 to 40 on a crowded band. */
export const STATIONS_PER_SLOT = { normal: [8, 15], crowded: [25, 40] } as const;
/** Background stations, dB. */
export const SNR_RANGE = [-24, 5] as const;
/** Stations that call the operator or call CQ: strong enough to decode, dB. */
const CLEAR_SNR = [-16, 2] as const;
const LOW_HZ = 200;
const HIGH_HZ = 2850;
/** FT8 and FT4 signals are 50 and 83 Hz wide. */
const SPACING_HZ: Record<Mode, number> = { FT8: 55, FT4: 90 };

type Policy = 'answer' | 'busy' | 'deaf' | 'tail';
type Behaviour = 'normal' | 'quiet' | 'repeat';
type StationState = 'cq' | 'calling' | 'sentReport' | 'sentRR73' | 'sentR' | 'sent73' | 'quiet' | 'gone';

interface Station {
  call: string;
  grid: string;
  continent: Continent;
  parity: 0 | 1;
  freqHz: number;
  snrDb: number;
  dtS: number;
  fading: Fading | null;
  /** The station's own decisions, so one station's choices do not shift another's. */
  rng: Rng;
  /** CQ DX, CQ NA, or a plain CQ. */
  modifier: 'DX' | 'NA' | null;
  state: StationState;
  /** The station worked or called. */
  partner: string | null;
  /** Report given to the partner, dB. */
  report: number;
  /** Messages sent without an answer. */
  tries: number;
  /** Most calls before a caller gives up. */
  maxCalls: number;
  /** Slots of CQ without a QSO, and how many it calls before leaving. */
  idle: number;
  patience: number;
  /** How the station treats the operator's calls; chosen at the first one. */
  policy: Policy | null;
  behaviour: Behaviour;
  /** A caller with the repeat behaviour has missed one RR73. */
  missed: boolean;
  /** Ends a QSO with another practice station by 73 in place of RR73. */
  ends73: boolean;
  /** Kept on the band whatever the station count: it is working, or being worked by, the operator. */
  engaged: boolean;
  say: string | null;
}

interface Heard {
  ex: Exchange;
  fromOperator: boolean;
}

/** A practice band. `slot` is called once per slot in time order; skipped slots are allowed. */
export class PracticeBand {
  readonly options: BandOptions;
  private readonly rng: Rng;
  private stations: Station[] = [];
  private lastSlot: number | null = null;
  private lastHeard: Heard[] = [];
  private readonly target: [number, number];
  private readonly myContinent: Continent | null;

  constructor(options: BandOptions) {
    this.options = { ...options, myCall: options.myCall.toUpperCase() };
    this.rng = new Rng(options.seed);
    const [lo, hi] = this.range;
    this.target = [this.rng.int(lo, hi), this.rng.int(lo, hi)];
    this.myContinent = continentOf(this.options.myCall);
  }

  /**
   * Changes the scenario or the crowded band in place: the stations on the band stay, and the
   * new scenario decides how each treats the operator from the next call on.
   */
  configure(o: { scenario?: ScenarioId; crowded?: boolean }) {
    if (o.crowded !== undefined) this.options.crowded = o.crowded;
    if (o.scenario === undefined || o.scenario === this.options.scenario) return;
    this.options.scenario = o.scenario;
    const calledOften = o.scenario.startsWith('answer') || o.scenario === 'directed';
    for (const s of this.stations) {
      if (s.partner !== this.options.myCall) s.policy = null;
      if (calledOften && s.state === 'cq') s.patience = Math.max(s.patience, s.idle + 40);
    }
  }

  private get range(): readonly [number, number] {
    return this.options.crowded ? STATIONS_PER_SLOT.crowded : STATIONS_PER_SLOT.normal;
  }

  /**
   * The transmissions in the slot starting at `slotStartMs` (UTC ms), given what the operator
   * sent in the slot before it (null when nothing went out).
   */
  slot(slotStartMs: number, operator: OperatorTx | null): SimSignal[] {
    const k = Math.round(slotStartMs / SLOT_MS[this.options.mode]);
    const parity = (((k % 2) + 2) % 2) as 0 | 1;
    const inbox: Heard[] = this.lastSlot === k - 1 ? [...this.lastHeard] : [];
    const op = operator ? parseExchange(operator.text) : null;
    if (op && op.from && sameCall(op.from, this.options.myCall)) inbox.push({ ex: op, fromOperator: true });

    for (const s of this.stations) {
      s.say = null;
      if (s.parity === parity && s.state !== 'gone') this.decide(s, this.hears(s, inbox));
    }
    if (op?.kind === 'cq' && sameCall(op.from, this.options.myCall)) this.answerCq(parity, op, operator!.freqHz);
    this.backgroundCallers(parity, inbox);
    this.keepCount(parity);

    this.stations = this.stations.filter((s) => s.state !== 'gone');
    const sending = this.stations.filter((s) => s.parity === parity && s.say);
    this.lastSlot = k;
    this.lastHeard = sending.map((s) => ({ ex: parseExchange(s.say!), fromOperator: false }));
    return sending.map((s) => ({
      call: s.call,
      text: s.say!,
      freqHz: s.freqHz,
      dtS: round2(s.dtS + this.rng.range(-0.04, 0.04)),
      snrDb: round2(Math.max(SNR_RANGE[0] - 1, Math.min(SNR_RANGE[1] + 1, s.snrDb + this.rng.range(-1.5, 1.5)))),
      fading: s.fading,
    }));
  }

  /** What a station hears of the slot before: every message from the operator, most from the band. */
  private hears(s: Station, inbox: Heard[]): Heard[] {
    return inbox.filter((m) => m.fromOperator || s.rng.chance(0.94));
  }

  private decide(s: Station, inbox: Heard[]) {
    const toMe = inbox.filter((m) => m.ex.to && sameCall(m.ex.to, s.call));
    const fromPartner = s.partner ? toMe.find((m) => sameCall(m.ex.from, s.partner)) : undefined;
    const kind = fromPartner?.ex.kind;
    switch (s.state) {
      case 'cq':
        return this.decideCq(s, toMe);
      case 'sentReport':
        if (kind === 'rreport') return this.sendFinal(s);
        if (++s.tries >= 3) return this.backToCq(s, toMe);
        return this.sendReport(s);
      case 'sentRR73':
        if (kind === 'rreport' && ++s.tries < 3) return this.sendFinal(s);
        // 73, or nothing: the QSO is over.
        return this.backToCq(s, toMe.filter((m) => m !== fromPartner));
      case 'calling':
        if (kind === 'report' || kind === 'rreport') {
          if (s.behaviour === 'quiet') {
            s.state = 'quiet';
            s.tries = 0;
            return;
          }
          s.tries = 0;
          return this.sendR(s);
        }
        return this.keepCalling(s, inbox);
      case 'sentR':
        if (kind === 'rr73' || kind === 'rrr' || kind === '73') {
          if (s.behaviour === 'repeat' && !s.missed && s.partner === this.options.myCall) {
            s.missed = true;
            return this.sendR(s);
          }
          s.tries = 0;
          s.state = 'sent73';
          s.say = `${s.partner} ${s.call} 73`;
          return;
        }
        if (++s.tries >= 4) return this.leave(s);
        return this.sendR(s);
      case 'sent73':
        if ((kind === 'rr73' || kind === 'rrr') && ++s.tries < 2) {
          s.say = `${s.partner} ${s.call} 73`;
          return;
        }
        // Some stations stay and call CQ after a QSO.
        if (s.partner !== this.options.myCall && s.rng.chance(0.3)) return this.backToCq(s, []);
        return this.leave(s);
      case 'quiet':
        if (++s.tries >= 6) this.leave(s);
        return;
      default:
        return;
    }
  }

  private decideCq(s: Station, toMe: Heard[]) {
    const callers = toMe.filter((m) => m.ex.kind === 'grid' || m.ex.kind === 'call' || m.ex.kind === 'report');
    // In a scripted scenario the operator comes first; on the random band callers are taken in any order.
    const ordered = this.options.scenario === 'random' ? shuffle(callers, s.rng) : [...callers.filter((m) => m.fromOperator), ...callers.filter((m) => !m.fromOperator)];
    for (const c of ordered) {
      if (!c.fromOperator) return this.startQso(s, c.ex.from!, false);
      const how = this.treatOperator(s);
      if (how === 'answer') return this.startQso(s, this.options.myCall, true);
      if (how === 'busy') {
        // Another station called in the same slot as the operator, and gets the answer.
        const other = this.spawn(s.parity === 0 ? 1 : 0, { state: 'calling', partner: s.call, near: s.freqHz });
        s.policy = 'tail';
        return this.startQso(s, other.call, false);
      }
    }
    if (++s.idle > s.patience && !s.engaged) return this.leave(s);
    s.say = `CQ ${s.modifier ? `${s.modifier} ` : ''}${s.call} ${s.grid}`;
  }

  /** How a station calling CQ treats a call from the operator now. */
  private treatOperator(s: Station): 'answer' | 'busy' | 'ignore' {
    // A directed CQ answers only the stations it asked for.
    if (s.modifier === 'NA' && this.myContinent !== 'NA') return 'ignore';
    if (s.modifier === 'DX' && this.myContinent !== null && this.myContinent === s.continent) return 'ignore';
    if (s.policy === null) {
      const sc = this.options.scenario;
      if (sc === 'answer-busy') s.policy = 'busy';
      else if (sc === 'answer-deaf') s.policy = 'deaf';
      else if (sc === 'random') {
        const r = s.rng.next();
        s.policy = r < 0.6 ? 'answer' : r < 0.85 ? 'busy' : 'deaf';
      } else s.policy = 'answer';
    }
    if (s.policy === 'deaf') return 'ignore';
    // After working the other station, a tail-ender gets an answer more often than not.
    if (s.policy === 'tail') return s.rng.chance(0.6) ? 'answer' : 'ignore';
    return s.policy;
  }

  private startQso(s: Station, partner: string, operator: boolean) {
    s.partner = partner;
    s.state = 'sentReport';
    s.tries = 0;
    s.idle = 0;
    s.engaged = s.engaged || operator;
    s.report = operator ? s.rng.int(-18, 0) : s.rng.int(-22, 5);
    this.sendReport(s);
  }

  private sendReport(s: Station) {
    s.state = 'sentReport';
    s.say = `${s.partner} ${s.call} ${formatReport(s.report)}`;
  }

  /** RR73 to end the QSO; RRR now and then; 73 from some stations working another practice station. */
  private sendFinal(s: Station) {
    s.state = 'sentRR73';
    const toOperator = s.partner === this.options.myCall;
    const word = !toOperator && s.ends73 ? '73' : s.rng.chance(0.1) ? 'RRR' : 'RR73';
    s.say = `${s.partner} ${s.call} ${word}`;
  }

  private sendR(s: Station) {
    s.state = 'sentR';
    s.say = `${s.partner} ${s.call} R${formatReport(s.report)}`;
  }

  private backToCq(s: Station, toMe: Heard[]) {
    s.partner = null;
    s.engaged = false;
    s.state = 'cq';
    s.tries = 0;
    s.idle = 0;
    this.decideCq(s, toMe);
  }

  private keepCalling(s: Station, inbox: Heard[]) {
    if (++s.tries > s.maxCalls) return this.leave(s);
    const partnerSent = inbox.find((m) => sameCall(m.ex.from, s.partner));
    // The station called is working someone else: wait, or call over him; call again as he ends.
    const busy = partnerSent && partnerSent.ex.kind !== 'cq' && !sameCall(partnerSent.ex.to, s.call);
    const ending = busy && (partnerSent.ex.kind === 'rr73' || partnerSent.ex.kind === 'rrr' || partnerSent.ex.kind === '73');
    if (busy && !ending && !s.rng.chance(0.5)) return;
    s.say = `${s.partner} ${s.call} ${s.grid}`;
  }

  private leave(s: Station) {
    s.state = 'gone';
    s.say = null;
  }

  /** The operator called CQ in the slot before: the scenario's callers answer in this one. */
  private answerCq(parity: 0 | 1, cq: Exchange, nearHz: number) {
    const me = this.options.myCall;
    const busy = this.stations.some((s) => s.partner === me && s.state !== 'gone' && s.state !== 'quiet' && s.state !== 'calling');
    if (busy) return;
    const calling = this.stations.filter((s) => s.partner === me && s.state === 'calling');
    // Callers still waiting call again.
    for (const s of calling) if (!s.say && s.parity === parity) s.say = `${me} ${s.call} ${s.grid}`;
    if (calling.length) return;
    const callers = this.callersFor();
    const only = directedFilter(cq.modifier, this.myContinent);
    for (const behaviour of callers) {
      const s = this.spawn(parity, { state: 'calling', partner: me, near: nearHz, clear: true, only, behaviour });
      s.engaged = true;
      s.maxCalls = callers.length > 1 ? 8 : 6;
      s.say = `${me} ${s.call} ${s.grid}`;
    }
  }

  private callersFor(): Behaviour[] {
    const r = this.rng;
    const pile = () => Array.from({ length: r.int(3, 5) }, (): Behaviour => 'normal');
    switch (this.options.scenario) {
      case 'cq-one':
        return ['normal'];
      case 'cq-pileup':
        return pile();
      case 'cq-quiet':
        return ['quiet'];
      case 'cq-repeat':
        return ['repeat'];
      case 'random': {
        const x = r.next();
        if (x < 0.3) return [];
        if (x < 0.65) return ['normal'];
        if (x < 0.79) return pile();
        return [x < 0.9 ? 'quiet' : 'repeat'];
      }
      default:
        return r.chance(0.5) ? ['normal'] : [];
    }
  }

  /** Some of the CQs heard in the slot before get a caller from the band. */
  private backgroundCallers(parity: 0 | 1, inbox: Heard[]) {
    const p = this.options.crowded ? 0.2 : 0.12;
    for (const m of inbox) {
      if (m.fromOperator || m.ex.kind !== 'cq') continue;
      const cq = this.stations.find((s) => s.call === m.ex.from && s.state === 'cq');
      if (!cq || !this.rng.chance(p)) continue;
      const s = this.spawn(parity, { state: 'calling', partner: cq.call, only: directedFilter(cq.modifier, cq.continent) });
      s.say = `${cq.call} ${s.call} ${s.grid}`;
    }
  }

  /** Keeps the stations sending in this slot within the band's range, drifting slowly. */
  private keepCount(parity: 0 | 1) {
    const [lo, hi] = this.range;
    this.target[parity] = Math.max(lo, Math.min(hi, this.target[parity] + this.rng.int(-1, 1)));
    const want = this.target[parity];
    const sending = () => this.stations.filter((s) => s.parity === parity && s.say);
    const cqs = () => this.stations.filter((s) => s.parity === parity && s.state === 'cq' && s.say);
    const directed = this.options.scenario === 'directed';
    // Stations to call: at least 3 CQs, and in the directed scenario a CQ DX and a CQ NA.
    const need: ('DX' | 'NA' | null)[] = [];
    if (directed && !cqs().some((s) => s.modifier === 'DX')) need.push('DX');
    if (directed && !cqs().some((s) => s.modifier === 'NA')) need.push('NA');
    for (let n = cqs().length + need.length; n < 3; n++) need.push(null);
    for (const modifier of need) this.spawnCq(parity, modifier);
    while (sending().length < want) {
      const open = this.stations.filter((s) => s.parity !== parity && s.state === 'cq' && !s.engaged);
      if (open.length && this.rng.chance(0.25)) {
        const cq = this.rng.pick(open);
        const s = this.spawn(parity, { state: 'calling', partner: cq.call, only: directedFilter(cq.modifier, cq.continent) });
        s.say = `${cq.call} ${s.call} ${s.grid}`;
      } else this.spawnCq(parity, this.newModifier());
    }
    // Too many: idle CQs and unanswered callers leave, never a station in a QSO.
    const spare = sending().filter((s) => !s.engaged && (s.state === 'calling' || s.state === 'cq'));
    let excess = sending().length - hi;
    while (excess > 0 && spare.length) {
      const s = spare.splice(this.rng.int(0, spare.length - 1), 1)[0];
      if (s.state === 'cq' && cqs().length <= 3) continue;
      this.leave(s);
      excess--;
    }
  }

  private newModifier(): 'DX' | 'NA' | null {
    const x = this.rng.next();
    if (this.options.scenario === 'directed') return x < 0.3 ? 'DX' : x < 0.6 ? 'NA' : null;
    return x < 0.07 ? 'DX' : x < 0.1 ? 'NA' : null;
  }

  private spawnCq(parity: 0 | 1, modifier: 'DX' | 'NA' | null): Station {
    const only = modifier === 'NA' ? (c: Continent) => c === 'NA' : modifier === 'DX' ? (c: Continent) => c !== this.myContinent : undefined;
    const s = this.spawn(parity, { state: 'cq', clear: true, only });
    s.modifier = modifier;
    // Stations you are asked to call stay long enough to be called.
    if (this.options.scenario.startsWith('answer') || this.options.scenario === 'directed') s.patience = 40;
    s.say = `CQ ${modifier ? `${modifier} ` : ''}${s.call} ${s.grid}`;
    return s;
  }

  private spawn(
    parity: 0 | 1,
    o: { state: StationState; partner?: string; near?: number; clear?: boolean; only?: (c: Continent) => boolean; behaviour?: Behaviour },
  ): Station {
    const r = this.rng;
    const taken = new Set([this.options.myCall, ...this.stations.map((s) => s.call)]);
    const id = newCallsign(r, taken, o.only);
    const [lo, hi] = o.clear ? CLEAR_SNR : SNR_RANGE;
    const s: Station = {
      call: id.call,
      grid: id.grid,
      continent: id.continent,
      parity,
      freqHz: this.freeHz(parity, o.near),
      snrDb: round2(r.range(lo, hi)),
      dtS: round2(r.chance(0.05) ? r.range(0.6, 1.4) : r.range(-0.2, 0.5)),
      fading: r.chance(0.3) ? { periodS: round2(r.range(3, 10)), depthDb: round2(r.range(6, o.clear ? 10 : 15)), phase: round2(r.range(0, 2 * Math.PI)) } : null,
      rng: r.fork(),
      modifier: null,
      state: o.state,
      partner: o.partner ?? null,
      report: r.int(-22, 5),
      tries: 0,
      maxCalls: r.int(3, 6),
      idle: 0,
      patience: r.int(6, 20),
      policy: null,
      behaviour: o.behaviour ?? 'normal',
      missed: false,
      ends73: r.chance(0.3),
      engaged: false,
      say: null,
    };
    this.stations.push(s);
    return s;
  }

  /** A frequency clear of the stations in the same parity where possible; near `nearHz` for callers. */
  private freeHz(parity: 0 | 1, nearHz?: number): number {
    const gap = SPACING_HZ[this.options.mode];
    const used = this.stations.filter((s) => s.parity === parity && s.state !== 'gone').map((s) => s.freqHz);
    let f = 0;
    for (let i = 0; i < 30; i++) {
      f = nearHz === undefined ? this.rng.range(LOW_HZ, HIGH_HZ) : nearHz + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(60, 450);
      f = Math.round(Math.max(LOW_HZ, Math.min(HIGH_HZ, f)));
      if (used.every((u) => Math.abs(u - f) >= gap)) break;
    }
    return f;
  }
}

/** The continents a directed CQ asks for: "DX" is any other continent. */
function directedFilter(modifier: string | null, from: Continent | null): ((c: Continent) => boolean) | undefined {
  if (!modifier) return undefined;
  if (modifier === 'DX') return from ? (c) => c !== from : undefined;
  const asked = modifier as Continent;
  return ['AF', 'AS', 'EU', 'NA', 'OC', 'SA'].includes(asked) ? (c) => c === asked : undefined;
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
