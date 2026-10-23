// @vitest-environment jsdom
// Rig control in the app (lib/state/cat.svelte.ts) with the KX2 chosen, against a fake Web Serial
// whose port answers as the simulated KX2 of the rr73-cat crate (CatKx2SimForTests), behind a
// Digirig. The port raises DTR and RTS when it opens, as Chromium on Windows does; the Digirig's
// PTT follows RTS, and its KX cable takes it to the KX2's MIC jack, which MIC BTN reads as PTT by
// default (Owner's Manual p. 48), so the simulated radio transmits until RR73 lowers the lines.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import type { CatWasm } from '../cat/protocol';
import type { SerialApiLike, SerialOptionsLike, SerialPortLike, SerialSignalsLike } from '../cat/serial';
import { TxScheduler, type TxAudio, type TxReport } from '../tx/scheduler';
import { chooseRadio, connectRadio, disconnectRadio, initCat, resetCat, setCatDeps, setKx2Baud, setRadioDial, testKeying, OPEN_SETTLE_MS, TEST_KEY_MS } from './cat.svelte';
import { STATUS } from '../qso/status';
import { dialNow, onRadioNotice, rig, rigGate, rigInDataMode, rigModeText, txKeyer, txShiftHz } from './radio.svelte';
import { configNow } from './qso.svelte';
import { CAT_DEFAULTS, settings, updateSettings } from './settings.svelte';
import { halt, onHalt } from './station.svelte';

interface Kx2Sim {
  receive(bytes: Uint8Array): Uint8Array;
  turn_dial(hz: number): Uint8Array;
  press_mode(mode: string): Uint8Array;
  press_sub(sub: string): void;
  mic_btn: number;
  set_vox_data(on: boolean): void;
  press_xmit(on: boolean): void;
  set_lines(dtr: boolean, rts: boolean): void;
  readonly transmit: boolean;
  readonly frequency: number;
  readonly mode: string;
  readonly sub: string;
  readonly sets_while_transmitting: number;
}

type TestWasm = Wasm & CatWasm & { CatKx2SimForTests: new () => Kx2Sim };
let wasm: TestWasm;

beforeAll(async () => {
  const w = await loadWasm();
  expect(w, 'the wasm package in src/wasm/pkg').not.toBeNull();
  wasm = w as TestWasm;
});

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** A Web Serial port, the Digirig's, with the simulated KX2 behind it, answering each write 10 ms later. */
class Kx2SerialPort extends EventTarget implements SerialPortLike {
  readonly sim = new wasm.CatKx2SimForTests();
  /** In order: open and its baud rate, the lines set, each write, close. */
  log: string[] = [];
  /** Whether the radio transmitted when each line change or write arrived. */
  keyedAt: { what: string; keyed: boolean }[] = [];
  forgotten = false;
  silent = false;
  /** The radio ignores RX and keeps transmitting. */
  ignoreRx = false;
  opened: SerialOptionsLike | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readableValue: ReadableStream<Uint8Array> | null = null;
  private writableValue: WritableStream<Uint8Array> | null = null;
  constructor(private readonly info = { usbVendorId: 0x10c4, usbProductId: 0xea60 }) {
    super();
  }
  get readable() {
    return this.readableValue;
  }
  get writable() {
    return this.writableValue;
  }
  async open(o: SerialOptionsLike) {
    this.opened = o;
    this.log.push(`open ${o.baudRate}`);
    // Chromium on Windows asserts DTR and RTS before open() resolves.
    this.sim.set_lines(true, true);
    this.keyedAt.push({ what: 'open', keyed: this.sim.transmit });
    this.readableValue = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
    this.writableValue = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const t = text(chunk);
        this.log.push(t);
        this.keyedAt.push({ what: t, keyed: this.sim.transmit });
        if (this.silent) return;
        const reply = t === 'RX;TQ;' && this.ignoreRx ? new TextEncoder().encode('TQ1;') : this.sim.receive(chunk);
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
  unplug() {
    const c = this.controller;
    this.readableValue = null;
    c?.error(new DOMException('The device has been lost.', 'NetworkError'));
    this.dispatchEvent(new Event('disconnect'));
  }
  /** TX and RX in the order written. */
  get ptt() {
    return this.log.filter((l) => l === 'TX;TQ;' || l === 'RX;TQ;').map((l) => l.slice(0, 2));
  }
  /** Writes that set VFO A, the mode or the data sub-mode. */
  get sets() {
    return this.log.filter((l) => /^(FA\d|MD\d|DT\d)/.test(l));
  }
}

let chosen: Kx2SerialPort;
let granted: Kx2SerialPort[];
let api: SerialApiLike;

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  resetCat();
  chosen = new Kx2SerialPort();
  granted = [];
  api = {
    requestPort: async () => {
      if (!granted.includes(chosen)) granted.push(chosen);
      return chosen;
    },
    getPorts: async () => granted.filter((p) => !p.forgotten),
  };
  setCatDeps({ api: () => api, wasm: async () => wasm, timers: { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) } });
  await updateSettings({ band: '20m', mode: 'FT8', cat: { ...CAT_DEFAULTS, enabled: true, radio: 'kx2' } });
});

afterEach(() => {
  resetCat();
  vi.useRealTimers();
});

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function connect() {
  await initCat();
  const done = connectRadio();
  await run(OPEN_SETTLE_MS + 400);
  await done;
}

describe('connecting a KX2', () => {
  it('lowers DTR and RTS before anything is written, which ends the Digirig’s PTT, then reads the radio and sends no TX or RX', async () => {
    await connect();
    expect(chosen.log.slice(0, 3)).toEqual(['open 4800', 'lines dtr rts', 'TQ;']);
    expect(chosen.opened).toEqual({ baudRate: 4800, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    // The radio transmitted from open() until the lines went low, and never after.
    expect(chosen.keyedAt[0]).toEqual({ what: 'open', keyed: true });
    expect(chosen.keyedAt.slice(1).every((k) => !k.keyed)).toBe(true);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.status).toBe('connected');
    expect(rig.hz).toBe(14_074_000);
    expect(rigModeText()).toBe('USB');
    expect(rig.menu).toMatchObject({ product: 1, mic_btn: 5, vox: 0, k2: 0, split: 0, xit: 0, bandwidth: 2800 });
    expect(chosen.ptt).toEqual([]);
    expect(chosen.sets).toEqual([]);
    expect(settings.cat).toMatchObject({ radio: 'kx2', connect: true, keyPtt: false });
  });

  it('drops what arrived before the 100 ms wait ended', async () => {
    await initCat();
    const done = connectRadio();
    await vi.advanceTimersByTimeAsync(0);
    // An answer of another dial in the first 100 ms, as from a program before RR73: nobody listens yet.
    chosen.send(new TextEncoder().encode('FA00007074000;'));
    await run(OPEN_SETTLE_MS / 2);
    expect(rig.hz).toBeNull();
    await run(OPEN_SETTLE_MS + 400);
    await done;
    expect(rig.hz).toBe(14_074_000);
    expect(settings.band).toBe('20m');
    expect(rig.status).toBe('connected');
  });

  it('with MIC BTN OFF, opening the port keys nothing', async () => {
    chosen.sim.mic_btn = 0;
    await connect();
    expect(chosen.keyedAt.every((k) => !k.keyed)).toBe(true);
    expect(rig.menu.mic_btn).toBe(0);
  });

  it('closes the port when the lines cannot be lowered', async () => {
    chosen.setSignals = async () => Promise.reject(new DOMException('Failed to set control signals.', 'NetworkError'));
    await connect();
    expect(rig.status).toBe('failed');
    expect(rig.error).toBe('signals');
    expect(chosen.log).toEqual(['open 4800', 'close']);
  });

  it('opens at the baud rate chosen, and a new rate closes the port and opens it again at that rate, lines low first, once MIC BTN read OFF', async () => {
    chosen.sim.mic_btn = 0;
    await connect();
    expect(settings.cat.kx2MicBtn).toBe(0);
    const changed = setKx2Baud(38400);
    await run(OPEN_SETTLE_MS + 400);
    await changed;
    expect(settings.cat.kx2Baud).toBe(38400);
    const reopen = chosen.log.lastIndexOf('open 38400');
    expect(reopen).toBeGreaterThan(0);
    expect(chosen.log.slice(reopen - 1, reopen + 3)).toEqual(['close', 'open 38400', 'lines dtr rts', 'TQ;']);
    expect(rig.status).toBe('connected');
    expect(chosen.ptt).toEqual([]);
  });

  it('with MIC BTN on PTT, a new baud rate closes the port and leaves opening it to Connect radio', async () => {
    await connect();
    expect(settings.cat.kx2MicBtn).toBe(5);
    const changed = setKx2Baud(9600);
    await run(OPEN_SETTLE_MS + 400);
    await changed;
    expect(chosen.log.at(-1)).toBe('close');
    expect(chosen.log.filter((l) => l.startsWith('open'))).toEqual(['open 4800']);
    expect(rig.status).toBe('off');
  });

  it('through a KX2 cable, keeps the port open when the lines cannot be lowered and reopens it by itself whatever MIC BTN reads', async () => {
    void updateSettings({ cat: { ...settings.cat, kx2Link: 'cable' } });
    chosen.setSignals = async () => Promise.reject(new DOMException('Failed to set control signals.', 'NetworkError'));
    await connect();
    expect(rig.status).toBe('connected');
    expect(chosen.log).not.toContain('close');
    resetCat();
    chosen.log = [];
    const opening = initCat();
    await run(OPEN_SETTLE_MS + 400);
    await opening;
    expect(chosen.log[0]).toBe('open 4800');
    void updateSettings({ cat: { ...settings.cat, kx2Link: 'digirig' } });
  });

  it('opens the port by itself on starting, or when it comes back, only after MIC BTN read OFF', async () => {
    // Connected once with MIC BTN at PTT UP.DN: the stored read says PTT.
    await connect();
    resetCat();
    chosen.log = [];
    await initCat();
    await run(OPEN_SETTLE_MS + 400);
    expect(chosen.log).toEqual([]);
    expect(rig.status).toBe('off');
    // The operator taps Connect radio: allowed, and MIC BTN reads OFF now.
    chosen.sim.mic_btn = 0;
    const done = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await done;
    expect(settings.cat.kx2MicBtn).toBe(0);
    resetCat();
    chosen.log = [];
    const opening = initCat();
    await run(OPEN_SETTLE_MS + 400);
    await opening;
    expect(chosen.log[0]).toBe('open 4800');
    expect(rig.status).toBe('connected');
  });

  it('shows Transmitting when the radio transmits at connecting with RR73 holding no PTT, and leaves it alone with CAT keying off', async () => {
    chosen.sim.press_xmit(true);
    await connect();
    expect(rig.transmitting).toBe(true);
    expect(rig.keyed).toBe(false);
    expect(chosen.ptt).toEqual([]);
    expect(chosen.sim.transmit).toBe(true);
    chosen.sim.press_xmit(false);
  });

  it('with Key the radio with CAT on, sends RX at connecting when the radio transmits, and confirms it', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    chosen.sim.press_xmit(true);
    await connect();
    expect(chosen.ptt).toEqual(['RX']);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.unkeyFailed).toBe(false);
  });

  it('keeps across a reload that RR73 may have left the radio keyed, and the next page sends RX when it still transmits', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const k = txKeyer()!.key(15_000);
    await run(100);
    expect(settings.cat.leftKeyed).toBe(true);
    void k;
    // The page goes without a word to the radio, as a crash or an update does; CAT keying is turned
    // off in the new page, and the stored flag alone brings the RX.
    resetCat();
    void updateSettings({ cat: { ...settings.cat, keyPtt: false, leftKeyed: true } });
    chosen.sim.mic_btn = 0;
    chosen.log = [];
    const done = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await done;
    expect(chosen.ptt).toEqual(['RX']);
    expect(chosen.sim.transmit).toBe(false);
    expect(settings.cat.leftKeyed).toBe(false);
  });

  it('choosing the IC-705 disconnects the KX2 and forgets its port', async () => {
    await connect();
    await chooseRadio('ic705');
    expect(chosen.forgotten).toBe(true);
    expect(chosen.log.at(-1)).toBe('close');
    expect(settings.cat).toMatchObject({ radio: 'ic705', connect: false });
    expect(rig.status).toBe('off');
  });
});

describe('the KX2’s dial', () => {
  it('is the dial QSOs log while the radio is on RR73’s band', async () => {
    chosen.sim.receive(new TextEncoder().encode('FA00014076000;'));
    expect(configNow().dialHz).toBe(14_074_000);
    await connect();
    expect(rig.hz).toBe(14_076_000);
    expect(configNow().dialHz).toBe(14_076_000);
    expect(dialNow(14_074_000)).toBe(14_076_000);
  });

  it('follows the radio onto another band by polling', async () => {
    await connect();
    chosen.sim.turn_dial(7_074_000);
    await run(1050);
    expect(rig.hz).toBe(7_074_000);
    expect(settings.band).toBe('40m');
  });

  it('sets VFO A and DATA A from the band sheet, reads them back, and waits while the radio transmits', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    expect(rigInDataMode()).toBe(false);
    const k = txKeyer()!.key(15_000);
    await run(50);
    const set = setRadioDial(7_074_000);
    await run(100);
    expect(rig.tuning).toEqual({ hz: 7_074_000, state: 'waiting' });
    expect(chosen.sets).toEqual([]);
    k.release();
    await run(1500);
    await set;
    expect(rig.tuning).toEqual({ hz: 7_074_000, state: 'set' });
    expect(chosen.sets).toEqual(['FA00007074000;FA;', 'MD6;MD;', 'DT0;DT;', 'MD6;MD;']);
    expect([chosen.sim.frequency, chosen.sim.mode, chosen.sim.sub]).toEqual([7_074_000, '"data"', '"data_a"']);
    await run(1000);
    expect(rigModeText()).toBe('DATA A');
    expect(rigInDataMode()).toBe(true);
    expect(chosen.sim.sets_while_transmitting).toBe(0);
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

describe('keying a KX2', () => {
  // DATA A, as the band sheet sets it.
  beforeEach(() => {
    chosen.sim.press_mode('"data"');
  });

  /** An FT8 transmission whose slot starts 2 s from now, `lengthMs` long. */
  async function transmit(lengthMs = 2000) {
    const base = Date.now();
    const { audio, played } = fakeAudio(base, lengthMs);
    const reports: TxReport[] = [];
    const sched = new TxScheduler({ audio: () => audio, encoder: { synthesize: async () => new Float32Array(24000) }, gate: () => rigGate(), report: (r) => reports.push(r), keyer: txKeyer });
    const done = sched.schedule({ text: 'CQ 9V1NE OJ11', mode: 'FT8', slotStartMs: base + 2000, startOffsetS: 0.5, f0Hz: 1500, level: 0.5 });
    return { done, reports, played, sched };
  }

  it('Key the radio with CAT is off by default: a transmission sends no TX or RX', async () => {
    expect(CAT_DEFAULTS.keyPtt).toBe(false);
    expect(CAT_DEFAULTS.enabled).toBe(false);
    await connect();
    const { done, played } = await transmit();
    await run(6000);
    await done;
    expect(played).toHaveLength(1);
    expect(chosen.ptt).toEqual([]);
  });

  it('with it on, TX goes out at the pre-roll, the audio waits for TQ1, and RX goes out after the end and is confirmed', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const { done, played, reports } = await transmit();
    await run(2200);
    await done;
    expect(chosen.ptt).toEqual(['TX']);
    expect(chosen.sim.transmit).toBe(true);
    expect(played).toHaveLength(1);
    await run(4000);
    expect(reports.map((r) => r.type)).toEqual(['started', 'ended']);
    expect(chosen.ptt).toEqual(['TX', 'RX']);
    // RX, then the TQ read that confirmed receive.
    expect(chosen.log.slice(chosen.log.lastIndexOf('RX;TQ;'))).toContain('TQ;');
    expect(chosen.sim.transmit).toBe(false);
  });

  it('never shifts the dial for the KX2, with Keep Tx audio centred on', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true, shiftDial: true } });
    await connect();
    expect(txShiftHz('FT8', 2800)).toBe(0);
  });

  it('Halt sends RX at once while keying by CAT is on', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const { done } = await transmit();
    await run(2200);
    await done;
    expect(chosen.sim.transmit).toBe(true);
    halt();
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen.ptt.at(-1)).toBe('RX');
    await run(100);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('page hide sends RX during a transmission', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const { done } = await transmit();
    await run(2200);
    await done;
    expect(chosen.sim.transmit).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(chosen.ptt.at(-1)).toBe('RX');
    await run(100);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('a lost port turns Tx off and says so; the next connection sends RX as the radio still transmits', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: [string, boolean][] = [];
    const off = onRadioNotice((t, txOff) => notices.push([t, txOff]));
    const { done } = await transmit();
    await run(2200);
    await done;
    chosen.unplug();
    await run(10);
    expect(rig.status).toBe('lost');
    expect(notices).toEqual([['Radio disconnected · Tx off', true]]);
    expect(rigGate()).toBe('Radio not connected');
    off();
    // Keyed by TX, the simulated radio keeps transmitting with the port gone.
    expect(chosen.sim.transmit).toBe(true);
    chosen.log = [];
    const again = connectRadio();
    await run(OPEN_SETTLE_MS + 400);
    await again;
    expect(chosen.log.slice(0, 3)).toEqual(['open 4800', 'lines dtr rts', 'TQ;']);
    expect(chosen.ptt).toEqual(['RX']);
    expect(chosen.sim.transmit).toBe(false);
  });

  it('Disconnect radio during a transmission confirms RX before the port closes', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const { done, sched } = await transmit(10_000);
    const offSched = onHalt(() => sched.halt());
    await run(2200);
    await done;
    const closing = disconnectRadio();
    await run(200);
    await closing;
    expect(chosen.sim.transmit).toBe(false);
    // RX's own TQ read says receive: that confirms it, and the port closes.
    expect(chosen.log.slice(chosen.log.lastIndexOf('RX;TQ;'))).toEqual(['RX;TQ;', 'close']);
    expect(rig.unkeyFailed).toBe(false);
    offSched();
  });

  it('RX unconfirmed after a transmission: the status line says to unkey the radio, and Tx is refused until a read says receive', async () => {
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: string[] = [];
    const off = onRadioNotice((t) => notices.push(t));
    const { done } = await transmit();
    await run(2200);
    await done;
    chosen.ignoreRx = true;
    await run(3500);
    expect(rig.unkeyFailed).toBe(true);
    expect(notices).toContain('PTT off not confirmed · unkey radio');
    expect(rigGate()).toBe('PTT off not confirmed · unkey radio');
    chosen.ignoreRx = false;
    await run(1500);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.unkeyFailed).toBe(false);
    off();
  });

  it('a transmission keyed outside DATA A says the mode in the status line, and still goes', async () => {
    chosen.sim.press_mode('"usb"');
    void updateSettings({ cat: { ...settings.cat, keyPtt: true } });
    await connect();
    const notices: string[] = [];
    const off = onRadioNotice((t) => notices.push(t));
    const { done, played } = await transmit();
    await run(2200);
    await done;
    expect(notices).toEqual([STATUS.radioMode('USB')]);
    expect(played).toHaveLength(1);
    expect(chosen.ptt).toEqual(['TX']);
    off();
    await run(4000);
  });

  it('Test keying outside DATA A says the mode the KX2 was in', async () => {
    chosen.sim.press_mode('"cw"');
    await connect();
    const t = testKeying();
    await run(TEST_KEY_MS + 300);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false });
    expect(rig.test?.state === 'done' && rig.test.text).toMatch(/^Keyed and released at \d\d:\d\d:\d\d UTC, in CW\. The KX2 was not in DATA A: choose a band to set it\.$/);
  });

  it('Test keying keys for 1 s with TX, reads TQ while keyed, and releases with RX, with the switch off', async () => {
    await connect();
    const t = testKeying();
    await run(50);
    expect(chosen.sim.transmit).toBe(true);
    await run(TEST_KEY_MS + 300);
    await t;
    expect(chosen.ptt).toEqual(['TX', 'RX']);
    expect(chosen.sim.transmit).toBe(false);
    expect(rig.test?.state === 'done' && rig.test.text).toMatch(/^Keyed and released at \d\d:\d\d:\d\d UTC\.$/);
  });

  it('Test keying in FSK D says the KX2 did not key, and RX was confirmed', async () => {
    await connect();
    chosen.sim.press_mode('"data"');
    chosen.sim.press_sub('"fsk_d"');
    const t = testKeying();
    await run(2000);
    await t;
    expect(rig.test).toMatchObject({
      state: 'done',
      ok: false,
      text: 'The KX2 did not key on TX. RR73 sent PTT off and the radio confirmed it. It ignores TX in FSK D and PSK D: choose a band to set DATA A.',
    });
    expect(chosen.ptt).toEqual(['TX', 'RX']);
  });

  it('Test keying says when the KX2 returns to receive by itself while keyed', async () => {
    await connect();
    const t = testKeying();
    await run(100);
    chosen.sim.press_xmit(false);
    await run(TEST_KEY_MS + 1000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'The KX2 keyed, then returned to receive. Check its screen for a warning, such as high SWR or temperature.' });
  });

  it('Test keying says when the KX2 answers neither TX nor RX', async () => {
    await connect();
    chosen.silent = true;
    const t = testKeying();
    await run(2000);
    await t;
    expect(rig.test).toMatchObject({ state: 'done', ok: false, text: 'No reply from the KX2 to PTT on or off.' });
    expect(rig.unkeyFailed).toBe(true);
  });
});
