/**
 * One radio over one serial link (docs/design/cat.md): the requests in flight and their answers,
 * the dial polling, transceive frames, and PTT. The IC-705's CI-V frames and the KX2's Elecraft
 * commands come from rr73-wasm through a CatCodec, and what else differs between the radios from
 * its RadioTraits (lib/cat/radios.ts); the bytes go through a CatTransport (lib/cat/serial.ts in
 * the app, a fake port in tests).
 *
 * Requests go out one at a time from a queue, and each waits at most REPLY_MS for its answer
 * (longer for the KX2's frequency set, which may change band). PTT and the read that confirms PTT
 * off jump the queue and go out at once, beside a request in flight. The radio answers in the order
 * requests arrive, so an answer goes to the oldest request it answers. OK, NG and the KX2's `?;`
 * carry no command, so a request that goes unanswered, and a `?;`, start a drain of DRAIN_MS: a
 * late answer may come in it. Nothing but PTT off goes out during a drain, and every answer that
 * arrives in it is dropped, so a late answer is never taken for the answer to a later request.
 *
 * The KX2 answers no set: each set carries the read that checks it, and the read-back decides
 * (lib/cat/protocol.ts). PTT on is TX followed by TQ, and a TQ that says receive is read again,
 * PTT_READ_MS apart, until PTT_TIMEOUT_MS.
 *
 * PTT off goes out up to UNKEY_TRIES times, UNKEY_ACK_MS apart, until the radio answers OK, and
 * is then confirmed by reading transmit or receive (`1C 00`). Until a read says receive, the radio
 * counts as keyed: the dial and mode are not set, and a failed confirmation is reported and read
 * again every POLL_MS, with PTT off sent again while the radio still says transmit. PTT on without
 * an OK within PTT_TIMEOUT_MS sends PTT off at once. While RR73 holds PTT on, the dial is not
 * polled: transmit or receive is read every POLL_MS instead, and a radio that says receive or stops
 * answering is a fault (onFault), on which the app stops the transmission and sends PTT off.
 *
 * The menu settings are read on connecting, and those still unread every 5 s after, until the
 * radio answers or refuses each.
 *
 * A keying with a dial shift (lib/cat/passband.ts) sets the Tx dial first and sends PTT on only
 * after the radio's OK; the receive dial goes back once PTT off is confirmed. While the radio is on
 * a Tx dial the state keeps the receive dial, frequency reports leave it alone, the dial is not
 * polled, and the band sheet's dial and mode sets wait. No dial or mode set ever goes out while
 * the radio may be keyed by RR73.
 */

import type { LinkEnd } from './serial';
import type { CatCodec, CatEvent, CatFilter, CatMode, CatRequest, CatSplit, DataSub, SettingId } from './protocol';
import { IC705, type RadioTraits, type SettingRead } from './radios';
import { DIAL_TIMEOUT_MS, PTT_SETTLE_MS, PTT_TIMEOUT_MS, type KeyResult, type Keyer, type Keying } from '../tx/keyer';
import { wake } from '../clock/wake';

/** The serial link as the radio uses it. */
export interface CatTransport {
  write(bytes: Uint8Array): Promise<void>;
  onData(fn: (bytes: Uint8Array) => void): () => void;
  onEnd(fn: (end: LinkEnd) => void): () => void;
}

/** Time and timers, injectable for tests. */
export interface CatTimers {
  /** ms on any steady clock. */
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

/**
 * The page's clock, with every timeout on the wake timers (lib/clock/wake.ts): desktop Chromium
 * keeps a hidden page receiving and transmitting, but runs its own timers up to about 1 s late
 * there, and the reply timeouts, PTT on's confirmation, PTT off's retries, the drain and the
 * keying's limit must keep time. The polls ride along.
 */
export const realTimers: CatTimers = {
  now: () => performance.now(),
  set: (fn, ms) => wake.set(fn, ms),
  clear: (h) => wake.clear(h),
};

/** A request without an answer within this long counts as lost, ms. Unverified on a device. */
export const REPLY_MS = 500;
/** Lost requests in a row before the radio counts as silent. */
export const LOST_LIMIT = 3;
/** The frequency is read this often while connected and not keyed, ms. */
export const POLL_MS = 1000;
/** Every this many polls also read the mode and the data mode: every 5 s. */
export const MODE_EVERY = 5;
/** PTT off goes out at most this many times until the radio answers OK: once and 3 more. */
export const UNKEY_TRIES = 4;
/** How long each PTT off waits for its OK before the next, ms. */
export const UNKEY_ACK_MS = 100;
/** Between reads that confirm receive after PTT off's OK, ms: a radio may still report transmit as it switches. */
export const OFF_SETTLE_MS = 100;
/** How long reads may keep saying transmit after PTT off's OK before PTT off counts as not confirmed, ms. */
export const OFF_CONFIRM_MS = 500;
/** After a request goes unanswered, or the KX2 answers `?;`, answers arriving this long are dropped as late, ms. */
export const DRAIN_MS = 250;
/** A KX2 that says receive after TX is read again this often until PTT_TIMEOUT_MS, ms. Unverified on a device. */
export const PTT_READ_MS = 50;

export type RadioStatus = 'starting' | 'connected' | 'silent' | 'closed' | 'lost';

/** What went wrong while RR73 held PTT on: the radio said receive, or stopped answering. */
export type TxFault = 'receive' | 'silent';

/** A transmission's dial shift: the receive dial to set back, and the Tx dial set for it, Hz. */
export interface DialShift {
  rxHz: number;
  txHz: number;
}

export interface RadioState {
  /** `starting` until the radio first answers; `silent` after LOST_LIMIT requests in a row went unanswered. */
  status: RadioStatus;
  /** The operating frequency, Hz, once read. */
  hz: number | null;
  mode: CatMode | null;
  filter: CatFilter | null;
  /** Data mode on (USB-D), once read. The IC-705's. */
  data: boolean | null;
  /** The data sub-mode, once read: valid only while `mode` is DATA or DATA-REV. The KX2's. */
  sub: DataSub | null;
  /** When the frequency was last read or reported, CatTimers.now() ms. */
  heardAtMs: number | null;
  /** The settings read, by item: the codes the CI-V guide lists, split, RIT, XIT and their offset (SettingId), and for the KX2 its product number, MIC BTN as MP gives it and VOX (1 on). */
  settings: Partial<Record<SettingId, number>>;
  /** Bytes arrived, but never a frame from the radio: another port, such as USB (B). */
  noiseOnly: boolean;
  /** RR73 holds PTT on: sent and not released. */
  keyed: boolean;
  /** From PTT on until a read confirms receive: RR73 may hold the radio keyed. */
  mayBeKeyed: boolean;
  /** Transmit or receive, as last read with `1C 00`; null before the first read. */
  transmitting: boolean | null;
  /** PTT off went out and no read has confirmed receive since: the operator has to check the radio. */
  unkeyFailed: boolean;
}

/**
 * `busy`: a dial or mode set refused while the radio transmits or may still transmit. `ng` carries
 * the answer that refused: NG, `?;`, or the KX2's read-back of something else.
 */
export type CatResult = { ok: true; event: CatEvent } | { ok: false; why: 'ng' | 'timeout' | 'closed' | 'invalid' | 'busy'; event?: CatEvent };

interface InFlight {
  req: CatRequest;
  /** Jumped the queue: it does not hold back the next queued request. */
  now: boolean;
  timer: unknown;
  resolve: (r: CatResult) => void;
}

interface Waiting {
  req: CatRequest;
  timeoutMs: number;
  resolve: (r: CatResult) => void;
}

/** The IC-705's split and duplex as the `split` setting holds them: 0 off, 1 on, 2 DUP−, 3 DUP+. */
const SPLIT_CODE: Record<CatSplit, number> = { off: 0, on: 1, dup_minus: 2, dup_plus: 3 };

/** Sets that change the dial or mode, which never go out while the radio transmits. */
const TUNING = new Set<CatRequest['type']>(['set_frequency', 'set_mode', 'set_data_mode', 'set_data_sub_mode']);

/** True for an event that may answer a request; transceive frames and the KX2's `IF` answer none. */
function isAnswer(e: CatEvent): boolean {
  switch (e.type) {
    case 'frequency':
    case 'mode':
      return !e.transceive;
    case 'noise':
    case 'echo':
    case 'other_address':
    case 'info':
      return false;
    default:
      return true;
  }
}

export class CatRadio implements Keyer {
  private readonly codec: CatCodec;
  private readonly traits: RadioTraits;
  private readonly transport: CatTransport;
  private readonly timers: CatTimers;
  private readonly waiting: Waiting[] = [];
  private readonly inFlight: InFlight[] = [];
  private readonly listeners = new Set<(s: RadioState) => void>();
  private readonly endListeners = new Set<(end: LinkEnd) => void>();
  private readonly faultListeners = new Set<(f: TxFault) => void>();
  private readonly unsubscribe: (() => void)[] = [];
  private stateValue: RadioState = {
    status: 'starting',
    hz: null,
    mode: null,
    filter: null,
    data: null,
    sub: null,
    heardAtMs: null,
    settings: {},
    noiseOnly: false,
    keyed: false,
    mayBeKeyed: false,
    transmitting: null,
    unkeyFailed: false,
  };
  private over = false;
  private lostInRow = 0;
  private heardFrame = false;
  private polls = 0;
  private pollTimer: unknown = null;
  /** Until when answers are dropped as late, CatTimers.now() ms. */
  private drainUntil = -Infinity;
  private drainTimer: unknown = null;
  /** Requests that jump the queue and wait for the drain to end: PTT on and the reads that confirm PTT off. */
  private afterDrain: (() => void)[] = [];
  /** The keying that holds PTT on now; null when none does. */
  private holder: object | null = null;
  /** When the radio answered OK to the holder's PTT on, CatTimers.now() ms; null before. */
  private okAt: number | null = null;
  /** PTT on went out and no read has confirmed receive since. */
  private mayBeKeyed = false;
  private endedKeyedValue = false;
  /** Bumped by every PTT on and off, so an older PTT off and its confirmation stop. */
  private pttGen = 0;
  private tailTimer: unknown = null;
  /** Waiting for PTT off to be confirmed (true) or reported unconfirmed (false). */
  private unkeyWaiters: ((confirmed: boolean) => void)[] = [];
  /** Settings the radio refused (NG or `?;`): not read again. */
  private readonly menuRefused = new Set<SettingId>();
  /** Settings being read now. */
  private readonly menuAsked = new Set<SettingId>();
  /** The radio is, or may be, on a Tx dial: set for a shifted keying and not yet set back. */
  private shift: DialShift | null = null;
  /** A shift's dial set in flight, Tx dial or receive dial; the next one waits for it. */
  private dialOp: Promise<void> | null = null;
  private endedShiftValue: DialShift | null = null;
  /** Waiting for the receive dial to be set back (true) or for that to fail (false). */
  private restoreWaiters: ((restored: boolean) => void)[] = [];
  private readonly restoreListeners = new Set<(restored: boolean) => void>();

  constructor(opts: { codec: CatCodec; transport: CatTransport; timers?: CatTimers; traits?: RadioTraits }) {
    this.codec = opts.codec;
    this.traits = opts.traits ?? IC705;
    this.transport = opts.transport;
    this.timers = opts.timers ?? realTimers;
    this.codec.reset();
    this.unsubscribe.push(this.transport.onData((b) => this.receive(b)));
    this.unsubscribe.push(this.transport.onEnd((end) => this.ended(end)));
  }

  get state(): RadioState {
    return this.stateValue;
  }

  /** True from PTT on until a read confirms receive: RR73 may hold the radio keyed. */
  get holdsPtt(): boolean {
    return this.mayBeKeyed;
  }

  /** True when the link ended while the radio may have been keyed by RR73: the next connection reads it and sends PTT off if it still transmits. */
  get endedKeyed(): boolean {
    return this.endedKeyedValue;
  }

  /** The shift the radio may still be on when the link ended: the next connection sets the receive dial back if the radio is still on the Tx dial. */
  get endedShift(): DialShift | null {
    return this.endedShiftValue;
  }

  /** True while the radio is, or may be, on a Tx dial for a shifted transmission. */
  get shifted(): boolean {
    return this.shift !== null;
  }

  /** Listens to every change of the state. */
  onChange(fn: (s: RadioState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Listens for the link ending: `closed` by RR73, `lost` when the port went away. */
  onEnd(fn: (end: LinkEnd) => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  /** Listens for a fault while RR73 holds PTT on. PTT off has already gone out when it fires. */
  onFault(fn: (f: TxFault) => void): () => void {
    this.faultListeners.add(fn);
    return () => this.faultListeners.delete(fn);
  }

  /** Listens for the receive dial set back after a shifted transmission: false when the radio refused it or did not answer. */
  onRestore(fn: (restored: boolean) => void): () => void {
    this.restoreListeners.add(fn);
    return () => this.restoreListeners.delete(fn);
  }

  private fault(f: TxFault) {
    if (!this.holder) return;
    this.unkeyAll();
    for (const l of this.faultListeners) l(f);
  }

  /**
   * Reads what RR73 shows and checks (transmit or receive, the dial, the mode, the menu settings)
   * and starts polling. Sends no PTT, except PTT off when `recover` is set and the radio reports
   * transmitting: RR73 lost the port while it held PTT on. With `shifted`, RR73 lost the port while
   * the radio was on a Tx dial: the receive dial is set back when the radio still reads the Tx dial.
   */
  start(opts: { recover?: boolean; shifted?: DialShift | null } = {}) {
    // The first read after opening is the likeliest to go unanswered: read again, LOST_LIMIT times
    // at most, so a radio left keyed still gets its PTT off.
    void (async () => {
      for (let n = 0; n < LOST_LIMIT; n++) {
        const r = await this.request({ type: 'read_transmit' });
        if (this.over) return;
        if (!r.ok) continue;
        if (opts.recover && r.event.type === 'transmit' && r.event.on) {
          this.setMayBeKeyed(true);
          this.unkeyAll();
        }
        return;
      }
    })();
    const shifted = opts.shifted;
    if (shifted) {
      void this.request({ type: 'read_frequency' }).then((r) => {
        if (!r.ok || r.event.type !== 'frequency' || r.event.hz !== shifted.txHz || this.shift) return;
        this.shift = { ...shifted };
        this.restoreDial();
      });
    }
    void this.readDial(true);
    this.readSettings();
    this.schedulePoll();
  }

  /**
   * Reads the settings not read yet, except those the radio refused and those whose condition does
   * not hold yet. With `waiting`, only the settings that wait for another.
   */
  private readSettings(waiting = false) {
    for (const s of this.traits.settings) {
      if (waiting && !s.when) continue;
      if (s.id in this.stateValue.settings || this.menuRefused.has(s.id)) continue;
      this.startRead(s);
    }
  }

  /** Reads one setting again, as when the operator may have changed it at the radio. */
  rereadSetting(id: SettingId) {
    const s = this.traits.settings.find((x) => x.id === id);
    if (s && !this.menuRefused.has(id)) this.startRead(s);
  }

  private startRead(s: SettingRead) {
    const id = s.id;
    if (this.menuAsked.has(id) || this.over) return;
    if (s.when && !s.when(this.stateValue)) return;
    this.menuAsked.add(id);
    const guard = s.guard;
    if (!guard) {
      void this.readSetting(s);
      return;
    }
    void this.request(guard.request).then((g) => {
      if (g.ok && guard.ok(g.event)) void this.readSetting(s);
      else this.menuAsked.delete(id);
    });
  }

  private async readSetting(s: SettingRead) {
    const r = await this.request(s.request);
    this.menuAsked.delete(s.id);
    const after = s.after;
    if (after && !this.over) {
      void this.request(after.check).then((c) => {
        if (c.ok && !after.ok(c.event)) void this.request(after.fix);
      });
    }
    if (!r.ok) {
      if (r.why === 'ng') {
        this.menuRefused.add(s.id);
        if (s.refused !== undefined) this.setSetting(s.id, s.refused);
      }
      return;
    }
    const v = s.value(r.event);
    if (v === null) return;
    this.setSetting(s.id, v);
    // A setting another one waited for: the KX2's MIC BTN waits for its product number.
    this.readSettings(true);
  }

  private setSetting(id: SettingId, v: number) {
    if (this.stateValue.settings[id] !== v) this.patch({ settings: { ...this.stateValue.settings, [id]: v } });
  }

  /**
   * Resolves true once a read confirms receive after PTT off (at once when RR73 holds no PTT), or
   * false when PTT off goes unconfirmed or the link ends first.
   */
  unkeyed(): Promise<boolean> {
    if (!this.mayBeKeyed) return Promise.resolve(true);
    if (this.over) return Promise.resolve(false);
    return new Promise((resolve) => this.unkeyWaiters.push(resolve));
  }

  private settleUnkey(confirmed: boolean) {
    for (const w of this.unkeyWaiters.splice(0)) w(confirmed);
  }

  /**
   * Resolves true once the radio is back on the receive dial after a shifted transmission (at once
   * with none), or false when setting it back failed or the link ends first.
   */
  dialRestored(): Promise<boolean> {
    if (!this.shift) return Promise.resolve(true);
    if (this.over) return Promise.resolve(false);
    return new Promise((resolve) => this.restoreWaiters.push(resolve));
  }

  private settleRestore(restored: boolean) {
    for (const w of this.restoreWaiters.splice(0)) w(restored);
  }

  /** Dial and mode sets wait while RR73 holds or may hold PTT, and while a shift holds the radio on a Tx dial. */
  private tuningBlocked(): boolean {
    return this.holder !== null || this.mayBeKeyed || this.shift !== null;
  }

  /**
   * Reads the frequency, and with `all` the mode reads of the radio's traits: the mode and data
   * mode; the KX2's mode, VOX, IF and filter, and its data sub-mode once the mode reads DATA.
   */
  readDial(all = false): Promise<CatResult[]> {
    const reads: Promise<CatResult>[] = [this.request({ type: 'read_frequency' })];
    if (all) {
      const sub = this.traits.subRead;
      for (const r of this.traits.modeReads) {
        const read = this.request(r);
        reads.push(read);
        if (sub && r.type === 'read_mode')
          reads.push(read.then((m) => (m.ok && m.event.type === 'mode' && (m.event.mode === 'data' || m.event.mode === 'data-rev') ? this.request(sub) : m)));
      }
    }
    return Promise.all(reads);
  }

  /**
   * Sets the dial to `hz` and the data mode, USB-D, FIL1 on the IC-705 and DATA A on the KX2
   * (docs/design/cat.md), then reads them back. Refused with `busy` while RR73 holds PTT or the
   * radio reports transmitting (by VOX or its own PTT). Resolves with the first refusal or loss, or
   * ok.
   */
  async tune(hz: number): Promise<CatResult> {
    if (this.tuningBlocked()) return { ok: false, why: 'busy' };
    const now = await this.request({ type: 'read_transmit' });
    if (!now.ok) return now;
    if (now.event.type === 'transmit' && now.event.on) return { ok: false, why: 'busy' };
    const steps: CatRequest[] = [{ type: 'set_frequency', hz }, ...this.traits.dataMode];
    let result: CatResult = { ok: false, why: 'closed' };
    for (const s of steps) {
      result = await this.request(s);
      if (!result.ok) break;
    }
    void this.readDial(true);
    return result;
  }

  /** Queues a request; resolves with its answer, or why there was none. A dial or mode set while keyed is refused with `busy`. */
  request(req: CatRequest, timeoutMs = this.traits.slow[req.type] ?? REPLY_MS): Promise<CatResult> {
    if (this.over) return Promise.resolve({ ok: false, why: 'closed' });
    if (TUNING.has(req.type) && this.tuningBlocked()) return Promise.resolve({ ok: false, why: 'busy' });
    return new Promise((resolve) => {
      this.waiting.push({ req, timeoutMs, resolve });
      this.pump();
    });
  }

  /**
   * PTT on (`1C 00 01`), at once. The keying's result resolves when the radio answers OK, or says
   * why not within PTT_TIMEOUT_MS; without an OK, PTT off follows at once. Releasing sends PTT off
   * unless a later keying holds PTT; `maxMs` after keying, PTT goes off whatever else happens.
   *
   * With `shiftHz`, or with the radio still on an earlier transmission's Tx dial, the dial goes
   * first: `05` to the receive dial plus `shiftHz`, after any earlier PTT off is confirmed, and PTT
   * on only after the radio's OK to it within DIAL_TIMEOUT_MS. Without that OK the result is
   * `dial` and PTT on never goes out; released before PTT on, it is `closed`. Either way the
   * receive dial is set back once PTT off is confirmed.
   */
  key(maxMs: number, shiftHz = 0): Keying {
    const token = {};
    const dialFirst = shiftHz !== 0 || this.shift !== null;
    this.holder = token;
    this.okAt = null;
    this.clearTail();
    // setTimeout runs at once for more than 2^31 - 1 ms.
    const watchdog = this.timers.set(() => release(0), Math.min(maxMs, 0x7fffffff));
    let released = false;
    let pttSent = false;
    const release = (tailMs = 0) => {
      if (released) return;
      released = true;
      this.timers.clear(watchdog);
      if (this.holder !== token) return;
      this.holder = null;
      // Released before its PTT on went out (the dial went first): no PTT off is due, as any
      // earlier one is being confirmed. The receive dial goes back.
      if (!pttSent) {
        this.restoreDial();
        return;
      }
      if (tailMs > 0) {
        this.tailTimer = this.timers.set(() => {
          this.tailTimer = null;
          if (this.holder === null) this.unkeyNow();
        }, tailMs);
      } else this.unkeyNow();
    };
    const held = () => !released && this.holder === token && !this.over;
    const pttOn = (): Promise<KeyResult> => {
      pttSent = true;
      this.pttGen++;
      this.setMayBeKeyed(true);
      this.patch({ keyed: true });
      const until = this.timers.now() + PTT_TIMEOUT_MS;
      // Held back by a drain, PTT on goes out only while this keying still holds and no PTT off
      // has gone out since (every PTT off bumps pttGen).
      const gen = this.pttGen;
      const on = this.sendNow({ type: 'set_transmit', on: true }, PTT_TIMEOUT_MS, () => held() && gen === this.pttGen);
      return (this.traits.readsPtt ? on.then((r) => this.readUntilKeyed(r, until, held)) : on).then((r) => {
        const answer: KeyResult = r.ok ? 'ok' : r.why === 'timeout' ? 'timeout' : r.why === 'ng' ? 'ng' : 'closed';
        if (answer === 'ok' && this.holder === token) this.okAt = this.timers.now();
        if (answer !== 'ok') release();
        return answer;
      });
    };
    // The dial never moves while the radio may transmit: PTT held by an earlier keying, or its tail,
    // goes off first, and the dial waits for its confirmation.
    if (dialFirst && this.mayBeKeyed) this.unkeyNow();
    const result: Promise<KeyResult> = !dialFirst
      ? pttOn()
      : this.txDial(shiftHz, held).then((d) => {
          if (d === 'ok' && held()) return pttOn();
          release();
          return d === 'ok' ? 'closed' : d;
        });
    return {
      result,
      release,
      get held() {
        return held();
      },
    };
  }

  /**
   * The KX2 answered PTT on with a read that says receive, or with `?;`. It may still be switching
   * over, or the `?;` may have answered TX alone with the read's answer behind it. Reads again until
   * it says transmit or `until` passes: PTT_READ_MS after a receive, and after a `?;` once its drain
   * ends. No answer ends it.
   */
  private async readUntilKeyed(first: CatResult, until: number, held: () => boolean): Promise<CatResult> {
    let r = first;
    while (!r.ok && r.why === 'ng' && (r.event?.type === 'transmit' || r.event?.type === 'busy') && held()) {
      if (r.event.type === 'transmit') {
        if (until - this.timers.now() <= PTT_READ_MS) break;
        await new Promise<void>((resolve) => this.timers.set(resolve, PTT_READ_MS));
        if (!held()) break;
      } else if (until <= this.timers.now()) break;
      const q = await this.sendNow({ type: 'read_transmit' }, () => until - this.timers.now(), held);
      r = q.ok && q.event.type === 'transmit' && !q.event.on ? { ok: false, why: 'ng', event: q.event } : q;
    }
    return r;
  }

  /**
   * Before PTT on: sets the dial `shiftHz` from the receive dial and waits for the radio's OK. With
   * `shiftHz` 0 it sets the receive dial back, as an earlier transmission left the radio on its Tx
   * dial. The dial never changes while the radio may be keyed: an earlier PTT off must be confirmed
   * first, and a restore in flight ends first.
   */
  private async txDial(shiftHz: number, held: () => boolean): Promise<'ok' | 'dial' | 'closed'> {
    for (;;) {
      if (!held()) return 'closed';
      if (this.dialOp) await this.dialOp;
      else if (!this.mayBeKeyed) break;
      else if (!(await this.unkeyed())) return held() ? 'dial' : 'closed';
    }
    const rxHz = this.shift?.rxHz ?? this.stateValue.hz;
    if (rxHz === null) return 'dial';
    const shift = { rxHz, txHz: rxHz + shiftHz };
    this.shift = shift;
    // With no shift, the radio is back on the receive dial once it answers OK.
    const r = await this.dialSet(shift.txHz, DIAL_TIMEOUT_MS, (answer) => {
      if (answer.ok && shiftHz === 0 && this.shift === shift) {
        this.shift = null;
        this.settleRestore(true);
      }
    });
    // Released while the set was in flight: the receive dial goes back now.
    if (!held()) this.restoreDial();
    return r.ok ? 'ok' : r.why === 'closed' ? 'closed' : 'dial';
  }

  /**
   * One of a shift's dial sets, jumping the queue; the next waits for it. `then` runs with the
   * answer before any waiting set goes out.
   */
  private dialSet(hz: number, timeoutMs: number, then: (r: CatResult) => void): Promise<CatResult> {
    let done = () => {};
    this.dialOp = new Promise<void>((resolve) => (done = resolve));
    return this.sendNow({ type: 'set_frequency', hz }, timeoutMs).then((r) => {
      this.dialOp = null;
      then(r);
      done();
      return r;
    });
  }

  /**
   * Sets the receive dial back after a shifted transmission, once no keying holds PTT and a read
   * has confirmed receive. Then reads the dial: after a refusal or no answer, RR73 shows and uses
   * the dial the radio reports, and says so.
   */
  private restoreDial(retry = true) {
    const s = this.shift;
    if (!s || this.over || this.holder || this.mayBeKeyed || this.dialOp) return;
    void this.dialSet(s.rxHz, REPLY_MS, (r) => {
      if (this.over || this.shift !== s) return;
      // A radio may refuse a dial change just after leaving transmit: once more, OFF_SETTLE_MS later.
      if (!r.ok && retry) {
        this.timers.set(() => this.restoreDial(false), OFF_SETTLE_MS);
        return;
      }
      this.shift = null;
      void this.readDial();
      this.settleRestore(r.ok);
      for (const l of this.restoreListeners) l(r.ok);
    });
  }

  /** PTT off at once, whoever keyed: Halt, the page going, an error. Sends it even when RR73 holds no PTT. */
  unkeyAll() {
    this.holder = null;
    this.clearTail();
    this.unkeyNow();
  }

  /** Stops polling, answers what waits with `closed`, and stops listening to the link. */
  close() {
    this.finish('closed');
  }

  private finish(status: 'closed' | 'lost') {
    if (this.over) return;
    this.over = true;
    if (this.pollTimer !== null) this.timers.clear(this.pollTimer);
    this.pollTimer = null;
    if (this.drainTimer !== null) this.timers.clear(this.drainTimer);
    this.drainTimer = null;
    for (const go of this.afterDrain.splice(0)) go();
    this.clearTail();
    this.holder = null;
    for (const w of this.waiting.splice(0)) w.resolve({ ok: false, why: 'closed' });
    for (const f of this.inFlight.splice(0)) {
      this.timers.clear(f.timer);
      f.resolve({ ok: false, why: 'closed' });
    }
    for (const u of this.unsubscribe.splice(0)) u();
    this.patch({ status, keyed: false });
    this.settleUnkey(!this.mayBeKeyed);
    this.settleRestore(this.shift === null);
  }

  private ended(end: LinkEnd) {
    const wasOver = this.over;
    if (!wasOver) {
      this.endedKeyedValue = this.mayBeKeyed;
      this.endedShiftValue = this.shift;
    }
    this.finish(end === 'lost' ? 'lost' : 'closed');
    if (!wasOver) for (const l of this.endListeners) l(end);
  }

  private clearTail() {
    if (this.tailTimer !== null) this.timers.clear(this.tailTimer);
    this.tailTimer = null;
  }

  private unkeyNow() {
    const gen = ++this.pttGen;
    this.patch({ keyed: false });
    void this.confirmOff(gen);
  }

  /**
   * PTT off until the radio accepts it (OK, or the KX2's TQ0), UNKEY_ACK_MS apart, then a read that
   * must say receive. An early refusal, such as a KX2 still reading transmit, waits out the rest of
   * the UNKEY_ACK_MS before the next try.
   */
  private async confirmOff(gen: number) {
    for (let n = 0; n < UNKEY_TRIES; n++) {
      const sent = this.timers.now();
      const r = await this.sendNow({ type: 'set_transmit', on: false }, UNKEY_ACK_MS);
      if (this.over || gen !== this.pttGen) return;
      if (r.ok) break;
      const rest = sent + UNKEY_ACK_MS - this.timers.now();
      if (rest > 0 && n < UNKEY_TRIES - 1) {
        await new Promise<void>((resolve) => this.timers.set(resolve, rest));
        if (this.over || gen !== this.pttGen) return;
      }
    }
    const wait = (ms: number) => new Promise<void>((resolve) => this.timers.set(resolve, ms));
    const until = this.timers.now() + OFF_CONFIRM_MS;
    for (;;) {
      if (this.over || gen !== this.pttGen) return;
      const read = await this.sendNow({ type: 'read_transmit' }, REPLY_MS);
      if (this.over || gen !== this.pttGen) return;
      if (read.ok && read.event.type === 'transmit' && !read.event.on) {
        this.confirmed();
        return;
      }
      if (this.timers.now() >= until) break;
      await wait(OFF_SETTLE_MS);
    }
    if (this.mayBeKeyed) {
      this.patch({ unkeyFailed: true });
      this.settleUnkey(false);
    }
  }

  /** A read said receive with RR73 holding no PTT: a shifted transmission's receive dial goes back. */
  private confirmed() {
    this.setMayBeKeyed(false);
    if (this.stateValue.unkeyFailed) this.patch({ unkeyFailed: false });
    this.settleUnkey(true);
    this.restoreDial();
    // Requests held back while keyed go now.
    this.pump();
  }

  private setMayBeKeyed(v: boolean) {
    this.mayBeKeyed = v;
    this.patch({ mayBeKeyed: v });
  }

  /** The KX2 from PTT on until a read confirms receive: only reads of transmit or receive go out. */
  private quiet(): boolean {
    return this.traits.quietWhileKeyed === true && (this.holder !== null || this.mayBeKeyed);
  }

  /** A read of transmit or receive waits in the queue or is in flight from it. */
  private transmitReadPending(): boolean {
    return this.waiting.some((w) => w.req.type === 'read_transmit') || this.inFlight.some((f) => !f.now && f.req.type === 'read_transmit');
  }

  /**
   * Writes a request ahead of the queue: at once for PTT off, at the end of a drain for anything
   * else, whose answer could not be told from a late one before then. A request held back that way
   * goes out only if `still` holds when the drain ends; otherwise it resolves `closed` unsent. A
   * timeout given as a function is worked out when the request goes out, and one at 0 or below
   * resolves `timeout` unsent.
   */
  private sendNow(req: CatRequest, timeoutMs: number | (() => number), still: () => boolean = () => true): Promise<CatResult> {
    if (this.over) return Promise.resolve({ ok: false, why: 'closed' });
    return new Promise((resolve) => {
      const go = () => {
        if (this.over || !still()) return resolve({ ok: false, why: 'closed' });
        const ms = typeof timeoutMs === 'number' ? timeoutMs : timeoutMs();
        if (ms <= 0) return resolve({ ok: false, why: 'timeout' });
        this.send(req, ms, resolve, true);
      };
      if (this.draining() && !(req.type === 'set_transmit' && !req.on)) this.afterDrain.push(go);
      else go();
    });
  }

  private draining(): boolean {
    return this.timers.now() < this.drainUntil;
  }

  private drain() {
    this.drainUntil = Math.max(this.drainUntil, this.timers.now() + DRAIN_MS);
    if (this.drainTimer !== null) this.timers.clear(this.drainTimer);
    this.drainTimer = this.timers.set(() => {
      this.drainTimer = null;
      // The timer ends the drain, even when it fires a moment before the clock reaches its end:
      // otherwise pump() would still find a drain, and nothing would call it again.
      this.drainUntil = Math.min(this.drainUntil, this.timers.now());
      for (const go of this.afterDrain.splice(0)) go();
      this.pump();
    }, this.drainUntil - this.timers.now());
  }

  private pump() {
    if (this.over || this.draining() || this.inFlight.some((f) => !f.now)) return;
    // While quiet, the reads of transmit or receive go ahead and the rest wait.
    const i = this.quiet() ? this.waiting.findIndex((w) => w.req.type === 'read_transmit') : 0;
    if (i < 0) return;
    const [next] = this.waiting.splice(i, 1);
    if (!next) return;
    // Refused when it reaches the head of the queue too: PTT may have gone on since it was queued.
    if (TUNING.has(next.req.type) && this.tuningBlocked()) {
      next.resolve({ ok: false, why: 'busy' });
      this.pump();
      return;
    }
    this.send(next.req, next.timeoutMs, next.resolve, false);
  }

  private send(req: CatRequest, timeoutMs: number, resolve: (r: CatResult) => void, now: boolean) {
    // The last check before the wire: no dial or mode set while the radio may be keyed by RR73.
    if (TUNING.has(req.type) && this.mayBeKeyed) {
      resolve({ ok: false, why: 'busy' });
      this.pump();
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = this.codec.encode(req);
    } catch {
      resolve({ ok: false, why: 'invalid' });
      this.pump();
      return;
    }
    const entry: InFlight = { req, now, resolve, timer: null };
    entry.timer = this.timers.set(() => this.lost(entry), timeoutMs);
    this.inFlight.push(entry);
    // A failed write means the port is going: the link ends with `lost` and answers everything.
    this.transport.write(bytes).catch(() => undefined);
  }

  private lost(entry: InFlight) {
    const i = this.inFlight.indexOf(entry);
    if (i < 0) return;
    this.inFlight.splice(i, 1);
    this.drain();
    entry.resolve({ ok: false, why: 'timeout' });
    this.lostInRow++;
    if (this.lostInRow >= LOST_LIMIT && this.stateValue.status !== 'silent') {
      this.patch({ status: 'silent' });
      this.fault('silent');
    }
    this.pump();
  }

  private receive(bytes: Uint8Array) {
    if (this.over) return;
    let events: CatEvent[];
    try {
      events = this.codec.parse(bytes);
    } catch {
      return;
    }
    for (const e of events) this.handle(e);
    this.pump();
  }

  private handle(e: CatEvent) {
    switch (e.type) {
      case 'noise':
        if (!this.heardFrame && !this.stateValue.noiseOnly) this.patch({ noiseOnly: true });
        return;
      case 'echo':
      case 'other_address':
        return;
      default:
        break;
    }
    this.heardFrame = true;
    // In a drain any answer may be a late one: dropped, whatever it says. It still shows the
    // radio answers, so the requests whose answers it drops do not count towards silent.
    if (isAnswer(e) && this.draining()) {
      this.lostInRow = 0;
      return;
    }
    this.note(e);
    const i = this.inFlight.findIndex((f) => this.codec.answers(f.req, e));
    if (i >= 0) {
      const [f] = this.inFlight.splice(i, 1);
      this.timers.clear(f.timer);
      this.lostInRow = 0;
      const answered: Partial<RadioState> = { noiseOnly: false };
      if (this.stateValue.status === 'starting' || this.stateValue.status === 'silent') answered.status = 'connected';
      this.patch(answered);
      f.resolve(this.codec.accepts(f.req, e) ? { ok: true, event: e } : { ok: false, why: 'ng', event: e });
      // The KX2 reports the new band's values by itself after a frequency set (p. 11, note 7).
      if (this.traits.drainAfter?.includes(f.req.type)) this.drain();
    }
    // The KX2's `?;` may answer the set of a set and its read: the read's answer may follow.
    if (this.codec.drains(e)) this.drain();
  }

  /** Takes what a frame says about the radio into the state. */
  private note(e: CatEvent) {
    switch (e.type) {
      case 'frequency':
        // On a Tx dial the state keeps the receive dial: what the app shows, decodes and logs.
        if (this.shift) break;
        this.patch({ hz: e.hz, heardAtMs: this.timers.now() });
        break;
      case 'mode':
        this.patch({ mode: e.mode, ...(typeof e.filter === 'number' ? { filter: e.filter } : {}) });
        break;
      case 'data_sub_mode':
        this.patch({ sub: e.sub });
        break;
      case 'info':
        // The KX2's IF: VFO A, the mode, transmit, split and XIT. Its transmit flag shows, and is
        // never taken as a confirmation: only TQ confirms PTT off.
        if (!this.shift) this.patch({ hz: e.hz, heardAtMs: this.timers.now() });
        this.patch({ transmitting: e.transmit, ...(e.mode !== null ? { mode: e.mode } : {}) });
        this.setSetting('split', e.split ? 1 : 0);
        this.setSetting('rit', e.rit ? 1 : 0);
        this.setSetting('xit', e.xit ? 1 : 0);
        this.setSetting('offset_hz', e.offset_hz);
        break;
      // The IC-705's `0F` and `21`: split or duplex, RIT, ΔTX and their shared offset.
      case 'split':
        this.setSetting('split', SPLIT_CODE[e.split]);
        break;
      case 'rit':
        this.setSetting('rit', e.on ? 1 : 0);
        break;
      case 'xit':
        this.setSetting('xit', e.on ? 1 : 0);
        break;
      case 'rit_offset':
        this.setSetting('offset_hz', e.hz);
        break;
      case 'bandwidth':
        this.setSetting('bandwidth', e.hz);
        break;
      case 'menu_entry':
        this.setSetting('menu_entry', e.entry);
        break;
      case 'vox':
        this.setSetting('vox', e.on ? 1 : 0);
        break;
      case 'data_mode':
        this.patch({ data: e.on, ...(e.filter !== null ? { filter: e.filter } : {}) });
        break;
      case 'transmit':
        this.patch({ transmitting: e.on });
        // With RR73 holding no PTT, receive confirms PTT off.
        if (!e.on && !this.holder && this.mayBeKeyed) this.confirmed();
        break;
      case 'setting':
        this.setSetting(e.item, e.value);
        break;
      default:
        break;
    }
  }

  private schedulePoll() {
    if (this.over) return;
    this.pollTimer = this.timers.set(() => {
      this.pollTimer = null;
      this.poll();
      this.schedulePoll();
    }, POLL_MS);
  }

  private poll() {
    if (this.over || this.tailTimer !== null) return;
    // A poll still waiting from the last round is enough. While quiet, other requests may wait
    // until PTT off is confirmed: only a waiting read of transmit or receive holds the next back.
    const pending = this.quiet() ? this.transmitReadPending() : this.waiting.length > 0 || this.inFlight.some((f) => !f.now);
    if (this.holder) {
      // On the air: the radio must still say transmit. Not before its OK, nor in the PTT_SETTLE_MS
      // after it, while it may still be switching over.
      if (pending || this.okAt === null || this.timers.now() - this.okAt < PTT_SETTLE_MS) return;
      const holder = this.holder;
      void this.request({ type: 'read_transmit' }).then((r) => {
        if (this.holder === holder && r.ok && r.event.type === 'transmit' && !r.event.on) this.fault('receive');
      });
      return;
    }
    if (pending) return;
    if (this.stateValue.unkeyFailed) {
      // PTT off was not confirmed: read again, and send PTT off again while the radio says transmit.
      void this.request({ type: 'read_transmit' }).then((r) => {
        if (r.ok && r.event.type === 'transmit' && r.event.on && !this.holder) this.unkeyNow();
      });
      return;
    }
    if (this.stateValue.keyed) return;
    // The KX2 transmitting by VOX or its own PTT: only transmit or receive is read until it receives.
    if (this.traits.quietWhileKeyed && this.stateValue.transmitting === true) {
      void this.request({ type: 'read_transmit' });
      return;
    }
    // On a Tx dial: no dial reads until the receive dial is back; try setting it back.
    if (this.shift) {
      this.restoreDial();
      return;
    }
    this.polls++;
    const all = this.polls % MODE_EVERY === 0;
    void this.readDial(all);
    if (all) {
      // Transmit or receive every 5 s: a radio keyed by VOX, its own PTT or another program shows.
      void this.request({ type: 'read_transmit' });
      // A setting that went unanswered on connecting is read again: USB SEND gates Tx.
      this.readSettings();
    }
  }

  private patch(p: Partial<RadioState>) {
    let changed = false;
    for (const [k, v] of Object.entries(p) as [keyof RadioState, unknown][]) {
      if (this.stateValue[k] !== v) changed = true;
    }
    if (!changed) return;
    this.stateValue = { ...this.stateValue, ...p };
    for (const l of this.listeners) l(this.stateValue);
  }
}
