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
 *
 * The band lives as one does: it opens and closes over 10 to 20 minutes, stations fade in and
 * out with it, clocks and frequencies are a little off, some paths carry multipath fading, and
 * the noise floor rises and falls with the odd static crash and carrier (conditions()).
 */

import { SLOT_MS, type FtMode as Mode } from '../clock/slots';
import { formatReport, parseExchange, sameCall, bare, type Exchange } from '../qso/messages';
import { strength, type Format } from '../qso/exchange';
import { BAND_ENTITIES, Rng, callsignIn, compoundOf, contestPlace, continentOf, newCallsign, nonstandard, rareCallsign, type Callsign, type Continent } from './calls';
import type { ScenarioId } from './scenarios';
import type { SlotConditions } from './render';
import { FoxBand } from './fox';

/** Slow fading (QSB): the level swings `depthDb` peak to peak with a period of `periodS`. */
export interface Fading {
  periodS: number;
  depthDb: number;
  /** Phase at the slot start, radians. */
  phase: number;
}

/** Two-path fading (render.ts): each path's Doppler spread, Hz, the second path's delay, ms, and the seed of its gains. */
export interface Multipath {
  spreadHz: number;
  delayMs: number;
  seed: number;
}

/** One transmission in a slot. */
export interface SimSignal {
  /** The sender. */
  call: string;
  /** Message text as sent. */
  text: string;
  /** Lowest tone at the start of the transmission, Hz. */
  freqHz: number;
  /** Start after the slot start plus 0.5 s, s. */
  dtS: number;
  /** SNR in 2500 Hz against the slot's noise, the band's own and what conditions() adds, dB. */
  snrDb: number;
  fading: Fading | null;
  /** Frequency drift through the transmission, Hz/s; absent or 0 for none. */
  driftHzPerS?: number;
  multipath?: Multipath | null;
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

/** A QSO for the practice log, from the Worked stations and New ones scenarios. */
export interface SeedQso {
  call: string;
  grid: string | null;
  /** On the band and mode in use, or on another one. */
  sameBand: boolean;
  sameMode: boolean;
  /** 0 for today (UTC), else days before it. */
  daysAgo: number;
}

/** Stations transmitting in a slot: 8 to 15, or 25 to 40 on a crowded band. */
export const STATIONS_PER_SLOT = { normal: [8, 15], crowded: [25, 40] } as const;
/** Background stations, dB. */
export const SNR_RANGE = [-24, 5] as const;
/** Stations that call the operator or call CQ: strong enough to decode, dB. */
const CLEAR_SNR = [-16, 2] as const;
/** Weak and crowded: the operator's callers, and the CQs, dB. */
const WEAK_CALLERS = [-23, -20] as const;
const WEAK_CQS = [-20, -8] as const;
/** Hunt: busy band: CQs on the band in each parity, and the level under which a station does not hear the operator, dB. */
const HUNT_CQS = 6;
const HUNT_DEAF_DB = -10;
const LOW_HZ = 200;
const HIGH_HZ = 2850;
/** FT8 and FT4 signals are 50 and 83 Hz wide. */
const SPACING_HZ: Record<Mode, number> = { FT8: 55, FT4: 90 };
/** Clock off: every station this far early or late, s. */
export const CLOCK_OFF_S = 1.5;
/** A background station whose level falls below this as the band closes leaves, dB. */
const FADED_DB = -26;
/** Change of a background station's level from a closed band to an open one, dB at full reach. */
const OPENING_DB = 14;
/** Activation: the chance that a station tail-ends each QSO from the operator's CQ. */
const ACTIVATION_TAIL = 0.8;

type Policy = 'answer' | 'busy' | 'deaf' | 'tail' | 'lost';
type Behaviour = 'normal' | 'quiet' | 'repeat' | 'direct';
type StationState = 'cq' | 'calling' | 'sentReport' | 'sentRR73' | 'sentR' | 'sent73' | 'quiet' | 'gone';
type ContestFormat = Exclude<Format, 'standard'>;

interface Contest {
  format: ContestFormat;
  /** Field Day: class and section, "2B EMA". Roundup: a state or province, or null to send the serial number. */
  exch: string | null;
  /** Roundup and EU VHF: the serial number sent. */
  serial: number;
  /** EU VHF: the 6-character grid. */
  grid6: string;
}

interface Station {
  call: string;
  grid: string;
  continent: Continent;
  entity: string;
  parity: 0 | 1;
  freqHz: number;
  /** Level against the band's own noise floor, dB, before the band's opening moves it. */
  snrDb: number;
  dtS: number;
  fading: Fading | null;
  driftHzPerS: number;
  multipath: Multipath | null;
  /** The station's own decisions, so one station's choices do not shift another's. */
  rng: Rng;
  /** CQ DX, CQ NA, CQ FD, CQ RU, CQ TEST, or a plain CQ. */
  modifier: string | null;
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
  /** On the random band, ends a QSO with the operator by 73 in place of RR73. */
  ends73Op: boolean;
  /** Kept on the band whatever the station count: it is working, or being worked by, the operator. */
  engaged: boolean;
  /** Hears every message its partner sends: the two stations of the lost-station scenario. */
  sure: boolean;
  /** Called the operator or called CQ for the scenario: its level holds as the band opens and closes and the noise rises. */
  clear: boolean;
  /** How much the band's opening moves the station's level, 0 to 1, and the opening when it arrived. */
  reach: number;
  openAtSpawn: number;
  /** Kept on the band for the scenario: the stations in the practice log for Worked stations. */
  fixed: boolean;
  /** A station in a contest exchange format. */
  contest: Contest | null;
  /** The station called CQ or another station first. */
  caller: boolean;
  say: string | null;
}

interface Heard {
  ex: Exchange;
  fromOperator: boolean;
}

/** FNV-1a over the seed and a tag: independent streams for the band's surroundings. */
function streamSeed(seed: number, tag: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Message text as the codec packs it: a callsign the standard messages cannot carry goes in full
 * in a call and in 73 (type 4) and hashed in a grid, report, R-report, RRR or RR73 (type 1).
 */
export function line(to: string, from: string, word: string): string {
  const t = bare(to);
  const f = bare(from);
  const nt = nonstandard(t);
  const nf = nonstandard(f);
  const tail = word ? ` ${word}` : '';
  if (!nt && !nf) return `${t} ${f}${tail}`;
  if (word === '' || word === '73') return nt ? `${t} <${f}>${tail}` : `<${t}> ${f}${tail}`;
  return nt ? `<${t}> ${f}${tail}` : `${t} <${f}>${tail}`;
}

/** A practice band. `slot` is called once per slot in time order; skipped slots are allowed. */
export class PracticeBand {
  readonly options: BandOptions;
  private readonly rng: Rng;
  private stations: Station[] = [];
  private lastSlot: number | null = null;
  private lastHeard: Heard[] = [];
  /** The wander of each parity's station count about what the band's opening gives. */
  private readonly target: [number, number];
  private readonly myContinent: Continent | null;
  /** The Fox scenario's DXpedition and Hounds, which replace the band while it runs. */
  private fox: FoxBand | null = null;
  /** The band's opening: period of a whole cycle, ms, and its phase. */
  private readonly openPeriodMs: number;
  private readonly openPhase: number;
  /** Clock off: early (−1) or late (+1). */
  private readonly clockSign: 1 | -1;
  /** Callers due later: the late callers to the operator's CQ. */
  private pending: { slot: number; behaviour: Behaviour }[] = [];
  /** The last slot the operator called CQ in. */
  private opCqSlot: number | null = null;
  /** Hunt with a caller: the station whose call from the operator brought a caller. */
  private huntCalled: string | null = null;
  /** New ones: entities the operator has worked here. */
  private readonly rareWorked = new Set<string>();
  /** Worked stations and New ones: the QSOs for the practice log, and the stations of the first. */
  private seeds: SeedQso[] | null = null;
  private seedScenario: ScenarioId | null = null;
  private fixedCalls: Callsign[] = [];

  constructor(options: BandOptions) {
    this.options = { ...options, myCall: options.myCall.toUpperCase() };
    this.rng = new Rng(options.seed);
    this.target = [this.rng.int(-2, 2), this.rng.int(-2, 2)];
    this.myContinent = continentOf(this.options.myCall);
    const env = new Rng(streamSeed(options.seed, 'band'));
    // Opening and closing take 10 to 20 min each.
    this.openPeriodMs = env.range(20, 40) * 60_000;
    this.openPhase = env.range(0, 2 * Math.PI);
    this.clockSign = env.chance(0.5) ? 1 : -1;
  }

  /**
   * Changes the scenario or the crowded band in place: the stations on the band stay, and the
   * new scenario decides how each treats the operator from the next call on.
   */
  configure(o: { scenario?: ScenarioId; crowded?: boolean }) {
    if (o.crowded !== undefined) this.options.crowded = o.crowded;
    if (o.scenario === undefined || o.scenario === this.options.scenario) return;
    this.options.scenario = o.scenario;
    const calledOften = this.calledOften;
    for (const s of this.stations) {
      if (s.partner !== this.options.myCall) s.policy = null;
      if (calledOften && s.state === 'cq') s.patience = Math.max(s.patience, s.idle + 40);
    }
  }

  /** Scenarios in which the operator calls the stations calling CQ: they stay long enough to be called. */
  private get calledOften(): boolean {
    const sc = this.options.scenario;
    return sc.startsWith('answer') || ['directed', 'hunt-busy', 'hunt-caller', 'lost', 'contest', 'worked', 'new-ones', 'clock'].includes(sc);
  }

  private get range(): readonly [number, number] {
    return this.options.crowded || this.options.scenario === 'weak' ? STATIONS_PER_SLOT.crowded : STATIONS_PER_SLOT.normal;
  }

  /** How open the band is at `ms` (UTC), 0 to 1. */
  openness(ms: number): number {
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / this.openPeriodMs + this.openPhase);
  }

  /** Noise over the band's floor at the start of slot `k`, dB: 0 to 3, or 3 to 6 in Weak and crowded. */
  private riseDb(k: number): number {
    const env = new Rng(streamSeed(this.options.seed, 'noise'));
    const p1 = env.range(30, 60);
    const p2 = env.range(7, 13);
    const f1 = env.range(0, 2 * Math.PI);
    const f2 = env.range(0, 2 * Math.PI);
    const x = 0.5 + 0.35 * Math.sin((2 * Math.PI * k) / p1 + f1) + 0.15 * Math.sin((2 * Math.PI * k) / p2 + f2);
    return round2((this.options.scenario === 'weak' ? 3 : 0) + 3 * x);
  }

  /**
   * What the band adds to the slot starting at `slotStartMs`: the noise floor's rise, static
   * crashes and the odd carrier. A pure function of the seed and the slot.
   */
  conditions(slotStartMs: number): SlotConditions {
    const len = SLOT_MS[this.options.mode];
    const k = Math.round(slotStartMs / len);
    const r = new Rng(streamSeed(this.options.seed, `slot${k}`));
    const weak = this.options.scenario === 'weak';
    const crashes: { atS: number; durS: number; peakDb: number }[] = [];
    if (r.chance(weak ? 0.4 : 0.15)) {
      for (let n = r.int(1, weak ? 4 : 2); n > 0; n--) crashes.push({ atS: round2(r.range(0, len / 1000 - 0.2)), durS: round2(r.range(0.02, 0.15)), peakDb: round2(r.range(6, 20)) });
    }
    // A carrier comes up now and then for 1 to 4 minutes, in blocks of 10 minutes of slots.
    const block = Math.floor(k / 40);
    const b = new Rng(streamSeed(this.options.seed, `carrier${block}`));
    const carriers: { freqHz: number; snrDb: number }[] = [];
    if (b.chance(0.35)) {
      const from = block * 40 + b.int(0, 30);
      const slots = b.int(4, 16);
      const freqHz = round2(b.range(LOW_HZ, HIGH_HZ));
      const snrDb = round2(b.range(-6, 8));
      if (k >= from && k < from + slots) carriers.push({ freqHz, snrDb });
    }
    const day = 86_400_000;
    return {
      t0S: (((slotStartMs % day) + day) % day) / 1000,
      riseDb: [this.riseDb(k), this.riseDb(k + 1)],
      noiseSeed: streamSeed(this.options.seed, `hiss${k}`),
      crashes,
      carriers,
    };
  }

  /**
   * The QSOs Worked stations and New ones put in the practice log, the same for the same seed:
   * Worked stations has 2 stations worked today on this band and mode (dupes), 2 on other days,
   * 1 today on another band and 1 on another mode, all of which call CQ on the band. New ones
   * has a QSO with a station of each entity the band's stations come from, on other days, so the
   * CQs from the entities it adds stand out as new.
   */
  logSeed(): SeedQso[] {
    if (this.seeds && this.seedScenario === this.options.scenario) return this.seeds;
    this.seedScenario = this.options.scenario;
    this.fixedCalls = [];
    const r = new Rng(streamSeed(this.options.seed, 'log'));
    const taken = new Set([this.options.myCall]);
    const out: SeedQso[] = [];
    if (this.options.scenario === 'worked') {
      const shapes: Omit<SeedQso, 'call' | 'grid'>[] = [
        { sameBand: true, sameMode: true, daysAgo: 0 },
        { sameBand: true, sameMode: true, daysAgo: 0 },
        { sameBand: true, sameMode: true, daysAgo: r.int(1, 6) },
        { sameBand: true, sameMode: true, daysAgo: r.int(7, 60) },
        { sameBand: false, sameMode: true, daysAgo: 0 },
        { sameBand: true, sameMode: false, daysAgo: r.int(1, 30) },
      ];
      for (const shape of shapes) {
        const id = newCallsign(r, taken);
        taken.add(id.call);
        this.fixedCalls.push(id);
        out.push({ call: id.call, grid: id.grid, ...shape });
      }
    } else if (this.options.scenario === 'new-ones') {
      for (const entity of BAND_ENTITIES) {
        const id = callsignIn(r, entity, taken);
        taken.add(id.call);
        out.push({ call: id.call, grid: id.grid, sameBand: true, sameMode: true, daysAgo: r.int(1, 90) });
      }
    }
    this.seeds = out;
    return out;
  }

  /**
   * The transmissions in the slot starting at `slotStartMs` (UTC ms), given what the operator
   * sent in the slot before it (null when nothing went out).
   */
  slot(slotStartMs: number, operator: OperatorTx | null): SimSignal[] {
    if (this.options.scenario === 'fox') {
      this.fox ??= new FoxBand(this.rng.fork(), this.options);
      return this.fox.slot(slotStartMs, operator);
    }
    const k = Math.round(slotStartMs / SLOT_MS[this.options.mode]);
    const parity = (((k % 2) + 2) % 2) as 0 | 1;
    const inbox: Heard[] = this.lastSlot === k - 1 ? [...this.lastHeard] : [];
    const op = operator ? parseExchange(operator.text, true) : null;
    const mine = !!op && !!op.from && sameCall(op.from, this.options.myCall);
    if (op && mine) inbox.push({ ex: op, fromOperator: true });
    if (op && mine && op.kind === 'cq') this.opCqSlot = k - 1;
    if (this.options.scenario === 'worked') this.logSeed();
    const open = this.openness(slotStartMs);

    for (const s of this.stations) {
      s.say = null;
      if (s.parity === parity && s.state !== 'gone') this.decide(s, this.hears(s, inbox));
    }
    if (op && mine && op.kind === 'cq') this.answerCq(parity, op, operator!.freqHz, k);
    if (op && mine) this.afterOperator(parity, op, k);
    this.lateCallers(parity, k);
    this.backgroundCallers(parity, inbox);
    this.fadeOut(parity, open, k);
    this.keepCount(parity, open);

    this.stations = this.stations.filter((s) => s.state !== 'gone');
    const sending = this.stations.filter((s) => s.parity === parity && s.say);
    this.lastSlot = k;
    this.lastHeard = sending.map((s) => ({ ex: parseExchange(s.say!, true), fromOperator: false }));
    const rise = this.riseDb(k);
    const clock = this.options.scenario === 'clock' ? this.clockSign * CLOCK_OFF_S : 0;
    const len = SLOT_MS[this.options.mode] / 1000;
    return sending.map((s) => {
      const level = s.clear ? s.snrDb : s.snrDb - rise + this.openingDb(s, open);
      // A drifting station's frequency moves on between its transmissions.
      if (s.driftHzPerS) s.freqHz = round2(Math.max(LOW_HZ, Math.min(HIGH_HZ, s.freqHz + s.driftHzPerS * 2 * len)));
      const out: SimSignal = {
        call: s.call,
        text: s.say!,
        freqHz: s.freqHz,
        dtS: round2(s.dtS + clock + this.rng.range(-0.04, 0.04)),
        snrDb: round2(Math.max(SNR_RANGE[0] - 1, Math.min(SNR_RANGE[1] + 1, level + this.rng.range(-1.5, 1.5)))),
        fading: s.fading,
      };
      if (s.driftHzPerS) out.driftHzPerS = s.driftHzPerS;
      if (s.multipath) out.multipath = s.multipath;
      return out;
    });
  }

  /** How far the band's opening has moved a background station since it arrived, dB. */
  private openingDb(s: Station, open: number): number {
    return s.reach * OPENING_DB * (open - s.openAtSpawn);
  }

  /** What a station hears of the slot before: every message from the operator, most from the band. */
  private hears(s: Station, inbox: Heard[]): Heard[] {
    return inbox.filter((m) => m.fromOperator || (s.sure && s.partner !== null && sameCall(m.ex.from, s.partner)) || s.rng.chance(0.94));
  }

  private decide(s: Station, inbox: Heard[]) {
    const toMe = inbox.filter((m) => m.ex.to && sameCall(m.ex.to, s.call));
    const fromPartner = s.partner ? toMe.find((m) => sameCall(m.ex.from, s.partner)) : undefined;
    const kind = fromPartner?.ex.kind;
    const me = this.options.myCall;
    switch (s.state) {
      case 'cq':
        return this.decideCq(s, toMe);
      case 'sentReport':
        if (kind === 'rreport') return this.sendFinal(s);
        // A contest station whose exchange was not copied hears the other's exchange without R:
        // it acknowledges with R and its exchange again.
        if (kind === 'report' && s.contest) return this.sendR(s);
        if (++s.tries >= (s.contest ? s.maxCalls : 3)) return s.caller ? this.leave(s) : this.backToCq(s, toMe);
        return this.sendReport(s);
      case 'sentRR73':
        if (kind === 'rreport' && ++s.tries < 3) return this.sendFinal(s);
        // 73, or nothing: the QSO is over.
        if (s.caller && s.partner === me && !s.fixed) return this.leave(s);
        return this.backToCq(s, toMe.filter((m) => m !== fromPartner));
      case 'calling':
        if (kind === 'report' || kind === 'rreport') {
          if (s.behaviour === 'quiet') {
            s.state = 'quiet';
            s.tries = 0;
            return;
          }
          s.tries = 0;
          // A caller who opened with a report ends with 73 on the R-report.
          if (s.behaviour === 'direct' && kind === 'rreport') return this.send73(s);
          return this.sendR(s);
        }
        return this.keepCalling(s, inbox);
      case 'sentR':
        if (kind === 'rr73' || kind === 'rrr' || kind === '73') {
          if (s.behaviour === 'repeat' && !s.missed && s.partner === me) {
            s.missed = true;
            return this.sendR(s);
          }
          return this.send73(s);
        }
        if (++s.tries >= 4) return this.leave(s);
        return this.sendR(s);
      case 'sent73':
        if ((kind === 'rr73' || kind === 'rrr' || kind === 'rreport') && ++s.tries < 2) {
          s.say = line(s.partner!, s.call, '73');
          return;
        }
        // Some stations stay and call CQ after a QSO.
        if (s.fixed || (s.partner !== me && s.rng.chance(0.3))) return this.backToCq(s, []);
        return this.leave(s);
      case 'quiet':
        if (++s.tries >= 6) this.leave(s);
        return;
      default:
        return;
    }
  }

  private send73(s: Station) {
    if (s.partner === this.options.myCall && this.options.scenario === 'new-ones') this.rareWorked.add(s.entity);
    s.tries = 0;
    s.state = 'sent73';
    s.say = line(s.partner!, s.call, '73');
  }

  private decideCq(s: Station, toMe: Heard[]) {
    const callers = toMe.filter((m) => m.ex.kind === 'grid' || m.ex.kind === 'call' || m.ex.kind === 'report');
    // In a scripted scenario the operator comes first; on the random band callers are taken in any order.
    const ordered = this.options.scenario === 'random' ? shuffle(callers, s.rng) : [...callers.filter((m) => m.fromOperator), ...callers.filter((m) => !m.fromOperator)];
    for (const c of ordered) {
      if (!c.fromOperator) return this.startQso(s, bare(c.ex.from!), false, c.ex.kind === 'report');
      const how = this.treatOperator(s);
      if (how === 'answer') return this.startQso(s, this.options.myCall, true, c.ex.kind === 'report');
      if (how === 'busy') {
        // Another station called in the same slot as the operator, and gets the answer. In the
        // lost-station scenarios the two always hear each other, so the QSO ends with RR73 or 73.
        const other = this.spawn(s.parity === 0 ? 1 : 0, { state: 'calling', partner: s.call, near: s.freqHz });
        const scripted = this.options.scenario === 'answer-busy' || this.options.scenario === 'lost';
        other.sure = scripted;
        s.sure = scripted;
        if (s.policy !== 'lost') s.policy = 'tail';
        return this.startQso(s, other.call, false, false);
      }
    }
    if (++s.idle > s.patience && !s.engaged && !s.fixed) return this.leave(s);
    s.say = this.cqText(s);
  }

  private cqText(s: Station): string {
    if (nonstandard(s.call)) return `CQ ${s.call}`;
    return `CQ ${s.modifier ? `${s.modifier} ` : ''}${s.call} ${s.grid}`;
  }

  /** How a station calling CQ treats a call from the operator now. */
  private treatOperator(s: Station): 'answer' | 'busy' | 'ignore' {
    // A directed CQ answers only the stations it asked for.
    if (s.modifier === 'NA' && this.myContinent !== 'NA') return 'ignore';
    if (s.modifier === 'DX' && this.myContinent !== null && this.myContinent === s.continent) return 'ignore';
    if (s.policy === null) {
      const sc = this.options.scenario;
      if (sc === 'answer-busy') s.policy = 'busy';
      else if (sc === 'lost') s.policy = 'lost';
      else if (sc === 'answer-deaf' || sc === 'hunt-caller') s.policy = 'deaf';
      // Weak stations do not hear the operator either.
      else if (sc === 'hunt-busy') s.policy = s.snrDb < HUNT_DEAF_DB ? 'deaf' : 'answer';
      else if (sc === 'random') {
        const r = s.rng.next();
        s.policy = r < 0.6 ? 'answer' : r < 0.85 ? 'busy' : 'deaf';
      } else s.policy = 'answer';
    }
    if (s.policy === 'deaf') return 'ignore';
    // The lost station answers another caller each time the operator calls.
    if (s.policy === 'lost') return 'busy';
    // After working the other station, a tail-ender gets an answer: always in the lost-station
    // scenario, more often than not on the random band.
    if (s.policy === 'tail') return this.options.scenario === 'answer-busy' || s.rng.chance(0.6) ? 'answer' : 'ignore';
    return s.policy;
  }

  /**
   * A station calling CQ answers a caller: a report, or a contest station's exchange. A caller
   * who sent its report or exchange first (`gotReport`) gets the R-report or R and the exchange.
   */
  private startQso(s: Station, partner: string, operator: boolean, gotReport: boolean) {
    s.partner = partner;
    s.tries = 0;
    s.idle = 0;
    s.engaged = s.engaged || operator;
    s.report = operator ? s.rng.int(-18, 0) : s.rng.int(-22, 5);
    if (gotReport) return this.sendR(s);
    this.sendReport(s);
  }

  /** A contest station's exchange, with R in front when it acknowledges the other's. */
  private exchangeText(s: Station, r: boolean): string {
    const c = s.contest!;
    const to = bare(s.partner!);
    const rr = r ? 'R ' : '';
    if (c.format === 'fd') return `${to} ${s.call} ${rr}${c.exch}`;
    const digit = strength(s.report);
    if (c.format === 'ru') return `${to} ${s.call} ${rr}5${digit}9 ${c.exch ?? String(c.serial).padStart(4, '0')}`;
    return `<${to}> <${s.call}> ${rr}5${digit}${String(c.serial).padStart(4, '0')} ${c.grid6}`;
  }

  private sendReport(s: Station) {
    s.state = 'sentReport';
    s.say = s.contest ? this.exchangeText(s, false) : line(s.partner!, s.call, formatReport(s.report));
  }

  /** RR73 to end the QSO; RRR now and then; 73 from some stations. */
  private sendFinal(s: Station) {
    s.state = 'sentRR73';
    const toOperator = s.partner === this.options.myCall;
    if (toOperator && this.options.scenario === 'new-ones') this.rareWorked.add(s.entity);
    const ends73 = toOperator ? this.options.scenario === 'random' && s.ends73Op : s.ends73;
    const word = ends73 ? '73' : !s.sure && s.rng.chance(0.1) ? 'RRR' : 'RR73';
    s.say = line(s.partner!, s.call, word);
  }

  private sendR(s: Station) {
    s.state = 'sentR';
    s.say = s.contest ? this.exchangeText(s, true) : line(s.partner!, s.call, `R${formatReport(s.report)}`);
  }

  private backToCq(s: Station, toMe: Heard[]) {
    s.partner = null;
    s.engaged = false;
    s.sure = false;
    s.caller = false;
    s.state = 'cq';
    s.tries = 0;
    s.idle = 0;
    this.decideCq(s, toMe);
  }

  /** A caller's first message and its repeats: the grid, a contest exchange, or a report. */
  private callText(s: Station): string {
    if (s.contest && s.contest.format !== 'vhf') return this.exchangeText(s, false);
    if (s.behaviour === 'direct') return line(s.partner!, s.call, formatReport(s.report));
    return line(s.partner!, s.call, nonstandard(s.call) ? '' : s.grid);
  }

  private keepCalling(s: Station, inbox: Heard[]) {
    if (++s.tries > s.maxCalls) return this.leave(s);
    const partnerSent = inbox.find((m) => sameCall(m.ex.from, s.partner));
    // The station called is working someone else: wait, or call over them; call again as their QSO ends.
    const busy = partnerSent && partnerSent.ex.kind !== 'cq' && !sameCall(partnerSent.ex.to, s.call);
    const ending = busy && (partnerSent.ex.kind === 'rr73' || partnerSent.ex.kind === 'rrr' || partnerSent.ex.kind === '73');
    if (busy && !ending && !s.rng.chance(0.5)) return;
    s.say = this.callText(s);
  }

  private leave(s: Station) {
    s.state = 'gone';
    s.say = null;
  }

  /** A new caller to the operator, calling in this slot. */
  private callOperator(parity: 0 | 1, behaviour: Behaviour, nearHz: number | undefined, o: { only?: (c: Continent) => boolean; contest?: ContestFormat; snr?: readonly [number, number] } = {}): Station {
    const me = this.options.myCall;
    const s = this.spawn(parity, { state: 'calling', partner: me, near: nearHz, clear: true, only: o.only, behaviour, contest: o.contest, snr: o.snr });
    s.engaged = true;
    this.opened(s);
    return s;
  }

  /**
   * A caller's first message. Field Day and Roundup callers open with their exchange, as their
   * contest modes do, and wait for R and the exchange back.
   */
  private opened(s: Station) {
    s.caller = true;
    s.say = this.callText(s);
    if (s.contest && s.contest.format !== 'vhf') s.state = 'sentReport';
  }

  /** The operator called CQ in the slot before: the scenario's callers answer in this one. */
  private answerCq(parity: 0 | 1, cq: Exchange, nearHz: number, k: number) {
    const me = this.options.myCall;
    const busy = this.stations.some((s) => s.partner === me && s.state !== 'gone' && s.state !== 'quiet' && s.state !== 'calling');
    if (busy) return;
    const calling = this.stations.filter((s) => s.partner === me && s.state === 'calling');
    // Callers still waiting call again.
    for (const s of calling) if (!s.say && s.parity === parity) s.say = this.callText(s);
    if (calling.length) return;
    const callers = this.callersFor();
    const only = directedFilter(cq.modifier, this.myContinent);
    const sc = this.options.scenario;
    const formats = this.contestCallers(cq.modifier, callers.length);
    callers.forEach((behaviour, i) => {
      const contest = formats[i];
      const s = this.callOperator(parity, behaviour, nearHz, {
        only: contest ? contestFilter(contest) : only,
        contest,
        snr: sc === 'weak' ? WEAK_CALLERS : undefined,
      });
      s.maxCalls = sc === 'activation' || contest ? 8 : callers.length > 1 ? 8 : 6;
    });
    // Worked stations: a dupe calls too, from the stations in the practice log.
    if (sc === 'worked') {
      const absent = this.fixedCalls.find((id) => this.isDupe(id.call) && !this.stations.some((s) => s.call === id.call));
      const dupe =
        this.stations.find((s) => s.fixed && s.parity === parity && s.state === 'cq' && !s.engaged && this.isDupe(s.call)) ??
        (absent ? Object.assign(this.spawn(parity, { state: 'cq', clear: true, id: absent }), { fixed: true, patience: 1000 }) : undefined);
      if (dupe) {
        dupe.state = 'calling';
        dupe.partner = me;
        dupe.caller = true;
        dupe.engaged = true;
        dupe.tries = 0;
        dupe.maxCalls = 6;
        dupe.say = this.callText(dupe);
      }
    }
    // Late callers: some arrive a cycle after the CQ.
    if ((sc === 'random' && this.rng.chance(0.15)) || (sc === 'activation' && this.rng.chance(0.3))) this.pending.push({ slot: k + 2, behaviour: 'normal' });
  }

  private isDupe(call: string): boolean {
    return (this.seeds ?? []).some((q) => q.call === call && q.daysAgo === 0 && q.sameBand && q.sameMode);
  }

  /** Contest exchanges: the format of each caller to the operator's CQ, from its modifier. */
  private contestCallers(modifier: string | null, n: number): (ContestFormat | undefined)[] {
    if (this.options.scenario !== 'contest') return Array.from({ length: n }, () => undefined);
    const m = modifier?.toUpperCase();
    const fixed: ContestFormat | null = m === 'FD' ? 'fd' : m === 'RU' ? 'ru' : m === 'TEST' ? 'vhf' : null;
    const all: ContestFormat[] = ['fd', 'ru', 'vhf'];
    return Array.from({ length: n }, (_, i) => fixed ?? all[(i + this.rng.int(0, 2)) % 3]);
  }

  /**
   * After the operator's transmission: tail-enders call as the operator's QSO from CQ ends (the
   * random band, an activation), and in Hunt with a caller another station calls the operator
   * while the station called stays silent.
   */
  private afterOperator(parity: 0 | 1, op: Exchange, k: number) {
    const me = this.options.myCall;
    const sc = this.options.scenario;
    const waiting = this.stations.some((s) => s.partner === me && s.state === 'calling');
    const running = this.opCqSlot !== null && k - this.opCqSlot <= 24;
    if ((op.kind === 'rr73' || op.kind === '73' || op.kind === 'rrr') && running && !waiting) {
      const p = sc === 'activation' ? ACTIVATION_TAIL : sc === 'random' || sc === 'cq-pileup' ? 0.25 : 0;
      if (p && this.rng.chance(p)) this.callOperator(parity, 'normal', undefined).maxCalls = 6;
    }
    if (sc === 'hunt-caller' && (op.kind === 'grid' || op.kind === 'call') && op.to && !sameCall(op.to, this.huntCalled)) {
      const engaged = this.stations.some((s) => s.partner === me && s.state !== 'quiet');
      if (!engaged) {
        this.huntCalled = bare(op.to);
        this.callOperator(parity, 'normal', undefined).maxCalls = 6;
      }
    }
  }

  private lateCallers(parity: 0 | 1, k: number) {
    const due = this.pending.filter((p) => p.slot === k);
    this.pending = this.pending.filter((p) => p.slot > k);
    const me = this.options.myCall;
    const inQso = this.stations.some((s) => s.partner === me && s.state !== 'calling' && s.state !== 'quiet');
    for (const p of due) if (!inQso || this.options.scenario === 'activation') this.callOperator(parity, p.behaviour, undefined).maxCalls = 6;
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
      case 'activation':
        return r.chance(0.4) ? ['normal', 'normal'] : ['normal'];
      case 'weak':
        return Array.from({ length: r.int(1, 3) }, (): Behaviour => 'normal');
      case 'contest':
        return r.chance(0.5) ? ['normal', 'normal'] : ['normal'];
      case 'worked':
        return ['normal'];
      case 'random': {
        const x = r.next();
        if (x < 0.3) return [];
        if (x < 0.58) return ['normal'];
        if (x < 0.65) return ['direct'];
        if (x < 0.79) return pile();
        return [x < 0.9 ? 'quiet' : 'repeat'];
      }
      default:
        return r.chance(0.5) ? ['normal'] : [];
    }
  }

  /** Some of the CQs heard in the slot before get a caller from the band, in the CQ's format. */
  private backgroundCallers(parity: 0 | 1, inbox: Heard[]) {
    const p = this.options.crowded ? 0.2 : 0.12;
    for (const m of inbox) {
      if (m.fromOperator || m.ex.kind !== 'cq') continue;
      const cq = this.stations.find((s) => sameCall(s.call, m.ex.from) && s.state === 'cq');
      if (!cq || !this.rng.chance(p)) continue;
      const contest = cq.contest?.format;
      const s = this.spawn(parity, { state: 'calling', partner: cq.call, only: contest ? contestFilter(contest) : directedFilter(cq.modifier, cq.continent), contest });
      this.opened(s);
    }
  }

  /** Background stations whose level the closing band has taken under the noise leave it. */
  private fadeOut(parity: 0 | 1, open: number, k: number) {
    const rise = this.riseDb(k);
    for (const s of this.stations) {
      if (s.parity !== parity || s.clear || s.engaged || s.fixed || (s.state !== 'cq' && s.state !== 'calling')) continue;
      if (s.snrDb - rise + this.openingDb(s, open) < FADED_DB) this.leave(s);
    }
  }

  /** Keeps the stations sending in this slot within the band's range, following the band's opening. */
  private keepCount(parity: 0 | 1, open: number) {
    const [lo, hi] = this.range;
    // The count follows the opening, wandering by up to 2 stations either way.
    this.target[parity] = Math.max(-2, Math.min(2, this.target[parity] + this.rng.int(-1, 1)));
    const want = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * open + this.target[parity])));
    const sending = () => this.stations.filter((s) => s.parity === parity && s.say);
    const cqs = () => this.stations.filter((s) => s.parity === parity && s.state === 'cq' && s.say);
    const sc = this.options.scenario;
    // Stations to call: at least 3 CQs (6 on the Hunt bands), a CQ DX and a CQ NA in the
    // directed scenario, CQ FD, CQ RU and CQ TEST for contest exchanges, two new ones for New ones.
    const need: (string | null)[] = [];
    const least = sc === 'hunt-busy' || sc === 'hunt-caller' ? HUNT_CQS : 3;
    const has = (m: string) => cqs().some((s) => s.modifier === m);
    if (sc === 'directed') for (const m of ['DX', 'NA']) if (!has(m)) need.push(m);
    if (sc === 'contest') for (const m of ['FD', 'RU', 'TEST']) if (!has(m)) need.push(m);
    if (sc === 'new-ones') {
      const rare = this.stations.filter((s) => s.parity === parity && s.state === 'cq' && s.modifier === null && this.isRare(s));
      for (let n = rare.length; n < 2; n++) need.push('rare');
    }
    if (sc === 'worked') this.keepFixed(parity);
    // The Hunt bands count plain CQs, the ones Hunt answers.
    const counted = least === HUNT_CQS ? cqs().filter((s) => s.modifier === null && !nonstandard(s.call)).length : cqs().length;
    for (let n = counted + need.length; n < least; n++) need.push(null);
    for (const modifier of need) this.spawnCq(parity, modifier);
    while (sending().length < want) {
      const cqOpen = this.stations.filter((s) => s.parity !== parity && s.state === 'cq' && !s.engaged && !s.contest && !nonstandard(s.call));
      if (cqOpen.length && this.rng.chance(0.25)) {
        const cq = this.rng.pick(cqOpen);
        const s = this.spawn(parity, { state: 'calling', partner: cq.call, only: directedFilter(cq.modifier, cq.continent) });
        this.opened(s);
      } else this.spawnCq(parity, this.newModifier());
    }
    // Too many: idle CQs and unanswered callers leave, never a station in a QSO.
    const spare = sending().filter((s) => !s.engaged && !s.fixed && !s.contest && (s.state === 'calling' || s.state === 'cq'));
    let excess = sending().length - hi;
    while (excess > 0 && spare.length) {
      const s = spare.splice(this.rng.int(0, spare.length - 1), 1)[0];
      if (s.state === 'cq' && cqs().length <= least) continue;
      this.leave(s);
      excess--;
    }
  }

  private isRare(s: Station): boolean {
    return !!s.entity && !BAND_ENTITIES.includes(s.entity);
  }

  /** Worked stations: the stations in the practice log call CQ, alternating between the two parities. */
  private keepFixed(parity: 0 | 1) {
    this.fixedCalls.forEach((id, i) => {
      if (i % 2 !== parity || this.stations.some((s) => s.call === id.call)) return;
      const s = this.spawn(parity, { state: 'cq', clear: true, id });
      s.fixed = true;
      s.patience = 1000;
      s.say = this.cqText(s);
    });
  }

  private newModifier(): string | null {
    const x = this.rng.next();
    if (this.options.scenario === 'directed') return x < 0.3 ? 'DX' : x < 0.6 ? 'NA' : null;
    return x < 0.07 ? 'DX' : x < 0.1 ? 'NA' : null;
  }

  private spawnCq(parity: 0 | 1, modifier: string | null): Station {
    const sc = this.options.scenario;
    const contest: ContestFormat | undefined = modifier === 'FD' ? 'fd' : modifier === 'RU' ? 'ru' : modifier === 'TEST' ? 'vhf' : undefined;
    const only = contest
      ? contestFilter(contest)
      : modifier === 'NA'
        ? (c: Continent) => c === 'NA'
        : modifier === 'DX'
          ? (c: Continent) => c !== this.myContinent
          : undefined;
    const rare = modifier === 'rare';
    const s = this.spawn(parity, { state: 'cq', clear: true, only, contest, rare, snr: sc === 'weak' ? WEAK_CQS : undefined, compound: modifier === null && !rare });
    s.modifier = rare ? null : modifier;
    // Stations you are asked to call stay long enough to be called.
    if (this.calledOften) s.patience = 40;
    // Some compound stations are heard first in a QSO, with their callsign hashed, and in full
    // only at their 73 or next CQ.
    if (nonstandard(s.call) && s.rng.chance(0.5)) {
      const other = this.spawn(parity === 0 ? 1 : 0, { state: 'calling', partner: s.call, near: s.freqHz });
      other.caller = true;
      this.startQso(s, other.call, false, false);
      return s;
    }
    s.say = this.cqText(s);
    return s;
  }

  private spawn(
    parity: 0 | 1,
    o: {
      state: StationState;
      partner?: string;
      near?: number;
      clear?: boolean;
      only?: (c: Continent) => boolean;
      behaviour?: Behaviour;
      contest?: ContestFormat;
      snr?: readonly [number, number];
      rare?: boolean;
      compound?: boolean;
      id?: Callsign;
    },
  ): Station {
    const r = this.rng;
    const taken = new Set([this.options.myCall, ...this.stations.map((s) => s.call), ...this.fixedCalls.map((c) => c.call), ...(this.seeds ?? []).map((q) => q.call)]);
    const id = o.id ?? (o.rare ? rareCallsign(r, taken, this.rareWorked) : newCallsign(r, taken, o.only));
    const sc = this.options.scenario;
    // The station's surroundings come from a stream of their own, so adding them leaves the
    // band's choices as before.
    const a = new Rng(streamSeed(this.options.seed, id.call));
    // Compound callsigns on the bands that are not scripted around one station.
    const compoundBand = (sc === 'random' || sc === 'activation' || sc === 'weak') && !o.contest && !nonstandard(this.options.myCall);
    const compound = compoundBand && ((o.compound && a.chance(0.08)) || (o.state === 'calling' && !o.clear && a.chance(0.05)));
    const call = compound ? compoundOf(a, id) : id.call;
    const [lo, hi] = o.snr ?? (o.clear ? CLEAR_SNR : SNR_RANGE);
    const open = this.lastSlot === null ? 0.5 : this.openness((this.lastSlot + 1) * SLOT_MS[this.options.mode]);
    // A closed band brings fewer strong stations: the top of the range comes down by up to 10 dB.
    const top = o.clear || o.snr ? hi : hi - 10 * (1 - open);
    const s: Station = {
      call,
      grid: id.grid,
      continent: id.continent,
      entity: id.entity,
      parity,
      freqHz: this.freeHz(parity, o.near, !o.clear),
      snrDb: round2(r.range(lo, Math.max(lo + 1, top))),
      dtS: this.drawDt(a, !!o.clear),
      fading: r.chance(0.3) ? { periodS: round2(r.range(3, 10)), depthDb: round2(r.range(6, o.clear ? 10 : 15)), phase: round2(r.range(0, 2 * Math.PI)) } : null,
      driftHzPerS: a.chance(o.clear ? 0.05 : 0.15) ? round2((a.chance(0.5) ? 1 : -1) * a.range(0.02, o.clear ? 0.1 : 0.3)) : 0,
      multipath: a.chance(o.clear ? 0.1 : 0.2) ? { spreadHz: round2(a.range(0.1, o.clear ? 0.4 : 1.5)), delayMs: round2(a.range(0.5, o.clear ? 1.5 : 3)), seed: Math.floor(a.next() * 2 ** 31) } : null,
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
      ends73Op: a.chance(0.15),
      engaged: false,
      sure: false,
      clear: !!o.clear,
      // Stations on other continents depend more on the band's opening.
      reach: round2(id.continent === this.myContinent ? a.range(0.2, 0.6) : a.range(0.5, 1)),
      openAtSpawn: open,
      fixed: false,
      contest: o.contest ? this.contestFor(a, id, o.contest) : null,
      caller: false,
      say: null,
    };
    this.stations.push(s);
    return s;
  }

  /**
   * DT: most clocks within −0.5 to +0.8 s, some later up to +2.5 s, the odd one several seconds
   * off. Stations the scenario relies on keep to −0.3 to +0.6 s, now and then up to 1.4 s; with
   * Clock off they keep close to 0 before the band's offset.
   */
  private drawDt(a: Rng, clear: boolean): number {
    if (this.options.scenario === 'clock') return round2(a.range(-0.15, 0.3));
    const x = a.next();
    if (clear) return round2(x < 0.05 ? a.range(0.6, 1.4) : a.range(-0.3, 0.6));
    if (x < 0.03) return round2(a.chance(0.75) ? a.range(2.6, 4) : a.range(-2, -1));
    if (x < 0.18) return round2(a.range(0.8, 2.5));
    // A triangle from −0.5 to +0.8 s, highest at +0.15 s.
    return round2(-0.5 + 0.65 * (a.next() + a.next()));
  }

  private contestFor(a: Rng, id: Callsign, format: ContestFormat): Contest {
    const place = contestPlace(a, id.call);
    const grid6 = `${id.grid}${String.fromCharCode(65 + a.int(0, 23))}${String.fromCharCode(65 + a.int(0, 23))}`;
    const serial = a.int(1, 400);
    if (format === 'fd') return { format, exch: `${a.int(1, 6)}${a.pick(['A', 'A', 'B', 'D', 'E', 'F'])} ${place?.section ?? 'DX'}`, serial, grid6 };
    if (format === 'ru') return { format, exch: place?.state ?? null, serial, grid6 };
    return { format, exch: null, serial, grid6 };
  }

  /**
   * A frequency clear of the stations in the same parity where possible; near `nearHz` for
   * callers. Some background stations sit on another's frequency, within 3 to 20 Hz.
   */
  private freeHz(parity: 0 | 1, nearHz?: number, mayOverlap = false): number {
    const gap = SPACING_HZ[this.options.mode];
    const used = this.stations.filter((s) => s.parity === parity && s.state !== 'gone').map((s) => s.freqHz);
    if (mayOverlap && nearHz === undefined && used.length && this.rng.chance(0.08)) {
      const f = this.rng.pick(used) + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(3, 20);
      return Math.round(Math.max(LOW_HZ, Math.min(HIGH_HZ, f)));
    }
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

/** Field Day and Roundup stations are in North America, EU VHF stations in Europe. */
function contestFilter(f: ContestFormat): (c: Continent) => boolean {
  return f === 'vhf' ? (c) => c === 'EU' : (c) => c === 'NA';
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
