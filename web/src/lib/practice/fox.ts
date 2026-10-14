/**
 * The practice band's Fox scenario: a DXpedition in FT8 DXpedition mode and the Hounds calling
 * it, following K1JT's FT8 DXpedition Mode User Guide (docs/design/hound.md).
 *
 * The Fox transmits in even slots on 3 streams 60 Hz apart from 300 Hz, each at the Fox's SNR
 * less 9.5 dB, as a Fox divides its power between streams. It answers Hounds that call it at
 * 1000 Hz or above, one per stream: a report, then on their R-report RR73, alone or followed in
 * the same message by the next Hound's report (the operator's report comes either way, chosen
 * per band). A Hound gets 3 reports before the Fox drops it,
 * and RR73 again, up to 3 times, when it repeats its R-report. The Fox calls CQ alone in its
 * first slot and every 8th after, as WSJT-X's Fox calls CQ at least every 5 min, and whenever
 * it has nobody to work.
 *
 * Hounds call in odd slots between 1000 and 2850 Hz and send their R-report at the frequency
 * the Fox called them on. The operator is answered after 2 to 4 calls at 1000 Hz or above.
 */

import { SLOT_MS, type FtMode as Mode } from '../clock/slots';
import { formatReport, parseExchange, parseParts, sameCall } from '../qso/messages';
import { Rng, newCallsign } from './calls';
import type { OperatorTx, SimSignal } from './sim';

/** Streams the Fox transmits at once. */
const STREAMS = 3;
/** The Fox's lowest stream and the spacing between streams, Hz. */
const FOX_HZ = 300;
const STREAM_HZ = 60;
/** Each stream carries 1/STREAMS² of the Fox's power. */
const STREAM_LOSS_DB = 20 * Math.log10(STREAMS);
/** A Fox answers no first call below this, Hz. */
const HOUND_MIN_HZ = 1000;
const HOUND_MAX_HZ = 2850;
/** Reports a Hound gets without an R-report, and RR73s for a repeated R-report. */
const STRIKES = 3;
/** The Fox calls CQ alone once in this many of its slots. */
const CQ_EVERY = 8;
/** Hounds calling in each odd slot, besides the operator. */
const HOUNDS = [3, 6] as const;

const FOXES: readonly { prefix: string; grid: string }[] = [
  { prefix: 'VP8', grid: 'GD18' },
  { prefix: '3Y0', grid: 'JD15' },
  { prefix: 'FT5', grid: 'MF85' },
  { prefix: 'VK0', grid: 'QD95' },
  { prefix: 'ZL9', grid: 'RE44' },
  { prefix: 'KH1', grid: 'AJ10' },
];

interface Hound {
  call: string;
  grid: string;
  /** Calling frequency, Hz. */
  freqHz: number;
  /** SNR at the Fox, and the Fox's SNR at the Hound, dB. */
  snrDb: number;
  foxDb: number;
  dtS: number;
  /** The stream the Fox called it on, Hz, and the report it got. */
  calledHz: number | null;
  report: number | null;
  /** RR73 received: the Hound leaves. */
  done: boolean;
}

/** A QSO on one of the Fox's streams. */
interface Work {
  call: string;
  /** Even, for the multi-call message, dB. */
  report: number;
  /** Reports sent without an R-report back. */
  tries: number;
  /** The R-report arrived: RR73 goes out next. */
  acked: boolean;
}

export class FoxBand {
  readonly call: string;
  readonly grid: string;
  private readonly rng: Rng;
  private readonly myCall: string;
  private readonly mode: Mode;
  private readonly snrDb: number;
  private hounds: Hound[] = [];
  /** The Hounds the Fox heard calling, oldest first. */
  private queue: string[] = [];
  private streams: (Work | null)[] = Array.from({ length: STREAMS }, () => null);
  /** Logged by the Fox, with the RR73s sent for repeated R-reports. */
  private logged = new Map<string, number>();
  /** Logged Hounds that repeated their R-report: RR73 goes to them again. */
  private repeatRr73 = new Set<string>();
  /** The operator's calls heard at 1000 Hz or above, and how many the Fox waits for. */
  private operatorCalls = 0;
  private readonly operatorAfter: number;
  /** The operator's report comes in a multi-call message, or alone on a free stream. */
  private readonly operatorInMulti: boolean;
  private foxSlots = 0;
  private lastSlot: number | null = null;
  private lastSent: { call: string; text: string; freqHz: number }[] = [];

  constructor(rng: Rng, o: { myCall: string; mode: Mode }) {
    this.rng = rng;
    this.myCall = o.myCall.toUpperCase();
    this.mode = o.mode;
    const fox = rng.pick(FOXES);
    this.call = `${fox.prefix}${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}`;
    this.grid = fox.grid;
    this.snrDb = round2(rng.range(-2, 6));
    this.operatorAfter = rng.int(2, 4);
    this.operatorInMulti = rng.chance(0.5);
  }

  /** The transmissions in the slot starting at `slotStartMs`, given what the operator sent in the slot before. */
  slot(slotStartMs: number, operator: OperatorTx | null): SimSignal[] {
    const k = Math.round(slotStartMs / SLOT_MS[this.mode]);
    const even = ((k % 2) + 2) % 2 === 0;
    const heard = this.lastSlot === k - 1 ? [...this.lastSent] : [];
    if (operator) heard.push({ call: this.myCall, text: operator.text, freqHz: operator.freqHz });
    const out = even ? this.foxSlot(heard) : this.houndSlot(heard);
    this.lastSlot = k;
    this.lastSent = out.map((s) => ({ call: s.call, text: s.text, freqHz: s.freqHz }));
    return out;
  }

  /** The Fox reads the Hounds' slot and transmits on its streams. */
  private foxSlot(heard: { call: string; text: string; freqHz: number }[]): SimSignal[] {
    for (const m of heard) {
      const ex = parseExchange(m.text);
      if (!ex.from || !sameCall(ex.to, this.call)) continue;
      const op = sameCall(ex.from, this.myCall);
      if (ex.kind === 'rreport') {
        const w = this.streams.find((s) => s && sameCall(s.call, ex.from));
        if (w) w.acked = true;
        else if (this.logged.has(ex.from) && this.logged.get(ex.from)! < STRIKES) this.repeatRr73.add(ex.from);
        continue;
      }
      if (ex.kind !== 'grid' && ex.kind !== 'call') continue;
      // The Fox does not answer first calls below 1000 Hz.
      if (m.freqHz < HOUND_MIN_HZ || this.logged.has(ex.from) || this.busy(ex.from)) continue;
      if (op && ++this.operatorCalls < this.operatorAfter) continue;
      if (!this.queue.includes(ex.from)) {
        // The operator, once due, goes to the front of the queue.
        if (op) this.queue.unshift(ex.from);
        else this.queue.push(ex.from);
      }
    }

    if (this.foxSlots++ % CQ_EVERY === 0) return [this.signal(FOX_HZ, `CQ ${this.call} ${this.grid}`)];
    const out: SimSignal[] = [];
    this.streams.forEach((w, i) => {
      const hz = FOX_HZ + i * STREAM_HZ;
      if (w?.acked) {
        this.logged.set(w.call, 0);
        const alone = !this.operatorInMulti && this.queue[0] === this.myCall;
        const next = alone ? null : this.next();
        this.streams[i] = next;
        // lint-copy: off
        out.push(this.signal(hz, next ? `${w.call} RR73; ${next.call} <${this.call}> ${formatReport(next.report)}` : `${w.call} ${this.call} RR73`));
        // lint-copy: on
        return;
      }
      if (w && w.tries >= STRIKES) this.streams[i] = null;
      const now = this.streams[i] ?? this.next();
      this.streams[i] = now;
      if (!now) return;
      now.tries++;
      out.push(this.signal(hz, `${now.call} ${this.call} ${formatReport(now.report)}`));
    });
    // RR73 again for a Hound that repeats its R-report, on a stream left free.
    for (const call of this.repeatRr73) {
      const i = this.streams.findIndex((s) => s === null);
      if (i < 0 || out.some((s) => s.freqHz === FOX_HZ + i * STREAM_HZ)) continue;
      this.logged.set(call, this.logged.get(call)! + 1);
      out.push(this.signal(FOX_HZ + i * STREAM_HZ, `${call} ${this.call} RR73`));
    }
    this.repeatRr73.clear();
    if (!out.length) out.push(this.signal(FOX_HZ, `CQ ${this.call} ${this.grid}`));
    return out;
  }

  private busy(call: string): boolean {
    return this.streams.some((s) => s && sameCall(s.call, call));
  }

  /** The next Hound from the queue, with an even report for it. */
  private next(): Work | null {
    const call = this.queue.shift();
    if (!call) return null;
    const h = this.hounds.find((x) => x.call === call);
    const db = h ? h.snrDb : this.rng.range(-18, -2);
    return { call, report: Math.max(-30, Math.min(32, 2 * Math.round(db / 2))), tries: 0, acked: false };
  }

  private signal(freqHz: number, text: string): SimSignal {
    return {
      call: this.call,
      text,
      freqHz,
      dtS: round2(0.1 + this.rng.range(-0.04, 0.04)),
      snrDb: round2(this.snrDb - STREAM_LOSS_DB + this.rng.range(-1, 1)),
      fading: null,
    };
  }

  /** The Hounds read the Fox's slot: a report gets the R-report on the Fox's frequency, RR73 ends it. */
  private houndSlot(heard: { call: string; text: string; freqHz: number }[]): SimSignal[] {
    const fromFox = heard.filter((m) => m.call === this.call);
    for (const h of this.hounds) {
      // Hounds miss a Fox message now and then, as on the air.
      for (const m of fromFox) {
        if (!this.rng.chance(0.9)) continue;
        for (const x of parseParts(m.text)) {
          if (!sameCall(x.to, h.call)) continue;
          if (x.kind === 'rr73') h.done = true;
          if (x.kind === 'report') {
            h.calledHz = m.freqHz;
            h.report = x.report;
          }
        }
      }
    }
    this.hounds = this.hounds.filter((h) => !h.done);
    const [lo, hi] = HOUNDS;
    const want = this.rng.int(lo, hi);
    while (this.hounds.length < want) this.hounds.push(this.newHound());
    return this.hounds.map((h) => ({
      call: h.call,
      text: h.calledHz !== null ? `${this.call} ${h.call} R${formatReport(h.foxDb)}` : `${this.call} ${h.call} ${h.grid}`,
      freqHz: h.calledHz ?? h.freqHz,
      dtS: round2(h.dtS + this.rng.range(-0.04, 0.04)),
      snrDb: round2(h.snrDb + this.rng.range(-1.5, 1.5)),
      fading: null,
    }));
  }

  private newHound(): Hound {
    const taken = new Set([this.myCall, this.call, ...this.hounds.map((h) => h.call), ...this.logged.keys()]);
    const id = newCallsign(this.rng, taken);
    return {
      call: id.call,
      grid: id.grid,
      freqHz: Math.round(this.rng.range(HOUND_MIN_HZ, HOUND_MAX_HZ)),
      snrDb: round2(this.rng.range(-20, 0)),
      foxDb: Math.round(this.snrDb - STREAM_LOSS_DB + this.rng.range(-6, 0)),
      dtS: round2(this.rng.range(-0.2, 0.5)),
      calledHz: null,
      report: null,
      done: false,
    };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
