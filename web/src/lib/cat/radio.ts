/**
 * One IC-705 over one serial link (docs/design/cat.md): the requests in flight and their answers,
 * the dial polling, transceive frames, and PTT. The CI-V frames come from rr73-wasm through a
 * CatCodec; the bytes go through a CatTransport (lib/cat/serial.ts in the app, a fake port in
 * tests).
 *
 * Requests go out one at a time from a queue, and each waits at most REPLY_MS for its answer.
 * PTT and the read that confirms PTT off jump the queue and go out at once, beside a request in
 * flight. The radio answers frames in the order they arrive, so an answer goes to the oldest
 * request it answers. OK and NG carry no command, so a request that goes unanswered starts a
 * drain of DRAIN_MS: its late answer may come in it. Nothing but PTT off goes out during a drain,
 * and every answer that arrives in it is dropped, so a late OK is never taken for the answer to a
 * later request.
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
 */

import type { LinkEnd } from './serial';
import type { CatCodec, CatEvent, CatFilter, CatMode, CatRequest, MenuItemId } from './protocol';
import { PTT_SETTLE_MS, PTT_TIMEOUT_MS, type KeyResult, type Keyer, type Keying } from '../tx/keyer';

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

export const realTimers: CatTimers = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
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
/** After a request goes unanswered, answers arriving this long are dropped as late, ms. */
export const DRAIN_MS = 250;

/** The menu settings read on connecting (docs/design/cat.md, Radio settings). */
export const CONNECT_SETTINGS: readonly MenuItemId[] = ['usb_send', 'data_mod', 'time_out_timer'];

export type RadioStatus = 'starting' | 'connected' | 'silent' | 'closed' | 'lost';

/** What went wrong while RR73 held PTT on: the radio said receive, or stopped answering. */
export type TxFault = 'receive' | 'silent';

export interface RadioState {
  /** `starting` until the radio first answers; `silent` after LOST_LIMIT requests in a row went unanswered. */
  status: RadioStatus;
  /** The operating frequency, Hz, once read. */
  hz: number | null;
  mode: CatMode | null;
  filter: CatFilter | null;
  /** Data mode on (USB-D), once read. */
  data: boolean | null;
  /** When the frequency was last read or reported, CatTimers.now() ms. */
  heardAtMs: number | null;
  /** The menu settings read, by item, as the codes the CI-V guide lists. */
  settings: Partial<Record<MenuItemId, number>>;
  /** Bytes arrived, but never a frame from the radio: another port, such as USB (B). */
  noiseOnly: boolean;
  /** RR73 holds PTT on: sent and not released. */
  keyed: boolean;
  /** Transmit or receive, as last read with `1C 00`; null before the first read. */
  transmitting: boolean | null;
  /** PTT off went out and no read has confirmed receive since: the operator has to check the radio. */
  unkeyFailed: boolean;
}

/** `busy`: a dial or mode set refused while the radio transmits or may still transmit. */
export type CatResult = { ok: true; event: CatEvent } | { ok: false; why: 'ng' | 'timeout' | 'closed' | 'invalid' | 'busy' };

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

const isSet = (r: CatRequest) => r.type.startsWith('set_');
/** Sets that change the dial or mode, which never go out while the radio transmits. */
const TUNING = new Set<CatRequest['type']>(['set_frequency', 'set_mode', 'set_data_mode']);

/** True for an event that may answer a request; transceive frames answer none. */
function isAnswer(e: CatEvent): boolean {
  switch (e.type) {
    case 'frequency':
    case 'mode':
      return !e.transceive;
    case 'noise':
    case 'echo':
    case 'other_address':
      return false;
    default:
      return true;
  }
}

export class CatRadio implements Keyer {
  private readonly codec: CatCodec;
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
    heardAtMs: null,
    settings: {},
    noiseOnly: false,
    keyed: false,
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
  /** Menu settings the radio answered NG: not read again. */
  private readonly menuRefused = new Set<MenuItemId>();

  constructor(opts: { codec: CatCodec; transport: CatTransport; timers?: CatTimers }) {
    this.codec = opts.codec;
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

  private fault(f: TxFault) {
    if (!this.holder) return;
    this.unkeyAll();
    for (const l of this.faultListeners) l(f);
  }

  /**
   * Reads what RR73 shows and checks (transmit or receive, the dial, the mode, the menu settings)
   * and starts polling. Sends no PTT, except PTT off when `recover` is set and the radio reports
   * transmitting: RR73 lost the port while it held PTT on.
   */
  start(opts: { recover?: boolean } = {}) {
    void this.request({ type: 'read_transmit' }).then((r) => {
      if (opts.recover && r.ok && r.event.type === 'transmit' && r.event.on) {
        this.mayBeKeyed = true;
        this.unkeyAll();
      }
    });
    void this.readDial(true);
    this.readSettings();
    this.schedulePoll();
  }

  /** Reads the menu settings not read yet, except those the radio refused. */
  private readSettings() {
    for (const item of CONNECT_SETTINGS) {
      if (item in this.stateValue.settings || this.menuRefused.has(item)) continue;
      void this.request({ type: 'read_setting', item }).then((r) => {
        if (!r.ok && r.why === 'ng') this.menuRefused.add(item);
      });
    }
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

  /** Reads the frequency, and the mode and data mode with `all`. */
  readDial(all = false): Promise<CatResult[]> {
    const reads: Promise<CatResult>[] = [this.request({ type: 'read_frequency' })];
    if (all) reads.push(this.request({ type: 'read_mode' }), this.request({ type: 'read_data_mode' }));
    return Promise.all(reads);
  }

  /**
   * Sets the dial to `hz` and the mode to USB-D, FIL1 (docs/design/cat.md, USB-D), then reads them
   * back. Refused with `busy` while RR73 holds PTT or the radio reports transmitting (by VOX or its
   * own PTT). Resolves with the first refusal or loss, or ok.
   */
  async tune(hz: number): Promise<CatResult> {
    if (this.holder || this.mayBeKeyed) return { ok: false, why: 'busy' };
    const now = await this.request({ type: 'read_transmit' });
    if (!now.ok) return now;
    if (now.event.type === 'transmit' && now.event.on) return { ok: false, why: 'busy' };
    const steps: CatRequest[] = [
      { type: 'set_frequency', hz },
      { type: 'set_mode', mode: 'usb', filter: 1 },
      { type: 'set_data_mode', on: true, filter: 1 },
    ];
    let result: CatResult = { ok: false, why: 'closed' };
    for (const s of steps) {
      result = await this.request(s);
      if (!result.ok) break;
    }
    void this.readDial(true);
    return result;
  }

  /** Queues a request; resolves with its answer, or why there was none. A dial or mode set while keyed is refused with `busy`. */
  request(req: CatRequest, timeoutMs = REPLY_MS): Promise<CatResult> {
    if (this.over) return Promise.resolve({ ok: false, why: 'closed' });
    if (TUNING.has(req.type) && (this.holder || this.mayBeKeyed)) return Promise.resolve({ ok: false, why: 'busy' });
    return new Promise((resolve) => {
      this.waiting.push({ req, timeoutMs, resolve });
      this.pump();
    });
  }

  /**
   * PTT on (`1C 00 01`), at once. The keying's result resolves when the radio answers OK, or says
   * why not within PTT_TIMEOUT_MS; without an OK, PTT off follows at once. Releasing sends PTT off
   * unless a later keying holds PTT; `maxMs` after keying, PTT goes off whatever else happens.
   */
  key(maxMs: number): Keying {
    const token = {};
    this.holder = token;
    this.okAt = null;
    this.clearTail();
    this.pttGen++;
    this.mayBeKeyed = true;
    this.patch({ keyed: true });
    // setTimeout runs at once for more than 2^31 - 1 ms.
    const watchdog = this.timers.set(() => release(0), Math.min(maxMs, 0x7fffffff));
    let released = false;
    const release = (tailMs = 0) => {
      if (released) return;
      released = true;
      this.timers.clear(watchdog);
      if (this.holder !== token) return;
      this.holder = null;
      if (tailMs > 0) {
        this.tailTimer = this.timers.set(() => {
          this.tailTimer = null;
          if (this.holder === null) this.unkeyNow();
        }, tailMs);
      } else this.unkeyNow();
    };
    const result: Promise<KeyResult> = this.sendNow({ type: 'set_transmit', on: true }, PTT_TIMEOUT_MS).then((r) => {
      const answer: KeyResult = r.ok ? 'ok' : r.why === 'timeout' ? 'timeout' : r.why === 'ng' ? 'ng' : 'closed';
      if (answer === 'ok' && this.holder === token) this.okAt = this.timers.now();
      if (answer !== 'ok') release();
      return answer;
    });
    const held = () => !released && this.holder === token && !this.over;
    return {
      result,
      release,
      get held() {
        return held();
      },
    };
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
  }

  private ended(end: LinkEnd) {
    const wasOver = this.over;
    if (!wasOver) this.endedKeyedValue = this.mayBeKeyed;
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

  /** PTT off until the radio answers OK, then a read that must say receive. */
  private async confirmOff(gen: number) {
    for (let n = 0; n < UNKEY_TRIES; n++) {
      const r = await this.sendNow({ type: 'set_transmit', on: false }, UNKEY_ACK_MS);
      if (this.over || gen !== this.pttGen) return;
      if (r.ok) break;
    }
    const read = await this.sendNow({ type: 'read_transmit' }, REPLY_MS);
    if (this.over || gen !== this.pttGen) return;
    if (read.ok && read.event.type === 'transmit' && !read.event.on) this.confirmed();
    else if (this.mayBeKeyed) {
      this.patch({ unkeyFailed: true });
      this.settleUnkey(false);
    }
  }

  /** A read said receive with RR73 holding no PTT. */
  private confirmed() {
    this.mayBeKeyed = false;
    if (this.stateValue.unkeyFailed) this.patch({ unkeyFailed: false });
    this.settleUnkey(true);
  }

  /**
   * Writes a request ahead of the queue: at once for PTT off, at the end of a drain for anything
   * else, whose answer could not be told from a late one before then.
   */
  private sendNow(req: CatRequest, timeoutMs: number): Promise<CatResult> {
    if (this.over) return Promise.resolve({ ok: false, why: 'closed' });
    return new Promise((resolve) => {
      const go = () => (this.over ? resolve({ ok: false, why: 'closed' }) : this.send(req, timeoutMs, resolve, true));
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
      for (const go of this.afterDrain.splice(0)) go();
      this.pump();
    }, this.drainUntil - this.timers.now());
  }

  private pump() {
    if (this.over || this.draining() || this.inFlight.some((f) => !f.now)) return;
    const next = this.waiting.shift();
    if (!next) return;
    // Refused when it reaches the head of the queue too: PTT may have gone on since it was queued.
    if (TUNING.has(next.req.type) && (this.holder || this.mayBeKeyed)) {
      next.resolve({ ok: false, why: 'busy' });
      this.pump();
      return;
    }
    this.send(next.req, next.timeoutMs, next.resolve, false);
  }

  private send(req: CatRequest, timeoutMs: number, resolve: (r: CatResult) => void, now: boolean) {
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
    // In a drain any answer may be a late one: dropped, whatever it says.
    if (isAnswer(e) && this.draining()) return;
    this.note(e);
    const i = this.inFlight.findIndex((f) => this.codec.answers(f.req, e));
    if (i < 0) return;
    const [f] = this.inFlight.splice(i, 1);
    this.timers.clear(f.timer);
    this.lostInRow = 0;
    const answered: Partial<RadioState> = { noiseOnly: false };
    if (this.stateValue.status === 'starting' || this.stateValue.status === 'silent') answered.status = 'connected';
    this.patch(answered);
    f.resolve(e.type === 'ng' || e.type === 'malformed' || (isSet(f.req) && e.type !== 'ok') ? { ok: false, why: 'ng' } : { ok: true, event: e });
  }

  /** Takes what a frame says about the radio into the state. */
  private note(e: CatEvent) {
    switch (e.type) {
      case 'frequency':
        this.patch({ hz: e.hz, heardAtMs: this.timers.now() });
        break;
      case 'mode':
        this.patch({ mode: e.mode, ...(e.filter !== null ? { filter: e.filter } : {}) });
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
        this.patch({ settings: { ...this.stateValue.settings, [e.item]: e.value } });
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
    // A poll still waiting from the last round is enough.
    if (this.waiting.length || this.inFlight.some((f) => !f.now)) return;
    if (this.holder) {
      // On the air: the radio must still say transmit. Not before its OK, nor in the PTT_SETTLE_MS
      // after it, while it may still be switching over.
      if (this.okAt === null || this.timers.now() - this.okAt < PTT_SETTLE_MS) return;
      const holder = this.holder;
      void this.request({ type: 'read_transmit' }).then((r) => {
        if (this.holder === holder && r.ok && r.event.type === 'transmit' && !r.event.on) this.fault('receive');
      });
      return;
    }
    if (this.stateValue.unkeyFailed) {
      // PTT off was not confirmed: read again, and send PTT off again while the radio says transmit.
      void this.request({ type: 'read_transmit' }).then((r) => {
        if (r.ok && r.event.type === 'transmit' && r.event.on && !this.holder) this.unkeyNow();
      });
      return;
    }
    if (this.stateValue.keyed) return;
    this.polls++;
    const all = this.polls % MODE_EVERY === 0;
    void this.readDial(all);
    // A menu setting that went unanswered on connecting is read again: USB SEND gates Tx.
    if (all) this.readSettings();
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
