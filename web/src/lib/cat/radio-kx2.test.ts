// CatRadio with the KX2's traits against a fake serial port whose answers come from the simulated
// KX2 of the rr73-cat crate (CatKx2SimForTests in crates/rr73-wasm/src/cat_kx2.rs), on a fake
// clock. Commands follow Elecraft's K3S/K3/KX3/KX2 Programmer's Reference, Rev. G5: p. 3 format and
// ?;, p. 11 FA and DT, p. 16 MD, p. 21 OM, p. 23 RX, p. 27 TQ, p. 28 TX and VX.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import { kx2Codec, type CatWasm } from './protocol';
import { CatRadio, DRAIN_MS, POLL_MS, PTT_READ_MS, REPLY_MS, UNKEY_ACK_MS, UNKEY_TRIES, type CatTimers, type CatTransport } from './radio';
import { KX2, KX2_BAND_CHANGE_MS } from './radios';
import type { LinkEnd } from './serial';
import { PTT_TIMEOUT_MS } from '../tx/keyer';

interface Kx2Sim {
  receive(bytes: Uint8Array): Uint8Array;
  turn_dial(hz: number): Uint8Array;
  press_mode(mode: string): Uint8Array;
  press_sub(sub: string): void;
  open_menu(entry: number): void;
  mic_btn: number;
  set_vox_data(on: boolean): void;
  set_auto_info(n: number): void;
  set_product(n: number): void;
  press_xmit(on: boolean): void;
  set_lines(dtr: boolean, rts: boolean): void;
  readonly transmit: boolean;
  readonly frequency: number;
  readonly mode: string;
  readonly sub: string;
  readonly menu: number;
  readonly sets_while_transmitting: number;
}

type TestWasm = Wasm & CatWasm & { CatKx2SimForTests: new () => Kx2Sim };

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

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);

/**
 * A serial port with the simulated KX2 behind it. It answers each write `delayMs` later, never
 * before an earlier answer: the radio answers in order.
 */
class Kx2Port implements CatTransport {
  written: { at: number; text: string }[] = [];
  delayMs = 15;
  silent = false;
  /** The next this many reads of TQ after TX say receive, as a radio still switching over. */
  slowKey = 0;
  /** TX is answered ?; and the radio stays in receive. */
  busyTx = false;
  /** The radio ignores RX and keeps transmitting. */
  ignoreRx = false;
  /** Drops the answer to this many TX or RX requests; the radio still acts on them. */
  dropPtt = 0;
  /** A frequency set that changes band holds its answer this long, ms (Programmer's Reference p. 11). */
  bandChangeMs = 0;
  /** Each answer to these commands is replaced: `FA;` answered `?;` and then the read, as a late pair. */
  replace = new Map<string, string>();
  private slowLeft = 0;
  private lastAt = 0;
  private data = new Set<(b: Uint8Array) => void>();
  private ends = new Set<(e: LinkEnd) => void>();
  constructor(
    readonly sim: Kx2Sim,
    private readonly timers: FakeTimers,
  ) {}
  async write(b: Uint8Array) {
    const t = text(b);
    this.written.push({ at: this.timers.t, text: t });
    if (this.silent) return;
    const before = this.sim.frequency;
    let reply: string;
    if (t === 'TX;TQ;' && this.busyTx) reply = '?;' + text(this.sim.receive(bytes('TQ;')));
    else if (t === 'RX;TQ;' && this.ignoreRx) reply = 'TQ1;';
    else reply = this.replace.get(t) ?? text(this.sim.receive(b));
    if (t === 'TX;TQ;' && this.slowKey > 0) {
      this.slowLeft = this.slowKey;
      this.slowKey = 0;
    }
    if (t.endsWith('TQ;') && this.slowLeft > 0 && reply.endsWith('TQ1;')) {
      this.slowLeft--;
      reply = reply.replace('TQ1;', 'TQ0;');
    }
    if ((t === 'TX;TQ;' || t === 'RX;TQ;') && this.dropPtt > 0) {
      this.dropPtt--;
      return;
    }
    const bandChange = Math.round(before / 1e6) !== Math.round(this.sim.frequency / 1e6);
    const at = Math.max(this.lastAt, this.timers.t + this.delayMs + (bandChange ? this.bandChangeMs : 0));
    this.lastAt = at;
    this.timers.set(() => this.send(bytes(reply)), at - this.timers.t);
  }
  send(b: Uint8Array) {
    if (b.length) for (const l of this.data) l(b);
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
  /** Requests written that start with this text. */
  sent(prefix: string) {
    return this.written.filter((w) => w.text.startsWith(prefix));
  }
  /** TX and RX in the order written: "TX", "RX". */
  get ptt() {
    return this.written.filter((w) => w.text === 'TX;TQ;' || w.text === 'RX;TQ;').map((w) => w.text.slice(0, 2));
  }
}

function setup() {
  const timers = new FakeTimers();
  const sim = new wasm.CatKx2SimForTests();
  const port = new Kx2Port(sim, timers);
  const radio = new CatRadio({ codec: kx2Codec(wasm), traits: KX2, transport: port, timers });
  return { timers, sim, port, radio };
}

/** Connects and lets the reads on connecting finish. */
async function started() {
  const s = setup();
  s.radio.start();
  await s.timers.advance(600);
  return s;
}

describe('CatRadio with a KX2', () => {
  it('reads the radio on connecting, transmit first, then MIC BTN once OM names a KX2 and no menu is open; no TX or RX', async () => {
    const { port, radio } = await started();
    expect(radio.state).toMatchObject({ status: 'connected', hz: 14_074_000, mode: 'usb', sub: 'data_a', transmitting: false, keyed: false });
    // OM 01: a KX2. MIC BTN at its default, PTT UP.DN (Owner's Manual p. 48). VOX off in USB.
    expect(radio.state.settings).toEqual({ product: 1, mic_btn: 5, vox: 0 });
    expect(port.written.map((w) => w.text)).toEqual(['TQ;', 'FA;', 'MD;', 'DT;', 'VX;', 'OM;', 'MN;', 'MN082;MP;MN255;']);
    expect(port.ptt).toEqual([]);
  });

  it('polls VFO A every 1 s and the mode, sub-mode and VOX every 5 s', async () => {
    const { timers, port } = await started();
    const before = { fa: port.sent('FA;').length, md: port.sent('MD;').length, vx: port.sent('VX;').length };
    await timers.advance(10 * POLL_MS);
    expect(port.sent('FA;').length - before.fa).toBe(10);
    expect(port.sent('MD;').length - before.md).toBe(2);
    expect(port.sent('VX;').length - before.vx).toBe(2);
  });

  it('follows the dial at once from auto-info: IF in mode 1, FA in mode 2', async () => {
    const { timers, sim, port, radio } = await started();
    sim.set_auto_info(1);
    port.send(sim.turn_dial(14_076_000));
    expect(radio.state.hz).toBe(14_076_000);
    sim.set_auto_info(2);
    port.send(sim.turn_dial(7_074_000));
    expect(radio.state.hz).toBe(7_074_000);
    port.send(sim.press_mode('"data"'));
    expect(radio.state.mode).toBe('data');
    expect(radio.state.heardAtMs).toBe(timers.t);
  });

  it('does not read MIC BTN while the operator has a menu entry open, and reads it once the menu closes', async () => {
    const { timers, sim, port, radio } = setup();
    sim.open_menu(57);
    radio.start();
    await timers.advance(600);
    expect(radio.state.settings.mic_btn).toBeUndefined();
    expect(port.sent('MN082')).toHaveLength(0);
    // The menu stays as the operator left it.
    expect(sim.menu).toBe(57);
    sim.open_menu(255);
    await timers.advance(5 * POLL_MS);
    expect(radio.state.settings.mic_btn).toBe(5);
    expect(sim.menu).toBe(255);
    // Read once.
    await timers.advance(10 * POLL_MS);
    expect(port.sent('MN082')).toHaveLength(1);
  });

  it('never reads a menu entry on a radio that is not a KX2: the numbers are the KX2’s', async () => {
    const { timers, sim, port, radio } = setup();
    sim.set_product(2);
    radio.start();
    await timers.advance(600 + 10 * POLL_MS);
    expect(radio.state.settings.product).toBe(2);
    expect(port.sent('MN')).toHaveLength(0);
  });

  it('keys with TX, confirmed by TQ1, beside a request in flight, and reads only TQ while keyed', async () => {
    const { timers, sim, port, radio } = await started();
    port.delayMs = 40;
    const read = radio.request({ type: 'read_frequency' });
    await timers.advance(5);
    const k = radio.key(15_000);
    await timers.advance(1);
    expect(port.ptt).toEqual(['TX']);
    await timers.advance(100);
    expect(await k.result).toBe('ok');
    expect(await read).toMatchObject({ ok: true });
    expect(sim.transmit).toBe(true);
    const polls = port.sent('FA;').length;
    const reads = port.sent('TQ;').length;
    await timers.advance(5 * POLL_MS);
    expect(port.sent('FA;').length).toBe(polls);
    expect(port.sent('TQ;').length - reads).toBe(5);
    k.release();
    await timers.advance(200);
    expect(port.ptt).toEqual(['TX', 'RX']);
    expect(sim.transmit).toBe(false);
  });

  it('reads TQ again, 50 ms apart, when the radio still says receive after TX, and keys once it says transmit', async () => {
    const { timers, port, radio } = await started();
    port.slowKey = 2;
    const k = radio.key(15_000);
    await timers.advance(PTT_TIMEOUT_MS);
    expect(await k.result).toBe('ok');
    const tq = port.sent('TQ;').filter((w) => w.at >= timers.t - PTT_TIMEOUT_MS);
    expect(tq).toHaveLength(2);
    expect(tq[1].at - tq[0].at).toBeGreaterThanOrEqual(PTT_READ_MS);
    expect(port.ptt).toEqual(['TX']);
    expect(radio.state.keyed).toBe(true);
    k.release();
  });

  it('a radio that ignores TX (FSK D) fails PTT on within 300 ms, and RX goes out at once and is confirmed', async () => {
    const { timers, sim, port, radio } = await started();
    sim.press_mode('"data"');
    sim.press_sub('"fsk_d"');
    const t0 = timers.t;
    const k = radio.key(15_000);
    await timers.advance(PTT_TIMEOUT_MS + 20);
    expect(await k.result).toBe('ng');
    expect(k.held).toBe(false);
    expect(port.ptt).toEqual(['TX', 'RX']);
    // TQ read again until the time ran out, then RX.
    const rx = port.sent('RX;')[0];
    expect(rx.at - t0).toBeLessThanOrEqual(PTT_TIMEOUT_MS);
    expect(await radio.unkeyed()).toBe(true);
    expect(radio.holdsPtt).toBe(false);
  });

  it('PTT on answered ?; fails at once, drains, and RX goes out and is confirmed', async () => {
    const { timers, port, radio } = await started();
    port.busyTx = true;
    const k = radio.key(15_000);
    await timers.advance(30);
    expect(await k.result).toBe('ng');
    expect(port.ptt).toEqual(['TX', 'RX']);
    await timers.advance(DRAIN_MS + UNKEY_TRIES * UNKEY_ACK_MS + REPLY_MS);
    expect(await radio.unkeyed()).toBe(true);
  });

  it('PTT on unanswered: timeout, RX at once, confirmed after the drain', async () => {
    const { timers, sim, port, radio } = await started();
    port.dropPtt = 1;
    const k = radio.key(15_000);
    await timers.advance(PTT_TIMEOUT_MS);
    expect(await k.result).toBe('timeout');
    // The radio did key: the late TQ1 is dropped, RX goes 4 times and a read after the drain confirms receive.
    expect(port.ptt[0]).toBe('TX');
    await timers.advance(DRAIN_MS + UNKEY_TRIES * UNKEY_ACK_MS + REPLY_MS);
    expect(port.ptt.filter((p) => p === 'RX').length).toBeGreaterThanOrEqual(1);
    expect(sim.transmit).toBe(false);
    expect(await radio.unkeyed()).toBe(true);
  });

  it('PTT off: RX read back by TQ0, then a TQ read that confirms receive', async () => {
    const { timers, port, radio } = await started();
    const k = radio.key(15_000);
    await timers.advance(100);
    const n = port.written.length;
    k.release();
    await timers.advance(100);
    expect(port.written.slice(n).map((w) => w.text)).toEqual(['RX;TQ;', 'TQ;']);
    expect(await radio.unkeyed()).toBe(true);
    expect(radio.state.unkeyFailed).toBe(false);
  });

  it('RX sent again 100 ms apart, 4 times, while the radio stays in transmit; unconfirmed, then RX every 1 s until TQ0', async () => {
    const { timers, sim, port, radio } = await started();
    const k = radio.key(15_000);
    await timers.advance(100);
    port.ignoreRx = true;
    const unkeyed = radio.unkeyed();
    k.release();
    await timers.advance(UNKEY_TRIES * UNKEY_ACK_MS + REPLY_MS);
    const rx = port.sent('RX;');
    expect(rx).toHaveLength(UNKEY_TRIES);
    // An answer that still says transmit waits out the 100 ms before the next RX.
    for (let i = 1; i < rx.length; i++) expect(rx[i].at - rx[i - 1].at).toBeGreaterThanOrEqual(UNKEY_ACK_MS);
    expect(await unkeyed).toBe(false);
    expect(radio.state.unkeyFailed).toBe(true);
    expect(radio.holdsPtt).toBe(true);
    // Dial sets are refused meanwhile.
    expect(await radio.tune(7_074_000)).toEqual({ ok: false, why: 'busy' });
    await timers.advance(2 * POLL_MS);
    expect(port.ptt.filter((p) => p === 'RX').length).toBeGreaterThan(UNKEY_TRIES);
    port.ignoreRx = false;
    await timers.advance(3 * POLL_MS);
    expect(sim.transmit).toBe(false);
    expect(radio.state.unkeyFailed).toBe(false);
    expect(radio.holdsPtt).toBe(false);
    expect(sim.sets_while_transmitting).toBe(0);
  });

  it('never takes the answer after a ?; for the answer to a later request', async () => {
    const { timers, port, radio } = await started();
    // The radio answers ?; and then FA with a dial that is not its own: a late answer.
    port.replace.set('FA;', '?;FA00007000000;');
    const a = radio.request({ type: 'read_frequency' });
    const b = radio.request({ type: 'read_frequency' });
    await timers.advance(30);
    expect(await a).toMatchObject({ ok: false, why: 'ng', event: { type: 'busy' } });
    port.replace.clear();
    await timers.advance(DRAIN_MS + 100);
    // The second read went out after the drain and got the radio's own dial.
    expect(await b).toEqual({ ok: true, event: { type: 'frequency', hz: 14_074_000, transceive: false } });
    expect(radio.state.hz).toBe(14_074_000);
  });

  it('sends TX and RX ahead of the requests waiting in the queue', async () => {
    const { timers, port, radio } = await started();
    port.delayMs = 40;
    const reads = [radio.request({ type: 'read_frequency' }), radio.request({ type: 'read_mode' }), radio.request({ type: 'read_vox' })];
    await timers.advance(5);
    const n = port.written.length;
    const k = radio.key(15_000);
    await timers.advance(1);
    expect(port.written.slice(n - 1).map((w) => w.text)).toEqual(['FA;', 'TX;TQ;']);
    await timers.advance(200);
    expect(await k.result).toBe('ok');
    for (const r of reads) expect(await r).toMatchObject({ ok: true });
  });

  it('refuses dial and mode sets while keyed and while the radio says transmit, at the wire too', async () => {
    const { timers, sim, port, radio } = await started();
    const k = radio.key(15_000);
    await timers.advance(100);
    expect(await radio.request({ type: 'set_frequency', hz: 7_074_000 })).toEqual({ ok: false, why: 'busy' });
    expect(await radio.request({ type: 'set_mode', mode: 'data' })).toEqual({ ok: false, why: 'busy' });
    expect(await radio.request({ type: 'set_data_sub_mode', sub: 'data_a' })).toEqual({ ok: false, why: 'busy' });
    k.release();
    await timers.advance(200);
    // The operator keys the radio by its own XMIT switch: the band sheet's dial waits.
    sim.press_xmit(true);
    const tuned = radio.tune(7_074_000);
    await timers.advance(100);
    expect(await tuned).toEqual({ ok: false, why: 'busy' });
    sim.press_xmit(false);
    expect(port.sent('FA0')).toHaveLength(0);
    expect(sim.sets_while_transmitting).toBe(0);
  });

  it('tunes to a dial in DATA A: FA, then MD6, then DT0, each read back, waiting out a band change', async () => {
    const { timers, sim, port, radio } = await started();
    port.bandChangeMs = 500;
    const done = radio.tune(7_074_000);
    await timers.advance(KX2_BAND_CHANGE_MS + 200);
    expect(await done).toMatchObject({ ok: true });
    expect(port.written.filter((w) => /^(FA0|MD\d|DT\d)/.test(w.text)).map((w) => w.text)).toEqual(['FA00007074000;FA;', 'MD6;MD;', 'DT0;DT;']);
    expect([sim.frequency, sim.mode, sim.sub]).toEqual([7_074_000, '"data"', '"data_a"']);
    await timers.advance(200);
    expect(radio.state).toMatchObject({ hz: 7_074_000, mode: 'data', sub: 'data_a' });
  });

  it('reports a dial the radio does not take as refused, and stops there', async () => {
    const { timers, port, radio } = await started();
    // Outside the receive range the simulated radio keeps its dial; its read-back says so.
    const done = radio.tune(50_313_000);
    await timers.advance(300);
    expect(await done).toMatchObject({ ok: false, why: 'ng', event: { type: 'frequency', hz: 14_074_000 } });
    expect(port.sent('MD6')).toEqual([]);
  });

  it('says when the port sends only bytes that are not answers: another baud rate', async () => {
    const { timers, port, radio } = setup();
    port.silent = true;
    radio.start();
    port.send(Uint8Array.from([0x80, 0xf3, 0x00, 0x99, 0xfe]));
    await timers.advance(100);
    expect(radio.state.noiseOnly).toBe(true);
  });

  it('ends with lost when the port goes while keyed; the next connection sends RX only when the radio still transmits', async () => {
    const { timers, sim, port, radio } = await started();
    const k = radio.key(15_000);
    await timers.advance(100);
    port.end('lost');
    expect(radio.state.status).toBe('lost');
    expect(radio.endedKeyed).toBe(true);
    expect(k.held).toBe(false);
    // The radio kept transmitting: the next connection reads TQ1 and sends RX.
    const port2 = new Kx2Port(sim, timers);
    const radio2 = new CatRadio({ codec: kx2Codec(wasm), traits: KX2, transport: port2, timers });
    radio2.start({ recover: true });
    await timers.advance(600);
    expect(port2.written[0].text).toBe('TQ;');
    expect(port2.ptt).toEqual(['RX']);
    expect(sim.transmit).toBe(false);
    // In receive, a recovery sends nothing.
    const port3 = new Kx2Port(sim, timers);
    const radio3 = new CatRadio({ codec: kx2Codec(wasm), traits: KX2, transport: port3, timers });
    radio3.start({ recover: true });
    await timers.advance(600);
    expect(port3.ptt).toEqual([]);
  });

  it('releases PTT by itself after maxMs', async () => {
    const { timers, sim, port, radio } = await started();
    const k = radio.key(2000);
    await timers.advance(2100);
    expect(k.held).toBe(false);
    expect(port.ptt).toEqual(['TX', 'RX']);
    expect(sim.transmit).toBe(false);
  });

  it('while keyed, a radio that says receive is a fault with RX', async () => {
    const { timers, sim, port, radio } = await started();
    const faults: string[] = [];
    radio.onFault((f) => faults.push(f));
    radio.key(15_000);
    await timers.advance(200);
    // The radio drops out of transmit by itself (Owner's Manual p. 56).
    sim.press_xmit(false);
    await timers.advance(POLL_MS + 100);
    expect(faults).toEqual(['receive']);
    expect(port.ptt).toEqual(['TX', 'RX']);
  });
});
