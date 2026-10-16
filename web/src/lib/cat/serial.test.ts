// The serial link against a fake port that behaves as the Web Serial specification describes:
// open() rejects with NetworkError when the system refuses the port; a line error (framing,
// parity, break, overrun) fails the stream and `readable` gives a new one; a lost device fails the
// stream, leaves `readable` null and fires `disconnect`; close() rejects while a stream is locked.
import { describe, expect, it, vi } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';
import { CIV_PORT, LinkClosedError, SerialLink, choosePort, grantedPorts, serialApi, type SerialApiLike, type SerialOptionsLike, type SerialPortLike } from './serial';

class FakePort extends EventTarget implements SerialPortLike {
  opened: SerialOptionsLike | null = null;
  /** What happened to the port, in order: open, the lines set, writes, close. */
  events: string[] = [];
  /** DTR and RTS as Chromium on Windows leaves them after open(): asserted. */
  dtr = false;
  rts = false;
  signalsError: DOMException | null = null;
  closes = 0;
  written: number[] = [];
  openError: DOMException | null = null;
  /** Writes wait for this before they complete. */
  writeGate: Promise<void> = Promise.resolve();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readableValue: ReadableStream<Uint8Array> | null = null;
  private writableValue: WritableStream<Uint8Array> | null = null;

  get readable() {
    return this.readableValue;
  }

  get writable() {
    return this.writableValue;
  }

  async open(o: SerialOptionsLike) {
    if (this.openError) throw this.openError;
    if (this.opened) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.opened = o;
    this.dtr = true;
    this.rts = true;
    this.events.push('open');
    this.newReadable();
    this.writableValue = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        this.events.push(`write with DTR ${this.dtr ? 'high' : 'low'}, RTS ${this.rts ? 'high' : 'low'}`);
        await this.writeGate;
        this.written.push(...chunk);
      },
    });
  }

  async close() {
    if (this.readableValue?.locked || this.writableValue?.locked) throw new TypeError('A stream is locked.');
    this.closes++;
    this.opened = null;
    this.readableValue = null;
    this.writableValue = null;
  }

  getInfo() {
    return { usbVendorId: 0x1234, usbProductId: 0x5678 };
  }

  async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }) {
    if (this.signalsError) throw this.signalsError;
    if (s.dataTerminalReady !== undefined) this.dtr = s.dataTerminalReady;
    if (s.requestToSend !== undefined) this.rts = s.requestToSend;
    this.events.push(`signals DTR ${this.dtr ? 'high' : 'low'}, RTS ${this.rts ? 'high' : 'low'}`);
  }

  /** The radio sends bytes. */
  send(bytes: number[]) {
    this.controller?.enqueue(Uint8Array.from(bytes));
  }

  /** A line error: the stream fails and `readable` gives a new one. */
  lineError(name: string) {
    const old = this.controller;
    this.newReadable();
    old?.error(new DOMException('Line error.', name));
  }

  /** The device goes away: the stream fails, `readable` is null, `disconnect` fires. */
  unplug(fire = true) {
    const old = this.controller;
    this.readableValue = null;
    this.controller = null;
    old?.error(new DOMException('The device has been lost.', 'NetworkError'));
    if (fire) this.dispatchEvent(new Event('disconnect'));
  }

  private newReadable() {
    this.readableValue = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
  }
}

/** Lets pending reads and writes run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function openLink() {
  const port = new FakePort();
  const link = new SerialLink(port);
  const data: number[] = [];
  const ends: string[] = [];
  link.onData((b) => data.push(...b));
  link.onEnd((e) => ends.push(e));
  expect(await link.open()).toBeNull();
  return { port, link, data, ends };
}

describe('SerialLink', () => {
  it('opens the port with the CI-V settings and hands on what it reads', async () => {
    const { port, link, data } = await openLink();
    expect(link.state).toBe('open');
    expect(port.opened).toEqual({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    expect(port.opened).toEqual(CIV_PORT);
    port.send([0xfe, 0xfe, 0xe0]);
    port.send([0xa4, 0xfb, 0xfd]);
    await settle();
    expect(data).toEqual([0xfe, 0xfe, 0xe0, 0xa4, 0xfb, 0xfd]);
  });

  it('writes in the order given', async () => {
    const { port, link } = await openLink();
    let open!: () => void;
    port.writeGate = new Promise((r) => (open = r));
    const a = link.write(Uint8Array.from([1, 2]));
    const b = link.write(Uint8Array.from([3]));
    await settle();
    expect(port.written).toEqual([]);
    open();
    await Promise.all([a, b]);
    expect(port.written).toEqual([1, 2, 3]);
  });

  it('closes once what was written has gone out', async () => {
    const { port, link, ends } = await openLink();
    let open!: () => void;
    port.writeGate = new Promise((r) => (open = r));
    void link.write(Uint8Array.from([0x1c, 0x00, 0x00]));
    const closing = link.close();
    expect(link.state).toBe('closing');
    await settle();
    expect(port.closes).toBe(0);
    open();
    await closing;
    expect(port.written).toEqual([0x1c, 0x00, 0x00]);
    expect(port.closes).toBe(1);
    expect(link.state).toBe('closed');
    expect(ends).toEqual(['closed']);
    await expect(link.write(Uint8Array.from([1]))).rejects.toBeInstanceOf(LinkClosedError);
    // Closing again does nothing.
    await link.close();
    expect(ends).toEqual(['closed']);
  });

  it('opens again after closing', async () => {
    const { port, link, data } = await openLink();
    await link.close();
    expect(await link.open()).toBeNull();
    port.send([7]);
    await settle();
    expect(data).toEqual([7]);
  });

  it('reads on through a line error', async () => {
    const { port, link, data, ends } = await openLink();
    port.send([1]);
    await settle();
    port.lineError('FramingError');
    await settle();
    port.send([2]);
    await settle();
    expect(data).toEqual([1, 2]);
    expect(link.state).toBe('open');
    expect(ends).toEqual([]);
  });

  it('ends as lost when the device goes, telling listeners before it lets the port go', async () => {
    const { port, link, ends } = await openLink();
    const states: string[] = [];
    link.onEnd(() => states.push(`${link.state}, ${port.closes} closes`));
    port.unplug();
    expect(ends).toEqual(['lost']);
    expect(states).toEqual(['closing, 0 closes']);
    await vi.waitFor(() => expect(link.state).toBe('closed'));
    expect(ends).toEqual(['lost']);
    await expect(link.write(Uint8Array.from([1]))).rejects.toBeInstanceOf(LinkClosedError);
  });

  it('ends as lost when the stream fails without a disconnect event', async () => {
    const { port, link, ends } = await openLink();
    port.unplug(false);
    await vi.waitFor(() => expect(ends).toEqual(['lost']));
    await vi.waitFor(() => expect(link.state).toBe('closed'));
  });

  it('lowers DTR and RTS as soon as the port opens, before any write', async () => {
    const { port, link } = await openLink();
    await link.write(Uint8Array.from([1]));
    expect(port.events).toEqual(['open', 'signals DTR low, RTS low', 'write with DTR low, RTS low']);
  });

  it('closes the port again when the lines cannot be lowered', async () => {
    const port = new FakePort();
    port.signalsError = new DOMException('Failed to set control signals.', 'NetworkError');
    const link = new SerialLink(port);
    expect(await link.open()).toBe('signals');
    expect(link.state).toBe('closed');
    expect(port.closes).toBe(1);
    await expect(link.write(Uint8Array.from([1]))).rejects.toBeInstanceOf(LinkClosedError);
  });

  it('with keepOpenWithoutLines, stays open when the lines cannot be lowered and says so', async () => {
    const port = new FakePort();
    port.signalsError = new DOMException('Failed to set control signals.', 'NetworkError');
    let before = 0;
    const link = new SerialLink(port, CIV_PORT, { keepOpenWithoutLines: true, steps: { signals: () => before++ } });
    expect(await link.open()).toBeNull();
    expect(before).toBe(1);
    expect(link.state).toBe('open');
    expect(link.linesLow).toBe(false);
    expect(port.closes).toBe(0);
    await link.write(Uint8Array.from([1]));
    const ok = new SerialLink(new FakePort(), CIV_PORT, { keepOpenWithoutLines: true });
    expect(await ok.open()).toBeNull();
    expect(ok.linesLow).toBe(true);
  });

  it('says why a port did not open', async () => {
    const busy = new FakePort();
    busy.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    const link = new SerialLink(busy);
    expect(await link.open()).toBe('busy');
    expect(link.state).toBe('closed');
    const odd = new FakePort();
    odd.openError = new DOMException('No.', 'SecurityError');
    expect(await new SerialLink(odd).open()).toBe('failed');
  });
});

describe('Web Serial', () => {
  const api = (over: Partial<SerialApiLike> = {}): SerialApiLike => ({
    requestPort: vi.fn(async () => new FakePort()),
    getPorts: vi.fn(async () => [new FakePort()]),
    ...over,
  });

  it('is found where navigator.serial exists, and nowhere else', () => {
    const serial = api();
    expect(serialApi({ serial })).toBe(serial);
    expect(serialApi({})).toBeNull();
    expect(serialApi(undefined)).toBeNull();
    expect(serialApi({ serial: {} })).toBeNull();
  });

  it('turns the chooser into a port, cancelled or refused', async () => {
    const chosen = await choosePort(api());
    expect('port' in chosen).toBe(true);
    const cancelled = api({ requestPort: async () => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError')) });
    expect(await choosePort(cancelled)).toEqual({ error: 'cancelled' });
    const refused = api({ requestPort: async () => Promise.reject(new DOMException('Must be handling a user gesture.', 'SecurityError')) });
    expect(await choosePort(refused)).toEqual({ error: 'refused' });
  });

  it('lists the ports granted before, or none', async () => {
    expect(await grantedPorts(api())).toHaveLength(1);
    expect(await grantedPorts(api({ getPorts: async () => Promise.reject(new Error('gone')) }))).toEqual([]);
  });
});

describe('the link with the CI-V parser', () => {
  it('carries a request out and the radio’s answer back as events', async () => {
    const wasm = await loadWasm();
    expect(wasm, 'the wasm package in src/wasm/pkg').not.toBeNull();
    if (!wasm) return;
    const { port, link } = await openLink();
    const parser = new wasm.CatParser(0xa4);
    const events: unknown[] = [];
    link.onData((b) => events.push(...(JSON.parse(parser.push(b)) as unknown[])));
    await link.write(wasm.cat_encode('{"type":"read_transmit"}', 0xa4));
    expect(port.written).toEqual([0xfe, 0xfe, 0xa4, 0xe0, 0x1c, 0x00, 0xfd]);
    // The answer arrives split across 2 chunks.
    port.send([0xfe, 0xfe, 0xe0, 0xa4]);
    port.send([0x1c, 0x00, 0x00, 0xfd]);
    await settle();
    expect(events).toEqual([{ type: 'transmit', on: false }]);
    parser.free();
    await link.close();
  });
});
