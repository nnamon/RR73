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
import { dialNow, onRadioNotice, rig, rigGate, tuneGate, txKeyer, txShiftHz } from './radio.svelte';
import { configNow } from './qso.svelte';
import { practice } from './practice.svelte';
import { CAT_DEFAULTS, settings, updateSettings } from './settings.svelte';
import { audio as engineAudio, halt, onHalt } from './station.svelte';

interface Sim {
  receive(bytes: Uint8Array): Uint8Array;
  turn_dial(hz: number): Uint8Array;
  set_setting(item: string, value: number): void;
  set_lines(dtr: boolean, rts: boolean): void;
  readonly transmit: boolean;
  readonly frequency: number;
  readonly mode: string;
  readonly data: boolean;
  /** Frequency, mode and data mode sets that arrived while the radio transmitted. */
  readonly sets_while_transmitting: number;
  press_mode(mode: string, filter: number): Uint8Array;
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
  /** The radio's answer to the next PTT on goes missing; it still keys. */
  dropPttOn = false;
  /** PTT off goes unanswered and the radio keeps transmitting. */
  ignorePttOff = false;
  /** PTT on is answered OK, and the radio stays in receive (PTT Lock). */
  lockPtt = false;
  /** How the radio answers the next frequency sets, in turn: `ng` refuses and keeps the dial. */
  dialAnswers: ('ok' | 'ng')[] = [];
  /** Each frame written, with Date.now() then. */
  writes: { frame: string; at: number }[] = [];
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
        const frame = hex(chunk);
        this.log.push(frame);
        this.writes.push({ frame, at: Date.now() });
        if (this.silent) return;
        if (frame.startsWith('FE FE A4 E0 05') && this.dialAnswers.shift() === 'ng') {
          setTimeout(() => this.send(Uint8Array.from([0xfe, 0xfe, 0xe0, 0xa4, 0xfa, 0xfd])), 10);
          return;
        }
        if (frame === 'FE FE A4 E0 1C 00 00 FD' && this.ignorePttOff) return;
        if (frame === 'FE FE A4 E0 1C 00 01 FD' && this.lockPtt) {
          setTimeout(() => this.send(Uint8Array.from([0xfe, 0xfe, 0xe0, 0xa4, 0xfb, 0xfd])), 10);
          return;
        }
        const reply = this.sim.receive(chunk);
        if (frame === 'FE FE A4 E0 1C 00 01 FD' && this.dropPttOn) {
          this.dropPttOn = false;
          return;
        }
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
    // Answers still on their way after this are lost, as on a closed port.
    this.controller = null;
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
  practice.on = false;
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

  it('shows a radio already transmitting at connecting, and sends PTT off then only with CAT keying on or RR73 may have left it keyed', async () => {
    const key = wasm.cat_encode('{"type":"set_transmit","on":true}', 0xa4);
    chosen.sim.receive(key);
    await connect();
    expect(rig.transmitting).toBe(true);
    expect(chosen.ptt).toEqual([]);
    expect(chosen.sim.transmit).toBe(true);
    await disconnectRadio();
    // Key the radio with CAT on: PTT off at connecting, confirmed.
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    chosen.log = [];
    const done = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await done;
    expect(chosen.ptt).toEqual(['00']);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.unkeyFailed).toBe(false);
    // CAT keying off, but the stored flag says RR73 may have left it keyed: PTT off too.
    await disconnectRadio();
    chosen.sim.receive(key);
    void updateSettings({ cat: { ...settings.cat, keyPtt: false, leftKeyed: true } });
    chosen.log = [];
    const again = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await again;
    expect(chosen.ptt).toEqual(['00']);
    expect(chosen.sim.transmit).toBe(false);
    expect(settings.cat.leftKeyed).toBe(false);
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

  it('follows a dial turned on the radio within 1 s by polling, with no transceive frame', async () => {
    await connect();
    // The radio's dial moves; its transceive frame never arrives (CI-V Transceive off).
    chosen.sim.turn_dial(7_074_000);
    await run(1000 + 50);
    expect(rig.hz).toBe(7_074_000);
    expect(settings.band).toBe('40m');
  });

  it('keeps FT8 when the radio moves to the FT8 dial on 2m or 70cm', async () => {
    await connect();
    chosen.send(chosen.sim.turn_dial(144_174_000));
    await run(20);
    expect(settings.band).toBe('2m');
    expect(settings.mode).toBe('FT8');
    chosen.send(chosen.sim.turn_dial(432_174_000));
    await run(20);
    expect(settings.band).toBe('70cm');
    expect(settings.mode).toBe('FT8');
  });

  it('is the dial QSOs log while the radio is on RR73’s band, and the band’s dial without a radio', async () => {
    chosen.sim.receive(wasm.cat_encode('{"type":"set_frequency","hz":14076000}', 0xa4));
    expect(configNow().dialHz).toBe(14_074_000);
    await connect();
    expect(rig.hz).toBe(14_076_000);
    expect(configNow().dialHz).toBe(14_076_000);
    expect(dialNow(14_074_000)).toBe(14_076_000);
    await disconnectRadio();
    expect(configNow().dialHz).toBe(14_074_000);
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

describe('keying', () => {
  /** A transmission whose slot starts 2 s from now, `lengthMs` long: FT8 at slot + 0.5 s, WSPR at slot + 1 s. */
  async function transmit(lengthMs = 2000, mode: 'FT8' | 'WSPR' = 'FT8') {
    const base = Date.now();
    const { audio, played } = fakeAudio(base, lengthMs);
    const reports: TxReport[] = [];
    const sched = new TxScheduler({ audio: () => audio, encoder: { synthesize: async () => new Float32Array(24000) }, gate: () => rigGate(), report: (r) => reports.push(r), keyer: txKeyer });
    const text = mode === 'WSPR' ? '9V1NE OJ11 37' : 'CQ 9V1NE OJ11';
    const done = sched.schedule({ text, mode, slotStartMs: base + 2000, startOffsetS: mode === 'WSPR' ? 1 : 0.5, f0Hz: 1500, level: 0.5 });
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

  it('keys a WSPR transmission with the switch on, and sends no PTT with it off', async () => {
    await connect();
    const off = await transmit(2000, 'WSPR');
    await run(6000);
    await off.done;
    expect(off.played).toHaveLength(1);
    expect(chosen.ptt).toEqual([]);
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    const on = await transmit(2000, 'WSPR');
    // PTT on 0.5 s before the audio at slot + 1 s.
    await run(2400);
    expect(chosen.ptt).toEqual([]);
    await run(200);
    await on.done;
    expect(chosen.ptt).toEqual(['01']);
    expect(on.played).toHaveLength(1);
    await run(4000);
    expect(on.reports.map((r) => r.type)).toEqual(['started', 'ended']);
    expect(chosen.ptt).toEqual(['01', '00']);
    expect(chosen.sim.transmit).toBe(false);
  });

  describe('the Tx output', () => {
    beforeEach(() => {
      // A browser that can choose the output, as Chromium can.
      vi.stubGlobal('AudioContext', class {
        setSinkId() {
          return Promise.resolve();
        }
      });
    });
    afterEach(async () => {
      vi.unstubAllGlobals();
      engineAudio.output = { sinkId: null, error: null };
      await updateSettings({ outputDeviceId: null });
    });

    it('keying by CAT, refuses a transmission and Tune whose audio would not reach the chosen output, with no PTT', async () => {
      void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
      await connect();
      // System default: the radio would key with its Tx audio on whatever the computer plays to.
      expect(rigGate()).toBe('No Tx output chosen');
      expect(tuneGate()).toBe('No Tx output chosen');
      const { done, played, reports } = await transmit();
      await run(3000);
      await done;
      expect(played).toEqual([]);
      expect(reports).toMatchObject([{ type: 'refused', reason: 'No Tx output chosen' }]);
      expect(chosen.ptt).toEqual([]);
      await updateSettings({ outputDeviceId: 'radio-out' });
      engineAudio.output = { sinkId: 'radio-out', error: 'missing' };
      expect(rigGate()).toBe('Tx output not connected');
      engineAudio.output = { sinkId: 'radio-out', error: 'failed' };
      expect(rigGate()).toBe('Browser refused the Tx output');
      expect(tuneGate()).toBe('Browser refused the Tx output');
      engineAudio.output = { sinkId: 'radio-out', error: 'unsupported' };
      expect(rigGate()).toBe('Browser refused the Tx output');
      engineAudio.output = { sinkId: 'speakers', error: null };
      expect(rigGate()).toBe('Tx output switching');
      // On the chosen output: keyed as before.
      engineAudio.output = { sinkId: 'radio-out', error: null };
      expect(rigGate()).toBeNull();
      const ok = await transmit();
      await run(2200);
      await ok.done;
      expect(ok.played).toHaveLength(1);
      expect(chosen.ptt).toEqual(['01']);
      await run(4000);
      expect(chosen.ptt).toEqual(['01', '00']);
    });

    it('a refusal after PTT on, before the audio, releases PTT and plays nothing', async () => {
      void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
      await updateSettings({ outputDeviceId: 'radio-out' });
      engineAudio.output = { sinkId: 'radio-out', error: null };
      await connect();
      const { done, played, reports } = await transmit();
      // PTT on at the pre-roll, 2 s in; the browser refuses the output before the radio's OK, 10 ms
      // later, and the audio that would follow it.
      await run(2003);
      expect(chosen.ptt).toEqual(['01']);
      engineAudio.output = { sinkId: 'radio-out', error: 'failed' };
      await run(300);
      await done;
      expect(played).toEqual([]);
      expect(reports).toMatchObject([{ type: 'refused', reason: 'Browser refused the Tx output' }]);
      await run(200);
      expect(chosen.ptt).toEqual(['01', '00']);
      expect(chosen.sim.transmit).toBe(false);
    });

    it('with VOX keying or the practice band, no output is required', async () => {
      await connect();
      expect(rigGate()).toBeNull();
      expect(tuneGate()).toBeNull();
      void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
      practice.on = true;
      expect(rigGate()).toBeNull();
      expect(tuneGate()).toBeNull();
    });
  });

  it('PTT off unconfirmed after a transmission: Tx goes off, the status line says to unkey the radio, and Tx is refused', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: [string, boolean, boolean][] = [];
    const off = onRadioNotice((t, txOff, always) => notices.push([t, txOff, always]));
    const { done } = await transmit();
    await run(2200);
    await done;
    chosen.ignorePttOff = true;
    // The audio ends 4.5 s in; PTT off from 4.6 s, 4 times, the drain, and the read.
    await run(3500);
    expect(chosen.sim.transmit).toBe(true);
    expect(rig.unkeyFailed).toBe(true);
    expect(notices).toEqual([['PTT off not confirmed · unkey radio', true, true]]);
    expect(rigGate()).toBe('PTT off not confirmed · unkey radio');
    const next = await transmit();
    await run(3000);
    await next.done;
    expect(next.played).toEqual([]);
    expect(next.reports).toMatchObject([{ type: 'refused', reason: 'PTT off not confirmed · unkey radio' }]);
    off();
  });

  it('Disconnect radio during a transmission stops it, and confirms PTT off before the port closes', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const halts: number[] = [];
    const offHalt = onHalt(() => halts.push(1));
    const { done, played, sched } = await transmit(10_000);
    const offSched = onHalt(() => sched.halt());
    await run(2200);
    await done;
    expect(chosen.sim.transmit).toBe(true);
    const closing = disconnectRadio();
    await run(200);
    await closing;
    expect(halts.length).toBeGreaterThan(0);
    expect(played[0].stopped).toBe(true);
    expect(chosen.sim.transmit).toBe(false);
    const tail = chosen.log.slice(chosen.log.lastIndexOf('FE FE A4 E0 1C 00 00 FD'));
    expect(tail).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', 'close']);
    expect(rig.unkeyFailed).toBe(false);
    offHalt();
    offSched();
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

  it('the practice band never keys the radio by CAT: no PTT for FT8, FT4 or WSPR, and no Test keying, with the switch on', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    practice.on = true;
    const n = chosen.log.length;
    expect(txKeyer()).toBeNull();
    for (const mode of ['FT8', 'WSPR'] as const) {
      const { done, played, reports } = await transmit(2000, mode);
      await run(6000);
      await done;
      expect(played).toHaveLength(1);
      expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    }
    // No dial shift either: it needs CAT keying.
    expect(txShiftHz('FT4', 2800)).toBe(0);
    await testKeying();
    expect(rig.test).toEqual({ state: 'done', ok: false, text: 'Not tested: the practice band is on, and it never keys the radio by CAT. Turn it off in Settings › Practice band first.', atMs: expect.any(Number) });
    await run(TEST_KEY_MS + 500);
    expect(chosen.log.slice(n).filter((l) => l.startsWith('FE FE A4 E0 1C 00 0'))).toEqual([]);
    expect(chosen.sim.transmit).toBe(false);
    // With the radio gone, practice still transmits: it needs no radio.
    chosen.unplug();
    await run(10);
    expect(rigGate()).toBeNull();
    practice.on = false;
    expect(rigGate()).toBe('Radio not connected');
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

  it('Test keying keys for 1 s with no audio and releases, with the switch off and on', async () => {
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
    expect(rig.test?.state === 'done' && rig.test.text).toMatch(/^Keyed and released at \d\d:\d\d:\d\d UTC\.$/);
    // PTT off, then the read that confirmed receive, before the result.
    const off = chosen.log.lastIndexOf('FE FE A4 E0 1C 00 00 FD');
    expect(chosen.log.slice(off + 1)).toContain('FE FE A4 E0 1C 00 FD');
    // The same with the switch on. Halt, which Test keying runs first, sends PTT off then.
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    const on = testKeying();
    await run(TEST_KEY_MS + 200);
    await on;
    expect(chosen.ptt.slice(2).filter((p) => p === '01')).toEqual(['01']);
    expect(chosen.ptt.at(-1)).toBe('00');
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.test).toMatchObject({ state: 'done', ok: true });
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

  it('Test keying says when the radio does not answer PTT on or off, and sends PTT off', async () => {
    await connect();
    chosen.silent = true;
    const t = testKeying();
    await run(2000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'No reply from the IC-705 to PTT on or off.' });
    expect(chosen.ptt[0]).toBe('01');
    expect(chosen.ptt.slice(1).every((p) => p === '00')).toBe(true);
    expect(chosen.ptt.length).toBeGreaterThan(1);
    expect(rig.unkeyFailed).toBe(true);
  });

  it('Test keying with PTT on unanswered sends PTT off at once, confirms it, and plays nothing', async () => {
    await connect();
    chosen.dropPttOn = true;
    const t = testKeying();
    await run(2000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'No reply to PTT from the IC-705 within 0.3 s. PTT off was sent and confirmed.' });
    expect(chosen.ptt[0]).toBe('01');
    expect(chosen.ptt.slice(1).every((p) => p === '00')).toBe(true);
    // The read after PTT off said receive.
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.unkeyFailed).toBe(false);
  });

  it('Test keying reports a radio that keeps transmitting after PTT off, and the status line says to unkey it', async () => {
    await connect();
    const notices: [string, boolean][] = [];
    const off = onRadioNotice((t, txOff, always) => always && notices.push([t, txOff]));
    chosen.ignorePttOff = true;
    const t = testKeying();
    await run(TEST_KEY_MS + 1500);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'Keyed. PTT off was not confirmed.' });
    // Sent 4 times, 100 ms apart, then read: still transmitting. The 1 s poll sends it again.
    expect(chosen.ptt.slice(0, 5)).toEqual(['01', '00', '00', '00', '00']);
    expect(chosen.ptt.slice(1).every((p) => p === '00')).toBe(true);
    expect(rig.unkeyFailed).toBe(true);
    expect(notices).toEqual([['PTT off not confirmed · unkey radio', true]]);
    expect(rigGate()).toBe('PTT off not confirmed · unkey radio');
    await testKeying();
    expect(rig.test).toMatchObject({ ok: false, text: 'Not tested: the last PTT off is not confirmed. Check that the IC-705 receives.' });
    // Each second RR73 reads the radio and sends PTT off again while it transmits; once it takes
    // it, the error clears.
    chosen.ignorePttOff = false;
    await run(1500);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.unkeyFailed).toBe(false);
    expect(rigGate()).toBeNull();
    off();
  });

  it('Test keying says to check PTT Lock when the radio answers OK and stays in receive', async () => {
    await connect();
    chosen.lockPtt = true;
    const t = testKeying();
    await run(TEST_KEY_MS + 1000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'The IC-705 answered OK but stayed in receive. Check that SET › Function › PTT Lock is off.' });
    expect(chosen.ptt).toContain('00');
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
    // The radio answers nothing, PTT off included: the status line says to unkey it.
    expect(notices).toEqual([
      ['No reply from radio · Tx off', true],
      ['PTT off not confirmed · unkey radio', true],
    ]);
    expect(played[0].stopped).toBe(true);
    expect(chosen.ptt.slice(0, 2)).toEqual(['01', '00']);
    off();
    offHalt();
  });
});

describe('Keep Tx audio centred', () => {
  const TX_DIAL = 'FE FE A4 E0 05 00 50 07 14 00 FD';
  const RX_DIAL = 'FE FE A4 E0 05 00 40 07 14 00 FD';

  /**
   * A CQ at audio `f0Hz` whose slot starts 2 s from now, through a scheduler with Operate's keyer and
   * shift, `lengthMs` long, with the frequency it was synthesised at.
   */
  function cq(f0Hz: number, lengthMs = 2000) {
    const base = Date.now();
    const { audio, played } = fakeAudio(base, lengthMs);
    const reports: TxReport[] = [];
    const synthHz: number[] = [];
    const sched = new TxScheduler({
      audio: () => audio,
      encoder: {
        synthesize: async (_text, _mode, f0) => {
          synthHz.push(f0);
          return new Float32Array(24000);
        },
      },
      gate: () => rigGate(),
      report: (r) => reports.push(r),
      keyer: txKeyer,
      shift: txShiftHz,
    });
    const done = sched.schedule({ text: 'CQ 9V1NE OJ11', mode: 'FT8', slotStartMs: base + 2000, startOffsetS: 0.5, f0Hz, level: 0.5 });
    return { base, done, reports, played, synthHz, sched };
  }

  const on = (shiftDial: boolean, keyPtt = true) => void updateSettings({ cat: { ...settings.cat, keyPtt, shiftDial } });
  /** Frames from `from` on, without the reads. */
  const sets = (from: number) => chosen.log.slice(from).filter((l) => /^FE FE A4 E0 (05|1C 00 0[01])/.test(l));

  it('is off by default', () => {
    expect(CAT_DEFAULTS.shiftDial).toBe(false);
    expect(settings.cat.shiftDial).toBe(false);
  });

  it('sets the dial 1000 Hz up before PTT on for a CQ at 2800 Hz, plays it at 1800 Hz, and sets the receive dial back after PTT off', async () => {
    on(true);
    await connect();
    const n = chosen.log.length;
    const { base, done, played, synthHz, reports } = cq(2800);
    await run(2200);
    await done;
    expect(synthHz).toEqual([1800]);
    expect(sets(n)).toEqual([TX_DIAL, 'FE FE A4 E0 1C 00 01 FD']);
    // The dial at the pre-roll, at the slot edge; PTT on after its OK; the audio on time at slot + 0.5 s.
    const dialAt = chosen.writes.find((w) => w.frame === TX_DIAL)!.at - base;
    const pttAt = chosen.writes.find((w) => w.frame === 'FE FE A4 E0 1C 00 01 FD')!.at - base;
    expect(dialAt).toBe(2000);
    // The simulated radio answers 10 ms after each frame.
    expect(pttAt - dialAt).toBe(10);
    expect(played[0].when).toBeCloseTo(2.5, 6);
    // On the air: RF = Tx dial + audio = receive dial + 2800 Hz. RR73 shows, decodes and logs the receive dial.
    expect([chosen.sim.frequency, chosen.sim.transmit]).toEqual([14_075_000, true]);
    expect(chosen.sim.frequency + synthHz[0]).toBe(14_074_000 + 2800);
    expect(rig.hz).toBe(14_074_000);
    expect(configNow().dialHz).toBe(14_074_000);
    await run(4000);
    expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    const after = chosen.log.slice(n);
    const off = after.indexOf('FE FE A4 E0 1C 00 00 FD');
    expect(after.slice(off, off + 3)).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', RX_DIAL]);
    expect([chosen.sim.frequency, chosen.sim.transmit, chosen.sim.sets_while_transmitting]).toEqual([14_074_000, false, 0]);
    expect(rig.hz).toBe(14_074_000);
  });

  it('leaves the dial alone with the switch off, inside the window, and without Key the radio with CAT', async () => {
    await connect();
    for (const [shiftDial, keyPtt, f0, ptt] of [
      [false, true, 2800, true],
      [true, true, 1700, true],
      [true, false, 2800, false],
    ] as const) {
      on(shiftDial, keyPtt);
      const n = chosen.log.length;
      const { done, synthHz, played } = cq(f0);
      await run(2200);
      await done;
      await run(4000);
      const what = JSON.stringify({ shiftDial, keyPtt, f0 });
      expect(synthHz, what).toEqual([f0]);
      expect(played, what).toHaveLength(1);
      expect(sets(n), what).toEqual(ptt ? ['FE FE A4 E0 1C 00 01 FD', 'FE FE A4 E0 1C 00 00 FD'] : []);
      expect(chosen.sim.frequency, what).toBe(14_074_000);
    }
  });

  it('shifts only in USB, where the dial and the audio add up to the RF', async () => {
    on(true);
    await connect();
    expect(txShiftHz('FT8', 2800)).toBe(1000);
    expect(txShiftHz('FT4', 900)).toBe(-1000);
    expect(txShiftHz('WSPR', 1450)).toBe(0);
    expect(txShiftHz('RTTY', 2800)).toBe(0);
    chosen.send(chosen.sim.press_mode('"lsb"', 1));
    await run(20);
    expect(rig.mode).toBe('lsb');
    expect(txShiftHz('FT8', 2800)).toBe(0);
  });

  it('refuses the transmission when the radio refuses the Tx dial, sends no PTT, and sets the receive dial', async () => {
    on(true);
    await connect();
    const n = chosen.log.length;
    chosen.dialAnswers = ['ng'];
    const { done, played, reports } = cq(2800);
    await run(2200);
    await done;
    expect(played).toEqual([]);
    expect(reports).toMatchObject([{ type: 'refused', reason: 'Radio did not set Tx dial' }]);
    expect(chosen.ptt).toEqual([]);
    await run(200);
    expect(sets(n)).toEqual([TX_DIAL, RX_DIAL]);
    expect(chosen.sim.frequency).toBe(14_074_000);
  });

  it('Halt during a shifted transmission sends PTT off at once, then sets the receive dial back', async () => {
    on(true);
    await connect();
    const { done, played, sched } = cq(2800, 10_000);
    const offHalt = onHalt(() => sched.halt());
    await run(3000);
    await done;
    expect([chosen.sim.frequency, chosen.sim.transmit]).toEqual([14_075_000, true]);
    const n = chosen.log.length;
    halt();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen.log[n]).toBe('FE FE A4 E0 1C 00 00 FD');
    expect(played[0].stopped).toBe(true);
    await run(200);
    expect(sets(n).at(-1)).toBe(RX_DIAL);
    expect([chosen.sim.frequency, chosen.sim.transmit, chosen.sim.sets_while_transmitting]).toEqual([14_074_000, false, 0]);
    offHalt();
  });

  it('a lost port during a shifted transmission turns Tx off; the next connection sends PTT off and sets the receive dial back', async () => {
    on(true);
    await connect();
    const { done } = cq(2800, 10_000);
    await run(3000);
    await done;
    chosen.unplug();
    await run(10);
    expect(rig.status).toBe('lost');
    expect(chosen.sim.frequency).toBe(14_075_000);
    chosen.log = [];
    const again = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await again;
    expect(sets(0)).toEqual(['FE FE A4 E0 1C 00 00 FD', RX_DIAL]);
    expect([chosen.sim.frequency, chosen.sim.transmit]).toEqual([14_074_000, false]);
    expect(rig.hz).toBe(14_074_000);
  });

  it('says so and turns Tx off when the radio does not take the receive dial back, and shows the dial it reads', async () => {
    on(true);
    await connect();
    const notices: [string, boolean, boolean][] = [];
    const off = onRadioNotice((t, txOff, always) => notices.push([t, txOff, always]));
    chosen.dialAnswers = ['ok', 'ng'];
    const { done } = cq(2800);
    await run(2200);
    await done;
    await run(4000);
    expect(notices).toEqual([['Rx dial not restored · Tx off', true, true]]);
    expect(chosen.sim.frequency).toBe(14_075_000);
    expect(rig.hz).toBe(14_075_000);
    off();
  });

  it('Disconnect radio during a shifted transmission confirms PTT off and sets the receive dial back before the port closes', async () => {
    on(true);
    await connect();
    const { done, sched } = cq(2800, 10_000);
    const offSched = onHalt(() => sched.halt());
    await run(3000);
    await done;
    const closing = disconnectRadio();
    await run(300);
    await closing;
    const tail = chosen.log.slice(chosen.log.lastIndexOf('FE FE A4 E0 1C 00 00 FD'));
    expect(tail).toEqual(['FE FE A4 E0 1C 00 00 FD', 'FE FE A4 E0 1C 00 FD', RX_DIAL, 'FE FE A4 E0 03 FD', 'close']);
    expect([chosen.sim.frequency, chosen.sim.transmit]).toEqual([14_074_000, false]);
    offSched();
  });
});
