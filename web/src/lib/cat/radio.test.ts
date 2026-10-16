// CatRadio against a fake serial port whose replies come from the simulated IC-705 of the
// rr73-cat crate (CatSimForTests in crates/rr73-wasm/src/cat.rs), on a fake clock. Frames follow
// Icom's IC-705 CI-V Reference Guide, A7560-8EX-6: p. 2 layout, p. 14 transmit, p. 17 formats.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import { wasmCodec, type CatWasm } from './protocol';
import { CatRadio, DRAIN_MS, LOST_LIMIT, POLL_MS, REPLY_MS, UNKEY_ACK_MS, UNKEY_TRIES, type CatTimers, type CatTransport } from './radio';
import type { LinkEnd } from './serial';
import { DIAL_TIMEOUT_MS, PTT_TIMEOUT_MS } from '../tx/keyer';

interface Sim {
  receive(bytes: Uint8Array): Uint8Array;
  turn_dial(hz: number): Uint8Array;
  set_setting(item: string, value: number): void;
  set_lines(dtr: boolean, rts: boolean): void;
  readonly transmit: boolean;
  readonly frequency: number;
  readonly mode: string;
  readonly data: boolean;
  readonly filter: number;
  /** Frequency, mode and data mode sets that arrived while the radio transmitted. */
  readonly sets_while_transmitting: number;
  /** Split or duplex on the FUNCTION screen, as JSON: '"on"', '"dup_plus"'. */
  set_split(split: string): void;
  /** RIT and ΔTX on or off, and their offset, Hz. */
  set_rit(rit: boolean, xit: boolean, offsetHz: number): void;
  free(): void;
}

type TestWasm = Wasm & CatWasm & { CatSimForTests: new () => Sim };

let wasm: TestWasm;

beforeAll(async () => {
  const w = await loadWasm();
  expect(w, 'the wasm package in src/wasm/pkg').not.toBeNull();
  wasm = w as TestWasm;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Timers that run only when the test moves the clock. */
class FakeTimers implements CatTimers {
  t = 0;
  private timers: { at: number; fn: () => void }[] = [];
  now() {
    return this.t;
  }
  set(fn: () => void, ms: number) {
    const h = { at: this.t + ms, fn };
    this.timers.push(h);
    return h;
  }
  clear(h: unknown) {
    const i = this.timers.indexOf(h as never);
    if (i >= 0) this.timers.splice(i, 1);
  }
  /** Runs the clock forward `ms`, timer by timer, letting promises settle between them. */
  async advance(ms: number) {
    const end = this.t + ms;
    await flush();
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers.splice(this.timers.indexOf(due), 1);
      this.t = due.at;
      due.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/**
 * A serial port with the simulated IC-705 behind it. It answers each write `delayMs` later, and
 * never before an earlier answer: the radio answers frames in order.
 */
class SimPort implements CatTransport {
  written: { at: number; frame: string }[] = [];
  delayMs = 15;
  /** No replies at all. */
  silent = false;
  /** Drops the radio's answer to this many PTT frames. */
  dropPtt = 0;
  /** Answers PTT on with NG and leaves the radio receiving. */
  ngPtt = false;
  /** How the radio answers the next frequency sets, in turn: `ng` refuses and keeps the dial, `drop` sets it and loses the OK. */
  dialAnswers: ('ok' | 'ng' | 'drop')[] = [];
  private lastAt = 0;
  private data = new Set<(b: Uint8Array) => void>();
  private ends = new Set<(e: LinkEnd) => void>();
  constructor(
    readonly sim: Sim,
    private readonly timers: FakeTimers,
  ) {}
  async write(bytes: Uint8Array) {
    this.written.push({ at: this.timers.t, frame: hex(bytes) });
    const ptt = bytes[4] === 0x1c && bytes.length === 8;
    if (this.silent) return;
    const dial = bytes[4] === 0x05 ? this.dialAnswers.shift() : undefined;
    if (dial === 'drop') {
      this.sim.receive(bytes);
      return;
    }
    if (ptt && this.dropPtt > 0) {
      this.dropPtt--;
      this.sim.receive(bytes);
      return;
    }
    const ng = (ptt && this.ngPtt && bytes[6] === 1) || dial === 'ng';
    const reply = ng ? Uint8Array.from([0xfe, 0xfe, 0xe0, 0xa4, 0xfa, 0xfd]) : this.sim.receive(bytes);
    const at = Math.max(this.lastAt, this.timers.t + this.delayMs);
    this.lastAt = at;
    this.timers.set(() => this.send(reply), at - this.timers.t);
  }
  send(bytes: Uint8Array) {
    if (bytes.length) for (const l of this.data) l(bytes);
  }
  onData(fn: (b: Uint8Array) => void) {
    this.data.add(fn);
    return () => this.data.delete(fn);
  }
  onEnd(fn: (e: LinkEnd) => void) {
    this.ends.add(fn);
    return () => this.ends.delete(fn);
  }
  end(e: LinkEnd) {
    for (const l of this.ends) l(e);
  }
  /** Frames written, by their command and sub-command bytes: "03", "1C 00 01". */
  sent(prefix: string) {
    return this.written.filter((w) => w.frame.startsWith(`FE FE A4 E0 ${prefix}`));
  }
  get ptt() {
    return this.written.filter((w) => w.frame.startsWith('FE FE A4 E0 1C 00 0')).map((w) => w.frame.slice(18, 20));
  }
}

function setup() {
  const timers = new FakeTimers();
  const sim = new wasm.CatSimForTests();
  const port = new SimPort(sim, timers);
  const radio = new CatRadio({ codec: wasmCodec(wasm), transport: port, timers });
  return { timers, sim, port, radio };
}

describe('CatRadio', () => {
  it('reads the radio on connecting and sends no PTT', async () => {
    const { timers, port, radio } = setup();
    expect(radio.state.status).toBe('starting');
    radio.start();
    await timers.advance(400);
    expect(radio.state).toMatchObject({ status: 'connected', hz: 14_074_000, mode: 'usb', filter: 1, data: false, transmitting: false, keyed: false });
    // DATA MOD USB, USB SEND off, Time-Out Timer 5 min: the Basic Manual's defaults (pp. 8-4, 8-15,
    // 8-16). Split, RIT and ΔTX off, the offset 0 Hz.
    expect(radio.state.settings).toEqual({ data_mod: 1, usb_send: 0, time_out_timer: 2, split: 0, rit: 0, xit: 0, offset_hz: 0 });
    expect(port.written.map((w) => w.frame)).toEqual([
      'FE FE A4 E0 1C 00 FD',
      'FE FE A4 E0 03 FD',
      'FE FE A4 E0 04 FD',
      'FE FE A4 E0 1A 06 FD',
      'FE FE A4 E0 0F FD',
      'FE FE A4 E0 21 01 FD',
      'FE FE A4 E0 21 02 FD',
      'FE FE A4 E0 21 00 FD',
      'FE FE A4 E0 1A 05 01 25 FD',
      'FE FE A4 E0 1A 05 01 19 FD',
      'FE FE A4 E0 1A 05 00 43 FD',
    ]);
    expect(port.ptt).toEqual([]);
  });

  it('sends one request at a time, each after the answer to the one before', async () => {
    const { timers, port, radio } = setup();
    port.delayMs = 40;
    const a = radio.request({ type: 'read_frequency' });
    const b = radio.request({ type: 'read_mode' });
    await timers.advance(10);
    expect(port.written).toHaveLength(1);
    await timers.advance(40);
    expect(port.written).toHaveLength(2);
    expect(port.written[1].at).toBe(40);
    expect(await a).toEqual({ ok: true, event: { type: 'frequency', hz: 14_074_000, transceive: false } });
    await timers.advance(50);
    expect(await b).toMatchObject({ ok: true, event: { type: 'mode', mode: 'usb' } });
  });

  it('polls the frequency every 1 s and the mode every 5 s', async () => {
    const { timers, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    const before = { f: port.sent('03').length, m: port.sent('04').length, d: port.sent('1A 06').length };
    await timers.advance(10 * POLL_MS);
    expect(port.sent('03').length - before.f).toBe(10);
    expect(port.sent('04').length - before.m).toBe(2);
    expect(port.sent('1A 06').length - before.d).toBe(2);
  });

  it('reads split, duplex, RIT, ΔTX and their offset every 5 s, and none of them while keyed', async () => {
    const { timers, sim, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    expect(radio.state.settings).toMatchObject({ split: 0, rit: 0, xit: 0, offset_hz: 0 });
    // The operator turns split, RIT and ΔTX on at the radio, with the offset at -120 Hz.
    sim.set_split('"on"');
    sim.set_rit(true, true, -120);
    await timers.advance(5 * POLL_MS);
    expect(radio.state.settings).toMatchObject({ split: 1, rit: 1, xit: 1, offset_hz: -120 });
    sim.set_split('"dup_minus"');
    await timers.advance(5 * POLL_MS);
    expect(radio.state.settings).toMatchObject({ split: 2 });
    sim.set_split('"dup_plus"');
    await timers.advance(5 * POLL_MS);
    expect(radio.state.settings).toMatchObject({ split: 3 });
    // Keyed: transmit or receive only, for longer than a mode poll.
    const k = radio.key(15_000);
    await timers.advance(100);
    expect(await k.result).toBe('ok');
    const from = port.written.length;
    await timers.advance(6 * POLL_MS);
    expect(port.written.slice(from).map((w) => w.frame.slice(12, -3))).toEqual(Array(6).fill('1C 00'));
    k.release();
    await timers.advance(200);
    expect(port.ptt).toEqual(['01', '00']);
    expect(sim.sets_while_transmitting).toBe(0);
  });

  it('follows the dial at once from a transceive frame', async () => {
    const { timers, sim, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    port.send(sim.turn_dial(7_074_000));
    expect(radio.state.hz).toBe(7_074_000);
    expect(radio.state.heardAtMs).toBe(400);
  });

  it('counts a request without an answer as lost, and the radio as silent after 3 in a row', async () => {
    const { timers, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    port.silent = true;
    const r = radio.request({ type: 'read_frequency' });
    await timers.advance(REPLY_MS);
    expect(await r).toEqual({ ok: false, why: 'timeout' });
    await timers.advance(LOST_LIMIT * POLL_MS + REPLY_MS);
    expect(radio.state.status).toBe('silent');
    port.silent = false;
    await timers.advance(POLL_MS + 100);
    expect(radio.state.status).toBe('connected');
  });

  it('keys at once beside a request in flight, and stops polling while keyed', async () => {
    const { timers, sim, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    port.delayMs = 40;
    const read = radio.request({ type: 'read_frequency' });
    await timers.advance(5);
    const k = radio.key(15_000);
    expect(radio.state.keyed).toBe(true);
    await timers.advance(1);
    expect(port.ptt).toEqual(['01']);
    await timers.advance(100);
    expect(await k.result).toBe('ok');
    expect(await read).toMatchObject({ ok: true });
    expect(sim.transmit).toBe(true);
    const polls = port.sent('03').length;
    await timers.advance(5 * POLL_MS);
    expect(port.sent('03').length).toBe(polls);
    k.release();
    expect(radio.state.keyed).toBe(false);
    await timers.advance(100);
    expect(port.ptt).toEqual(['01', '00']);
    expect(sim.transmit).toBe(false);
    await timers.advance(2 * POLL_MS);
    expect(port.sent('03').length).toBeGreaterThan(polls);
  });

  it('sends PTT on and off ahead of requests waiting in the queue', async () => {
    const { timers, port, radio } = setup();
    port.delayMs = 40;
    const reads = [radio.request({ type: 'read_frequency' }), radio.request({ type: 'read_mode' }), radio.request({ type: 'read_data_mode' })];
    await timers.advance(5);
    const k = radio.key(15_000);
    await timers.advance(1);
    // The read in flight, then PTT on; the two queued reads wait.
    expect(port.written.map((w) => w.frame)).toEqual(['FE FE A4 E0 03 FD', 'FE FE A4 E0 1C 00 01 FD']);
    await timers.advance(200);
    expect(await k.result).toBe('ok');
    for (const r of reads) expect(await r).toMatchObject({ ok: true });
    // Keyed: reads queue behind one in flight, and PTT off goes before them.
    const more = [radio.request({ type: 'read_transmit' }), radio.request({ type: 'read_setting', item: 'usb_send' })];
    await timers.advance(5);
    const n = port.written.length;
    k.release();
    await timers.advance(1);
    expect(port.written.slice(n - 1).map((w) => w.frame)).toEqual(['FE FE A4 E0 1C 00 FD', 'FE FE A4 E0 1C 00 00 FD']);
    await timers.advance(500);
    for (const r of more) expect(await r).toMatchObject({ ok: true });
  });

  it('reads a menu setting again every 5 s until the radio answers it, and not one it refused', async () => {
    const { timers, port, radio } = setup();
    // The first read of USB SEND goes unanswered.
    const write = port.write.bind(port);
    let dropped = 0;
    port.write = async (bytes) => {
      if (hex(bytes) === 'FE FE A4 E0 1A 05 01 25 FD' && dropped++ === 0) {
        port.written.push({ at: timers.t, frame: hex(bytes) });
        return;
      }
      return write(bytes);
    };
    radio.start();
    await timers.advance(2000);
    expect(radio.state.settings.usb_send).toBeUndefined();
    expect(radio.state.settings).toMatchObject({ data_mod: 1, time_out_timer: 2 });
    await timers.advance(4 * POLL_MS);
    expect(radio.state.settings.usb_send).toBe(0);
    expect(port.sent('1A 05 01 25')).toHaveLength(2);
    // Read once each after that.
    await timers.advance(10 * POLL_MS);
    expect(port.sent('1A 05 01 25')).toHaveLength(2);
    expect(port.sent('1A 05 01 19')).toHaveLength(1);
  });

  it('resolves unkeyed() once a read confirms receive, and false when PTT off goes unconfirmed', async () => {
    const ok = setup();
    expect(await ok.radio.unkeyed()).toBe(true);
    const k = ok.radio.key(15_000);
    await ok.timers.advance(50);
    expect(k.held).toBe(true);
    k.release();
    expect(k.held).toBe(false);
    const confirmed = ok.radio.unkeyed();
    await ok.timers.advance(100);
    expect(await confirmed).toBe(true);
    const lost = setup();
    const k2 = lost.radio.key(15_000);
    await lost.timers.advance(50);
    lost.port.silent = true;
    k2.release();
    const unconfirmed = lost.radio.unkeyed();
    await lost.timers.advance(UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS + REPLY_MS + 100);
    expect(await unconfirmed).toBe(false);
    expect(lost.radio.state.unkeyFailed).toBe(true);
  });

  it('a keying is no longer held after Halt’s PTT off or the link ending', async () => {
    const { timers, port, radio } = setup();
    const a = radio.key(15_000);
    await timers.advance(50);
    radio.unkeyAll();
    expect(a.held).toBe(false);
    const b = radio.key(15_000);
    await timers.advance(50);
    expect(b.held).toBe(true);
    port.end('lost');
    expect(b.held).toBe(false);
  });

  it('takes no receive reading as a fault in the 100 ms after the OK, while the radio switches over', async () => {
    const { timers, port, radio } = setup();
    const faults: string[] = [];
    radio.onFault((f) => faults.push(f));
    radio.start();
    await timers.advance(400);
    // A radio slow to switch: it says receive for a while after its OK.
    const write = port.write.bind(port);
    let lagUntil = 0;
    port.write = async (bytes) => {
      if (hex(bytes) === 'FE FE A4 E0 1C 00 FD' && timers.t < lagUntil) {
        port.written.push({ at: timers.t, frame: hex(bytes) });
        port.send(Uint8Array.from([0xfe, 0xfe, 0xe0, 0xa4, 0x1c, 0x00, 0x00, 0xfd]));
        return;
      }
      return write(bytes);
    };
    // Keyed 50 ms before the poll at 1000 ms: the OK comes at 965 ms, and the radio says receive
    // until 1030 ms.
    await timers.advance(950 - 400);
    const k = radio.key(15_000);
    lagUntil = timers.t + 80;
    await timers.advance(60);
    expect(port.sent('1C 00 FD').filter((w) => w.at >= 950)).toEqual([]);
    expect(faults).toEqual([]);
    // The next poll reads transmit.
    await timers.advance(POLL_MS);
    expect(port.sent('1C 00 FD').filter((w) => w.at >= 950).map((w) => w.at)).toEqual([2000]);
    expect(faults).toEqual([]);
    expect(k.held).toBe(true);
  });

  it('says why PTT on failed: no answer in 300 ms, or NG', async () => {
    const silent = setup();
    silent.port.silent = true;
    const k = silent.radio.key(15_000);
    await silent.timers.advance(PTT_TIMEOUT_MS - 1);
    let settled = false;
    void k.result.then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    await silent.timers.advance(1);
    expect(await k.result).toBe('timeout');
    const ng = setup();
    ng.port.ngPtt = true;
    const k2 = ng.radio.key(15_000);
    await ng.timers.advance(50);
    expect(await k2.result).toBe('ng');
  });

  it('sends PTT off once when the radio answers OK, then confirms receive with a read', async () => {
    const { timers, sim, port, radio } = setup();
    const k = radio.key(15_000);
    await timers.advance(50);
    k.release();
    expect(radio.holdsPtt).toBe(true);
    await timers.advance(50);
    expect(port.ptt).toEqual(['01', '00']);
    expect(port.written.at(-1)!.frame).toBe('FE FE A4 E0 1C 00 FD');
    expect(sim.transmit).toBe(false);
    expect(radio.holdsPtt).toBe(false);
  });

  it('sends PTT off again 100 ms apart, 4 times at most, when an OK goes missing, then confirms with a read', async () => {
    const { timers, sim, port, radio } = setup();
    const k = radio.key(15_000);
    await timers.advance(50);
    port.dropPtt = 1;
    k.release();
    await timers.advance(UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS + 100);
    // OKs after a missing one could be late ones, so all 4 go out, and the read decides.
    expect(port.ptt).toEqual(['01', ...Array(UNKEY_TRIES).fill('00')]);
    const offs = port.sent('1C 00 00');
    expect(offs.map((o) => o.at - offs[0].at)).toEqual([0, 1, 2, 3].map((n) => n * UNKEY_ACK_MS));
    expect(port.written.at(-1)!.frame).toBe('FE FE A4 E0 1C 00 FD');
    expect(sim.transmit).toBe(false);
    expect(radio.state.unkeyFailed).toBe(false);
    expect(radio.holdsPtt).toBe(false);
  });

  it('says when PTT off is never confirmed, keeps counting the radio as keyed, and clears once a read says receive', async () => {
    const { timers, sim, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    const k = radio.key(15_000);
    await timers.advance(50);
    port.silent = true;
    k.release();
    await timers.advance(UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS + REPLY_MS + 50);
    expect(port.ptt.slice(1)).toEqual(Array(UNKEY_TRIES).fill('00'));
    expect(radio.state.unkeyFailed).toBe(true);
    expect(radio.holdsPtt).toBe(true);
    expect(await radio.tune(7_074_000)).toEqual({ ok: false, why: 'busy' });
    // The radio answers again and still transmits: the next poll reads it and sends PTT off again.
    port.silent = false;
    expect(sim.transmit).toBe(true);
    await timers.advance(POLL_MS + 500);
    expect(sim.transmit).toBe(false);
    expect(radio.state.unkeyFailed).toBe(false);
    expect(radio.holdsPtt).toBe(false);
  });

  it('sends PTT off at once after PTT on goes unanswered, and confirms it', async () => {
    const { timers, sim, port, radio } = setup();
    port.delayMs = PTT_TIMEOUT_MS + 50;
    const k = radio.key(15_000);
    await timers.advance(PTT_TIMEOUT_MS);
    port.delayMs = 15;
    expect(await k.result).toBe('timeout');
    expect(radio.state.keyed).toBe(false);
    expect(port.sent('1C 00 00')[0].at).toBe(PTT_TIMEOUT_MS);
    expect(radio.holdsPtt).toBe(true);
    await timers.advance(UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS + 100);
    expect(sim.transmit).toBe(false);
    expect(radio.holdsPtt).toBe(false);
  });

  it('never sends a PTT on held back by a drain once Halt has sent PTT off', async () => {
    const { timers, sim, port, radio } = setup();
    radio.start();
    await timers.advance(400);
    // A read goes unanswered: the drain starts when it times out, and PTT on waits for its end.
    port.silent = true;
    void radio.request({ type: 'read_frequency' });
    await timers.advance(REPLY_MS);
    port.silent = false;
    const k = radio.key(15_000);
    await timers.advance(1);
    expect(port.ptt).toEqual([]);
    // Halt inside the drain: PTT off at once.
    radio.unkeyAll();
    await timers.advance(1);
    expect(port.ptt).toEqual(['00']);
    await timers.advance(DRAIN_MS + 1000);
    expect(await k.result).toBe('closed');
    expect(port.ptt.every((p) => p === '00')).toBe(true);
    expect(sim.transmit).toBe(false);
    expect(radio.state.unkeyFailed).toBe(false);
  });

  it('sends what waited for a drain when its timer fires a moment before the clock reaches the drain’s end', async () => {
    const { timers, port, radio } = setup();
    // Browser timers may fire a fraction of a millisecond early against performance.now().
    const set = timers.set.bind(timers);
    timers.set = (fn, ms) => set(fn, Math.max(0, ms - 0.5));
    port.silent = true;
    void radio.request({ type: 'read_frequency' });
    await timers.advance(REPLY_MS);
    port.silent = false;
    const next = radio.request({ type: 'read_mode' });
    await timers.advance(DRAIN_MS + 100);
    expect(port.sent('04')).toHaveLength(1);
    expect(await next).toMatchObject({ ok: true });
  });

  it('never takes a late OK for the answer to a later request', async () => {
    const { timers, port, radio } = setup();
    // A dial set answered after its timeout, then PTT on that the radio never answers.
    port.delayMs = REPLY_MS + 100;
    const set = radio.request({ type: 'set_frequency', hz: 7_074_000 });
    await timers.advance(REPLY_MS);
    expect(await set).toEqual({ ok: false, why: 'timeout' });
    port.delayMs = 15;
    port.dropPtt = 1;
    const k = radio.key(15_000);
    // PTT on waits for the drain, in which the late OK came and was dropped.
    await timers.advance(DRAIN_MS - 1);
    expect(port.ptt).toEqual([]);
    await timers.advance(1 + PTT_TIMEOUT_MS);
    expect(port.ptt).toEqual(['01', '00']);
    expect(await k.result).toBe('timeout');
  });

  it('refuses dial and mode sets while keyed or while the radio transmits', async () => {
    const { timers, sim, radio } = setup();
    const k = radio.key(15_000);
    await timers.advance(50);
    expect(await radio.request({ type: 'set_frequency', hz: 7_074_000 })).toEqual({ ok: false, why: 'busy' });
    expect(await radio.request({ type: 'set_mode', mode: 'usb', filter: 1 })).toEqual({ ok: false, why: 'busy' });
    expect(await radio.tune(7_074_000)).toEqual({ ok: false, why: 'busy' });
    k.release();
    await timers.advance(100);
    const t = radio.tune(7_074_000);
    await timers.advance(200);
    expect(await t).toMatchObject({ ok: true });
    // Keyed by the operator (VOX, the microphone's PTT): the radio says transmit.
    sim.receive(wasm.cat_encode('{"type":"set_transmit","on":true}', 0xa4));
    const busy = radio.tune(14_074_000);
    await timers.advance(100);
    expect(await busy).toEqual({ ok: false, why: 'busy' });
    expect(sim.frequency).toBe(7_074_000);
  });

  it('releases PTT by itself after maxMs', async () => {
    const { timers, sim, radio } = setup();
    radio.key(2000);
    await timers.advance(1999);
    expect(sim.transmit).toBe(true);
    await timers.advance(100);
    expect(sim.transmit).toBe(false);
    expect(radio.state.keyed).toBe(false);
  });

  it('releases after the tail, unless a later keying holds PTT; Halt releases whoever keyed', async () => {
    const { timers, port, radio } = setup();
    const a = radio.key(15_000);
    await timers.advance(50);
    a.release(100);
    await timers.advance(99);
    expect(port.ptt).toEqual(['01']);
    await timers.advance(1);
    expect(port.ptt).toEqual(['01', '00']);
    const b = radio.key(15_000);
    await timers.advance(50);
    b.release(100);
    const c = radio.key(15_000);
    await timers.advance(200);
    expect(port.ptt).toEqual(['01', '00', '01', '01']);
    // An earlier keying released late leaves the later one on the air.
    b.release();
    expect(radio.state.keyed).toBe(true);
    radio.unkeyAll();
    expect(radio.state.keyed).toBe(false);
    await timers.advance(1);
    expect(port.ptt.at(-1)).toBe('00');
    c.release();
    await timers.advance(100);
    expect(port.ptt.filter((p) => p === '00')).toHaveLength(2);
  });

  it('sends PTT off for unkeyAll with nothing keyed', async () => {
    const { timers, port, radio } = setup();
    radio.unkeyAll();
    await timers.advance(50);
    expect(port.ptt).toEqual(['00']);
  });

  it('tunes to a dial in USB-D and reads it back', async () => {
    const { timers, sim, port, radio } = setup();
    const done = radio.tune(7_074_000);
    await timers.advance(300);
    expect(await done).toMatchObject({ ok: true });
    // Transmit or receive first: the dial never changes while the radio transmits.
    expect(port.written.slice(0, 4).map((w) => w.frame)).toEqual(['FE FE A4 E0 1C 00 FD', 'FE FE A4 E0 05 00 40 07 07 00 FD', 'FE FE A4 E0 06 01 01 FD', 'FE FE A4 E0 1A 06 01 01 FD']);
    expect([sim.frequency, sim.mode, sim.data, sim.filter]).toEqual([7_074_000, '"usb"', true, 1]);
    expect(radio.state).toMatchObject({ hz: 7_074_000, mode: 'usb', data: true });
  });

  it('reports a refused dial as NG and stops there', async () => {
    const { timers, port, radio } = setup();
    // 300 MHz is outside the receiver's coverage (Basic Manual p. 11-1): the simulator refuses it.
    const done = radio.tune(300_000_000);
    await timers.advance(300);
    expect(await done).toMatchObject({ ok: false, why: 'ng' });
    expect(port.sent('06')).toEqual([]);
  });

  it('ends with lost when the port goes, answers what waits, and remembers PTT was on', async () => {
    const { timers, port, radio } = setup();
    const ends: LinkEnd[] = [];
    radio.onEnd((e) => ends.push(e));
    radio.start();
    await timers.advance(400);
    radio.key(15_000);
    await timers.advance(50);
    port.silent = true;
    const r = radio.request({ type: 'read_frequency' });
    port.end('lost');
    expect(ends).toEqual(['lost']);
    expect(radio.state).toMatchObject({ status: 'lost', keyed: false });
    expect(await r).toEqual({ ok: false, why: 'closed' });
    expect(radio.endedKeyed).toBe(true);
    const n = port.written.length;
    await timers.advance(5 * POLL_MS);
    expect(port.written).toHaveLength(n);
    expect(await radio.request({ type: 'read_mode' })).toEqual({ ok: false, why: 'closed' });
  });

  it('a link that ends after PTT off was answered needs no recovery', async () => {
    const { timers, port, radio } = setup();
    const k = radio.key(15_000);
    await timers.advance(50);
    k.release();
    await timers.advance(50);
    port.end('lost');
    expect(radio.endedKeyed).toBe(false);
  });

  it('on a recovery connection, sends PTT off only when the radio still transmits', async () => {
    const left = setup();
    left.sim.receive(wasm.cat_encode('{"type":"set_transmit","on":true}', 0xa4));
    expect(left.sim.transmit).toBe(true);
    left.radio.start({ recover: true });
    await left.timers.advance(400);
    expect(left.port.ptt).toEqual(['00']);
    expect(left.sim.transmit).toBe(false);
    // Without recovery, connecting sends no PTT whatever the radio does.
    const plain = setup();
    plain.sim.receive(wasm.cat_encode('{"type":"set_transmit","on":true}', 0xa4));
    plain.radio.start();
    await plain.timers.advance(400);
    expect(plain.port.ptt).toEqual([]);
    expect(plain.radio.state.transmitting).toBe(true);
    // Recovery with the radio receiving sends nothing either.
    const quiet = setup();
    quiet.radio.start({ recover: true });
    await quiet.timers.advance(400);
    expect(quiet.port.ptt).toEqual([]);
  });

  it('drops the echo of its own frames with CI-V USB Echo Back on', async () => {
    const { timers, sim, radio } = setup();
    sim.set_setting('"civ_usb_echo_back"', 1);
    radio.start();
    await timers.advance(400);
    expect(radio.state).toMatchObject({ status: 'connected', hz: 14_074_000, mode: 'usb' });
    const k = radio.key(15_000);
    await timers.advance(50);
    expect(await k.result).toBe('ok');
  });

  it('says when the port sends only bytes that are not CI-V frames', async () => {
    const { port, radio } = setup();
    port.silent = true;
    radio.start();
    port.send(new TextEncoder().encode('$GPGGA,123519,4807.038,N\r\n'));
    expect(radio.state).toMatchObject({ status: 'starting', noiseOnly: true });
  });

  it('while keyed, reads transmit or receive every second, and a radio that says receive is a fault with PTT off', async () => {
    const { timers, sim, port, radio } = setup();
    const faults: string[] = [];
    radio.onFault((f) => faults.push(f));
    radio.start();
    await timers.advance(400);
    const k = radio.key(60_000);
    await timers.advance(POLL_MS + 100);
    expect(port.sent('1C 00 FD').length).toBeGreaterThanOrEqual(2);
    expect(faults).toEqual([]);
    // The radio's own Time-Out Timer, or its PTT: it receives again.
    sim.receive(wasm.cat_encode('{"type":"set_transmit","on":false}', 0xa4));
    await timers.advance(POLL_MS + 100);
    expect(faults).toEqual(['receive']);
    expect(radio.state.keyed).toBe(false);
    expect(port.ptt.at(-1)).toBe('00');
    k.release();
    expect(port.ptt.filter((p) => p === '00')).toHaveLength(1);
  });

  it('while keyed, a radio that stops answering is a fault with PTT off', async () => {
    const { timers, port, radio } = setup();
    const faults: string[] = [];
    radio.onFault((f) => faults.push(f));
    radio.start();
    await timers.advance(400);
    radio.key(60_000);
    await timers.advance(50);
    port.silent = true;
    await timers.advance(LOST_LIMIT * (POLL_MS + REPLY_MS));
    expect(faults).toEqual(['silent']);
    expect(radio.state.keyed).toBe(false);
    expect(port.ptt.slice(0, 2)).toEqual(['01', '00']);
  });
});

describe('CatRadio with a dial shift', () => {
  const TX_DIAL = 'FE FE A4 E0 05 00 50 07 14 00 FD';
  const RX_DIAL = 'FE FE A4 E0 05 00 40 07 14 00 FD';

  /** Connected and read: the radio's dial, 14.074 MHz, is known. */
  async function ready() {
    const s = setup();
    s.radio.start();
    await s.timers.advance(400);
    return s;
  }

  const frames = (port: SimPort, from: number) => port.written.slice(from).map((w) => w.frame);

  it('sets the Tx dial and waits for its OK before PTT on, and sets the receive dial back after PTT off is confirmed', async () => {
    const { timers, sim, port, radio } = await ready();
    const n = port.written.length;
    const k = radio.key(15_000, 1000);
    await timers.advance(1);
    // The dial only: PTT on waits for the radio's OK to it.
    expect(frames(port, n)).toEqual([TX_DIAL]);
    expect(radio.holdsPtt).toBe(false);
    await timers.advance(50);
    expect(await k.result).toBe('ok');
    expect(frames(port, n)).toEqual([TX_DIAL, 'FE FE A4 E0 1C 00 01 FD']);
    expect(port.sent('1C 00 01')[0].at - port.sent('05')[0].at).toBe(port.delayMs);
    expect([sim.frequency, sim.transmit]).toEqual([14_075_000, true]);
    // On the air for 3 s: the state keeps the receive dial, and the dial is not read.
    await timers.advance(3 * POLL_MS);
    expect(radio.state.hz).toBe(14_074_000);
    expect(radio.shifted).toBe(true);
    k.release();
    await timers.advance(100);
    const after = frames(port, n);
    const back = after.indexOf(RX_DIAL);
    expect(after.slice(0, back).filter((f) => f.startsWith('FE FE A4 E0 03'))).toEqual([]);
    // PTT off, the read that confirms receive, the receive dial, and a read of it.
    expect(after.slice(back - 2, back + 2)).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', RX_DIAL, 'FE FE A4 E0 03 FD']);
    expect([sim.frequency, sim.transmit]).toEqual([14_074_000, false]);
    expect(sim.sets_while_transmitting).toBe(0);
    expect(radio.shifted).toBe(false);
    expect(await radio.dialRestored()).toBe(true);
    // The dial is read again, and polled every 1 s.
    await timers.advance(POLL_MS + 50);
    expect(port.sent('03').length).toBeGreaterThan(0);
    expect(radio.state.hz).toBe(14_074_000);
  });

  it('keeps the receive dial in the state when the radio reports the Tx dial', async () => {
    const { timers, port, radio } = await ready();
    const changes: (number | null)[] = [];
    radio.onChange((st) => changes.push(st.hz));
    const k = radio.key(15_000, -500);
    await timers.advance(50);
    expect(await k.result).toBe('ok');
    // A transceive frame of the Tx dial, as the radio may send after a set.
    port.send(new wasm.CatSimForTests().turn_dial(14_073_500));
    await timers.advance(10);
    expect(radio.state.hz).toBe(14_074_000);
    k.release();
    await timers.advance(POLL_MS + 100);
    expect(radio.state.hz).toBe(14_074_000);
    expect(changes.every((hz) => hz === 14_074_000)).toBe(true);
  });

  it('sends no PTT when the radio refuses the Tx dial, and sets the receive dial', async () => {
    const { timers, sim, port, radio } = await ready();
    const n = port.written.length;
    port.dialAnswers = ['ng'];
    const k = radio.key(15_000, 1000);
    await timers.advance(100);
    expect(await k.result).toBe('dial');
    expect(k.held).toBe(false);
    expect(port.ptt).toEqual([]);
    expect(frames(port, n).slice(0, 2)).toEqual([TX_DIAL, RX_DIAL]);
    expect(sim.frequency).toBe(14_074_000);
    expect(radio.shifted).toBe(false);
  });

  it('sends no PTT when the Tx dial goes unanswered, and sets the receive dial after the drain', async () => {
    const { timers, sim, port, radio } = await ready();
    const n = port.written.length;
    port.dialAnswers = ['drop'];
    const k = radio.key(15_000, 1000);
    await timers.advance(DIAL_TIMEOUT_MS - 1);
    expect(port.ptt).toEqual([]);
    await timers.advance(1);
    expect(await k.result).toBe('dial');
    // The radio took the dial and its OK went missing: the receive dial goes back once the drain ends.
    expect(sim.frequency).toBe(14_075_000);
    await timers.advance(DRAIN_MS + 50);
    expect(port.ptt).toEqual([]);
    expect(frames(port, n).slice(0, 2)).toEqual([TX_DIAL, RX_DIAL]);
    expect(port.sent('05')[1].at - port.sent('05')[0].at).toBeGreaterThanOrEqual(DIAL_TIMEOUT_MS + DRAIN_MS);
    expect(sim.frequency).toBe(14_074_000);
  });

  it('Halt during a shifted transmission sends PTT off at once, then sets the receive dial back', async () => {
    const { timers, sim, port, radio } = await ready();
    const k = radio.key(15_000, 1000);
    await timers.advance(1000);
    expect(sim.transmit).toBe(true);
    const n = port.written.length;
    radio.unkeyAll();
    expect(frames(port, n)).toEqual(['FE FE A4 E0 1C 00 00 FD']);
    await timers.advance(100);
    expect(frames(port, n)).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', RX_DIAL, 'FE FE A4 E0 03 FD']);
    expect(k.held).toBe(false);
    expect([sim.frequency, sim.transmit, sim.sets_while_transmitting]).toEqual([14_074_000, false, 0]);
  });

  it('released before PTT on, sends no PTT and sets the receive dial back', async () => {
    const { timers, sim, port, radio } = await ready();
    port.delayMs = 40;
    const n = port.written.length;
    const k = radio.key(15_000, 1000);
    await timers.advance(10);
    k.release();
    await timers.advance(200);
    expect(await k.result).toBe('closed');
    expect(port.ptt).toEqual([]);
    expect(frames(port, n)).toEqual([TX_DIAL, RX_DIAL, 'FE FE A4 E0 03 FD']);
    expect(sim.frequency).toBe(14_074_000);
  });

  it('never moves the dial while the radio may be keyed: PTT off goes first and is confirmed', async () => {
    const { timers, sim, port, radio } = await ready();
    const n = port.written.length;
    radio.key(15_000);
    await timers.advance(50);
    const b = radio.key(15_000, 1000);
    await timers.advance(100);
    expect(await b.result).toBe('ok');
    expect(frames(port, n)).toEqual(['FE FE A4 E0 1C 00 01 FD', 'FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', TX_DIAL, 'FE FE A4 E0 1C 00 01 FD']);
    // A keying in a shifted keying's tail: PTT off, the receive dial, then PTT on.
    b.release(100);
    await timers.advance(50);
    const m = port.written.length;
    const c = radio.key(15_000);
    await timers.advance(100);
    expect(await c.result).toBe('ok');
    expect(frames(port, m)).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', RX_DIAL, 'FE FE A4 E0 1C 00 01 FD']);
    expect(sim.frequency).toBe(14_074_000);
    expect(sim.sets_while_transmitting).toBe(0);
  });

  it('holds back the band sheet’s dial while the radio is on the Tx dial', async () => {
    const { timers, sim, radio } = await ready();
    const k = radio.key(15_000, 1000);
    await timers.advance(50);
    expect(await radio.tune(7_074_000)).toEqual({ ok: false, why: 'busy' });
    expect(await radio.request({ type: 'set_frequency', hz: 7_074_000 })).toEqual({ ok: false, why: 'busy' });
    k.release();
    await timers.advance(100);
    const t = radio.tune(7_074_000);
    await timers.advance(300);
    expect(await t).toMatchObject({ ok: true });
    expect(sim.frequency).toBe(7_074_000);
  });

  it('says when the radio does not take the receive dial back, and then shows the dial it reads', async () => {
    const { timers, sim, port, radio } = await ready();
    const restored: boolean[] = [];
    radio.onRestore((ok) => restored.push(ok));
    port.dialAnswers = ['ok', 'ng'];
    const k = radio.key(15_000, 1000);
    await timers.advance(50);
    const waiting = radio.dialRestored();
    k.release();
    await timers.advance(200);
    expect(restored).toEqual([false]);
    expect(await waiting).toBe(false);
    expect(sim.frequency).toBe(14_075_000);
    expect(radio.state.hz).toBe(14_075_000);
    expect(radio.shifted).toBe(false);
  });

  it('after a lost port, the next connection sets the receive dial back while the radio still reads the Tx dial', async () => {
    const left = await ready();
    left.radio.key(15_000, 1000);
    await left.timers.advance(50);
    left.port.end('lost');
    expect(left.radio.endedKeyed).toBe(true);
    expect(left.radio.endedShift).toEqual({ rxHz: 14_074_000, txHz: 14_075_000 });
    const again = (sim: Sim, timers: FakeTimers) => {
      const port = new SimPort(sim, timers);
      return { port, radio: new CatRadio({ codec: wasmCodec(wasm), transport: port, timers }) };
    };
    const back = again(left.sim, left.timers);
    back.radio.start({ recover: true, shifted: left.radio.endedShift });
    await left.timers.advance(400);
    expect(back.port.ptt).toEqual(['00']);
    expect(back.port.sent('05').map((w) => w.frame)).toEqual([RX_DIAL]);
    expect([left.sim.frequency, left.sim.transmit, left.sim.sets_while_transmitting]).toEqual([14_074_000, false, 0]);
    expect(back.radio.state.hz).toBe(14_074_000);
    // The operator turned the dial meanwhile: RR73 leaves it there.
    const turned = await ready();
    turned.radio.key(15_000, 1000);
    await turned.timers.advance(50);
    turned.port.end('lost');
    turned.sim.receive(wasm.cat_encode('{"type":"set_transmit","on":false}', 0xa4));
    turned.sim.turn_dial(7_074_000);
    const moved = again(turned.sim, turned.timers);
    moved.radio.start({ shifted: turned.radio.endedShift });
    await turned.timers.advance(400);
    expect(moved.port.sent('05')).toEqual([]);
    expect(moved.radio.state.hz).toBe(7_074_000);
  });
});
