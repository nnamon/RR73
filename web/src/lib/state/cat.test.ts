// @vitest-environment jsdom
// Rig control in the app (lib/state/cat.svelte.ts) against a fake Web Serial whose port answers as
// the simulated IC-705 of the rr73-cat crate (CatSimForTests). The port raises DTR and RTS when it
// opens, as Chromium on Windows does, and the simulator keys on them when USB SEND names one.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import type { CatWasm } from '../cat/protocol';
import type { SerialApiLike, SerialOptionsLike, SerialPortLike, SerialSignalsLike } from '../cat/serial';
import { TxScheduler, type TxAudio, type TxReport } from '../tx/scheduler';
import { connectRadio, disconnectRadio, initCat, resetCat, setCatDeps, setRadioDial, testKeying, OPEN_SETTLE_MS, TEST_KEY_MS } from './cat.svelte';
import { onRadioNotice, rig, rigGate, txKeyer } from './radio.svelte';
import { CAT_DEFAULTS, settings, updateSettings } from './settings.svelte';
import { halt, onHalt } from './station.svelte';

interface Sim {
  receive(bytes: Uint8Array): Uint8Array;
  turn_dial(hz: number): Uint8Array;
  set_setting(item: string, value: number): void;
  set_lines(dtr: boolean, rts: boolean): void;
  readonly transmit: boolean;
  readonly frequency: number;
  readonly mode: string;
  readonly data: boolean;
}

type TestWasm = Wasm & CatWasm & { CatSimForTests: new () => Sim };
let wasm: TestWasm;

beforeAll(async () => {
  const w = await loadWasm();
  expect(w, 'the wasm package in src/wasm/pkg').not.toBeNull();
  wasm = w as TestWasm;
});

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** A Web Serial port with the simulated IC-705 behind it, answering each write 10 ms later. */
class SimSerialPort extends EventTarget implements SerialPortLike {
  readonly sim = new wasm.CatSimForTests();
  /** In order: open, the lines set, each frame written (with the radio transmitting or not), close. */
  log: string[] = [];
  forgotten = false;
  silent = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readableValue: ReadableStream<Uint8Array> | null = null;
  private writableValue: WritableStream<Uint8Array> | null = null;
  constructor(private readonly info = { usbVendorId: 0x0c26, usbProductId: 0x0036 }) {
    super();
  }
  get readable() {
    return this.readableValue;
  }
  get writable() {
    return this.writableValue;
  }
  async open(_o: SerialOptionsLike) {
    this.log.push('open');
    // Chromium on Windows asserts DTR and RTS before open() resolves.
    this.sim.set_lines(true, true);
    this.readableValue = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
    this.writableValue = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.log.push(hex(chunk));
        if (this.silent) return;
        const reply = this.sim.receive(chunk);
        setTimeout(() => this.send(reply), 10);
      },
    });
  }
  async setSignals(s: SerialSignalsLike) {
    this.log.push(`lines ${s.dataTerminalReady ? 'DTR' : 'dtr'} ${s.requestToSend ? 'RTS' : 'rts'}`);
    this.sim.set_lines(!!s.dataTerminalReady, !!s.requestToSend);
  }
  async close() {
    this.log.push('close');
    this.readableValue = null;
    this.writableValue = null;
  }
  async forget() {
    this.forgotten = true;
  }
  getInfo() {
    return this.info;
  }
  send(bytes: Uint8Array) {
    if (bytes.length) this.controller?.enqueue(bytes);
  }
  /** The cable comes out. */
  unplug() {
    const c = this.controller;
    this.readableValue = null;
    c?.error(new DOMException('The device has been lost.', 'NetworkError'));
    this.dispatchEvent(new Event('disconnect'));
  }
  /** Frames written that start with these bytes after FE FE A4 E0. */
  frames(prefix: string) {
    return this.log.filter((l) => l.startsWith(`FE FE A4 E0 ${prefix}`));
  }
  get ptt() {
    return this.log.filter((l) => /^FE FE A4 E0 1C 00 0[01] FD$/.test(l)).map((l) => l.slice(18, 20));
  }
}

let chosen: SimSerialPort;
let granted: SimSerialPort[];
let api: SerialApiLike;

beforeEach(async () => {
  // IndexedDB (fake-indexeddb) runs on setImmediate, which stays real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  resetCat();
  chosen = new SimSerialPort();
  granted = [];
  api = {
    requestPort: async () => {
      if (!granted.includes(chosen)) granted.push(chosen);
      return chosen;
    },
    getPorts: async () => granted.filter((p) => !p.forgotten),
  };
  // CatRadio's clock on the faked Date: performance.now() keeps real time under fake timers.
  setCatDeps({ api: () => api, wasm: async () => wasm, timers: { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  await updateSettings({ band: '20m', mode: 'FT8', cat: { ...CAT_DEFAULTS } });
});

afterEach(() => {
  resetCat();
  vi.useRealTimers();
});

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function connect() {
  await initCat();
  const done = connectRadio();
  await run(OPEN_SETTLE_MS + 300);
  await done;
}

describe('connecting', () => {
  it('lowers DTR and RTS before anything is written, waits, reads the radio and sends no PTT', async () => {
    await connect();
    expect(chosen.log.slice(0, 3)).toEqual(['open', 'lines dtr rts', 'FE FE A4 E0 1C 00 FD']);
    expect(rig.status).toBe('connected');
    expect(rig.hz).toBe(14_074_000);
    expect(rig.menu).toEqual({ usb_send: 0, data_mod: 1, time_out_timer: 2 });
    expect(chosen.ptt).toEqual([]);
    expect(settings.cat).toMatchObject({ connect: true, usbVendorId: 0x0c26, usbProductId: 0x0036, keyPtt: false });
  });

  it('drops what the radio sent before the wait ended', async () => {
    await initCat();
    const done = connectRadio();
    await vi.advanceTimersByTimeAsync(0);
    // A transceive frame in the first 100 ms: nobody listens yet.
    chosen.send(chosen.sim.turn_dial(7_074_000));
    await run(OPEN_SETTLE_MS + 300);
    await done;
    // The dial read afterwards shows 7.074 MHz from the radio itself.
    expect(rig.hz).toBe(7_074_000);
    expect(rig.status).toBe('connected');
  });

  it('takes back the browser’s permission for every other port when one is chosen', async () => {
    const portB = new SimSerialPort();
    granted.push(portB);
    await connect();
    expect(portB.forgotten).toBe(true);
    expect(portB.log).toEqual([]);
  });

  it('opens the chosen port again on opening the app, and never tries ports to see', async () => {
    await connect();
    resetCat();
    chosen.log = [];
    const opening = initCat();
    await run(OPEN_SETTLE_MS + 300);
    await opening;
    expect(rig.status).toBe('connected');
    expect(chosen.log[0]).toBe('open');
    // Two allowed ports of the same kind: neither opens.
    resetCat();
    const other = new SimSerialPort();
    granted.push(other);
    await initCat();
    await run(500);
    expect(rig.status).toBe('failed');
    expect(rig.error).toBe('choose');
    expect(other.log).toEqual([]);
    // None: says so.
    resetCat();
    granted = [];
    await initCat();
    expect(rig.error).toBe('gone');
  });

  it('with USB SEND on a line, keeps the lines low, refuses Tx and Test keying, and says what to set', async () => {
    chosen.sim.set_setting('"usb_send"', 1);
    await initCat();
    const done = connectRadio();
    await vi.advanceTimersByTimeAsync(0);
    // The moment Chromium leaves between open() and setSignals: the radio keyed on DTR.
    await run(OPEN_SETTLE_MS + 300);
    await done;
    expect(chosen.log.slice(0, 2)).toEqual(['open', 'lines dtr rts']);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.menu.usb_send).toBe(1);
    expect(rigGate()).toBe('Set USB SEND to OFF');
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    expect(rigGate()).toBe('Set USB SEND to OFF');
    await testKeying();
    expect(rig.test).toMatchObject({ state: 'done', ok: false });
    expect(chosen.ptt).toEqual([]);
  });

  it('closes the port when the lines cannot be lowered', async () => {
    chosen.setSignals = async () => Promise.reject(new DOMException('Failed to set control signals.', 'NetworkError'));
    await connect();
    expect(rig.status).toBe('failed');
    expect(rig.error).toBe('signals');
    expect(chosen.log).toEqual(['open', 'close']);
  });

  it('disconnects: forgets the port, and transmissions key by VOX again', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    expect(txKeyer()).not.toBeNull();
    await disconnectRadio();
    expect(chosen.forgotten).toBe(true);
    expect(settings.cat.connect).toBe(false);
    expect(rig.status).toBe('off');
    expect(txKeyer()).toBeNull();
    expect(rigGate()).toBeNull();
  });
});

describe('the dial', () => {
  it('follows the radio onto another band', async () => {
    await connect();
    chosen.send(chosen.sim.turn_dial(7_074_000));
    await run(20);
    expect(rig.hz).toBe(7_074_000);
    expect(settings.band).toBe('40m');
    expect(rigGate()).toBeNull();
  });

  it('sets the dial and USB-D, and waits while the radio transmits', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const k = txKeyer()!.key(15_000);
    await run(50);
    const set = setRadioDial(7_074_000);
    await run(100);
    expect(rig.tuning).toEqual({ hz: 7_074_000, state: 'waiting' });
    expect(chosen.frames('05')).toEqual([]);
    k.release();
    await run(1000);
    await set;
    expect(rig.tuning).toEqual({ hz: 7_074_000, state: 'set' });
    expect([chosen.sim.frequency, chosen.sim.mode, chosen.sim.data]).toEqual([7_074_000, '"usb"', true]);
    expect(chosen.frames('05')).toEqual(['FE FE A4 E0 05 00 40 07 07 00 FD']);
  });
});

describe('keying', () => {
  /** A fake audio clock for the scheduler: context time 0 is UTC `base`. */
  function fakeAudio(base: number, lengthMs: number) {
    const played: { when: number; stopped: boolean }[] = [];
    const audio: TxAudio = {
      sampleRate: 12000,
      get currentTime() {
        return (Date.now() - base) / 1000;
      },
      toContextTime: (utc) => (utc - base) / 1000,
      toUtcMs: (t) => t * 1000 + base,
      play(_s, when) {
        const p = { when, stopped: false };
        played.push(p);
        const handle = {
          onended: null as (() => void) | null,
          stop: () => void (p.stopped = true),
        };
        setTimeout(() => !p.stopped && handle.onended?.(), (when - audio.currentTime) * 1000 + lengthMs);
        return handle;
      },
    };
    return { audio, played };
  }

  /** A transmission scheduled 2.5 s from now, `lengthMs` long. */
  async function transmit(lengthMs = 2000) {
    const base = Date.now();
    const { audio, played } = fakeAudio(base, lengthMs);
    const reports: TxReport[] = [];
    const sched = new TxScheduler({ audio: () => audio, encoder: { synthesize: async () => new Float32Array(24000) }, gate: () => rigGate(), report: (r) => reports.push(r), keyer: txKeyer });
    const done = sched.schedule({ text: 'CQ 9V1NE OJ11', mode: 'FT8', slotStartMs: base + 2000, startOffsetS: 0.5, f0Hz: 1500, level: 0.5 });
    return { done, reports, played, sched };
  }

  it('with Key the radio with CAT off, a transmission sends no PTT', async () => {
    await connect();
    const n = chosen.log.length;
    const { done, played } = await transmit();
    await run(6000);
    await done;
    expect(played).toHaveLength(1);
    expect(chosen.ptt).toEqual([]);
    expect(chosen.log.slice(n).some((l) => l.startsWith('FE FE A4 E0 1C 00 0'))).toBe(false);
  });

  it('with it on, keys before the audio, waits for the OK, and releases after the end', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const { done, played, reports } = await transmit();
    await run(2200);
    await done;
    expect(chosen.ptt).toEqual(['01']);
    expect(chosen.sim.transmit).toBe(true);
    expect(played).toHaveLength(1);
    await run(4000);
    expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    expect(chosen.ptt).toEqual(['01', '00']);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('Halt sends PTT off at once while keying by CAT is on, and not while it is off', async () => {
    await connect();
    halt();
    await run(100);
    expect(chosen.ptt).toEqual([]);
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    const { done } = await transmit();
    await run(2200);
    await done;
    expect(chosen.sim.transmit).toBe(true);
    halt();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen.ptt.at(-1)).toBe('00');
    await run(100);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('a lost port turns Tx off, says so, and the next connection sends PTT off if the radio still transmits', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: [string, boolean][] = [];
    const halts: number[] = [];
    const off1 = onRadioNotice((t, txOff) => notices.push([t, txOff]));
    const off2 = onHalt(() => halts.push(1));
    const { done } = await transmit();
    await run(2200);
    await done;
    expect(chosen.sim.transmit).toBe(true);
    chosen.unplug();
    await run(10);
    expect(rig.status).toBe('lost');
    expect(notices).toEqual([['Radio disconnected · Tx off', true]]);
    expect(halts.length).toBeGreaterThan(0);
    expect(txKeyer()).toBeNull();
    expect(rigGate()).toBe('Radio not connected');
    off1();
    off2();
    // The cable goes back in: Connect radio reads the radio and sends PTT off, as it still transmits.
    chosen.log = [];
    const again = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await again;
    expect(chosen.ptt).toEqual(['00']);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('Test keying keys for 1 s with no audio and releases, with the switch off', async () => {
    await connect();
    expect(settings.cat.keyPtt).toBe(false);
    const t = testKeying();
    await run(50);
    expect(rig.test).toEqual({ state: 'running' });
    expect(chosen.sim.transmit).toBe(true);
    await run(TEST_KEY_MS + 200);
    await t;
    expect(chosen.ptt).toEqual(['01', '00']);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.test).toMatchObject({ state: 'done', ok: true });
    expect(rig.test?.state === 'done' && rig.test.text).toMatch(/^Keyed for 1 s and released at \d\d:\d\d:\d\d UTC\.$/);
  });

  it('Halt stops Test keying with PTT off at once', async () => {
    await connect();
    const t = testKeying();
    await run(300);
    expect(chosen.sim.transmit).toBe(true);
    halt();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen.ptt.at(-1)).toBe('00');
    await run(100);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'Stopped by Halt. PTT off was sent.' });
    await run(2000);
    await t;
    expect(chosen.ptt).toEqual(['01', '00']);
  });

  it('page hide stops Test keying through Halt', async () => {
    await connect();
    void testKeying();
    await run(300);
    expect(chosen.sim.transmit).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    await run(100);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('a lost port stops Test keying and says so', async () => {
    await connect();
    const t = testKeying();
    await run(300);
    chosen.unplug();
    await run(10);
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'The port closed during the test.' });
    await run(2000);
    await t;
  });

  it('Test keying says when the radio does not answer PTT, and sends PTT off', async () => {
    await connect();
    chosen.silent = true;
    const t = testKeying();
    await run(2000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'No reply to PTT from the IC-705 within 0.3 s. PTT off was sent.' });
    expect(chosen.ptt[0]).toBe('01');
    expect(chosen.ptt.slice(1).every((p) => p === '00')).toBe(true);
    expect(chosen.ptt.length).toBeGreaterThan(1);
  });

  it('page hide and the page going away send PTT off during a transmission', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    for (const fire of [() => window.dispatchEvent(new Event('pagehide')), () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }]) {
      const { done, played } = await transmit();
      await run(2200);
      await done;
      expect(chosen.sim.transmit).toBe(true);
      const n = chosen.ptt.length;
      fire();
      await vi.advanceTimersByTimeAsync(0);
      expect(chosen.ptt.slice(n)[0]).toBe('00');
      await run(100);
      expect(chosen.sim.transmit).toBe(false);
      expect(played).toHaveLength(1);
      await run(3000);
    }
  });

  it('a radio that stops answering during a transmission stops it, sends PTT off and says so', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: [string, boolean][] = [];
    const off = onRadioNotice((t, txOff) => notices.push([t, txOff]));
    const { done, played, sched } = await transmit(12_000);
    const offHalt = onHalt(() => sched.halt());
    await run(2200);
    await done;
    expect(played).toHaveLength(1);
    chosen.silent = true;
    await run(3 * 1500 + 500);
    expect(notices).toEqual([['No reply from radio · Tx off', true]]);
    expect(played[0].stopped).toBe(true);
    expect(chosen.ptt.slice(0, 2)).toEqual(['01', '00']);
    off();
    offHalt();
  });
});
