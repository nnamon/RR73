/**
 * One serial port over Web Serial, for rig control in desktop Chromium (docs/design/cat.md).
 * Safari has no Web Serial: serialApi() returns null there and nothing here runs.
 *
 * A SerialLink opens one port, reads in a loop and hands each chunk to its listeners, writes
 * buffers in the order given, and closes. A port that goes away (the cable pulled, the radio
 * switched off, the driver gone) ends the link with `lost`, and the listeners hear it before
 * anything else happens, so the transmit code can turn Tx off at once.
 *
 * TypeScript's DOM types have no Web Serial, so the parts used are declared here.
 */

/** Port settings, as SerialPort.open takes them. */
export interface SerialOptionsLike {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  flowControl?: 'none' | 'hardware';
  bufferSize?: number;
}

/** USB IDs of a port, where the browser knows them. */
export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

/** The parts of a Web Serial SerialPort a link uses. It fires `disconnect` when the device goes. */
export interface SerialPortLike extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptionsLike): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfoLike;
}

/** The parts of navigator.serial RR73 uses. */
export interface SerialApiLike {
  requestPort(options?: { filters?: SerialPortInfoLike[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

/** The browser's Web Serial, or null where it has none (Safari, iOS). */
export function serialApi(nav: unknown = globalThis.navigator): SerialApiLike | null {
  const serial = (nav as { serial?: Partial<SerialApiLike> } | undefined)?.serial;
  return serial && typeof serial.requestPort === 'function' && typeof serial.getPorts === 'function' ? (serial as SerialApiLike) : null;
}

/**
 * The IC-705's USB CI-V port. Any baud rate works over USB (Basic Manual p. 13-2). 8 data bits,
 * no parity, 1 stop bit and no flow control are what the Advanced Manual gives for the USB port's
 * serial data (p. 12-14). Unverified on a device.
 */
export const CIV_PORT: Readonly<SerialOptionsLike> = { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' };

const errorName = (e: unknown): string => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '');

/** The outcome of the browser's port chooser. */
export type Chosen = { port: SerialPortLike } | { error: 'cancelled' | 'refused' };

/**
 * Shows the browser's port chooser. Call from a tap: Chromium allows it only during one.
 * `cancelled` when the operator closes the chooser, `refused` when the browser does not allow it.
 */
export async function choosePort(api: SerialApiLike): Promise<Chosen> {
  try {
    return { port: await api.requestPort() };
  } catch (e) {
    return { error: errorName(e) === 'NotFoundError' ? 'cancelled' : 'refused' };
  }
}

/** The ports the operator granted this app before, which open without the chooser. */
export async function grantedPorts(api: SerialApiLike): Promise<SerialPortLike[]> {
  try {
    return await api.getPorts();
  } catch {
    return [];
  }
}

export type LinkState = 'closed' | 'opening' | 'open' | 'closing';

/** How a link ended: `closed` by RR73, or `lost` when the port went away or failed. */
export type LinkEnd = 'closed' | 'lost';

/**
 * Why a port did not open: `busy` when the system refused it (Windows does when another program
 * has the port open), `failed` otherwise.
 */
export type OpenError = 'busy' | 'failed';

/** A write to a link that is not open. */
export class LinkClosedError extends Error {
  override name = 'LinkClosedError';
  constructor() {
    super('The serial port is not open.');
  }
}

/** Read errors after which the port stays open and `readable` gives a new stream (the Web Serial specification). */
const RECOVERABLE = new Set(['BreakError', 'BufferOverrunError', 'FramingError', 'ParityError']);

export class SerialLink {
  readonly port: SerialPortLike;
  private readonly options: SerialOptionsLike;
  private stateValue: LinkState = 'closed';
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading: Promise<void> | null = null;
  private releasing: Promise<void> | null = null;
  private readonly dataListeners = new Set<(bytes: Uint8Array) => void>();
  private readonly endListeners = new Set<(end: LinkEnd) => void>();
  private readonly onDisconnect = () => this.lose();

  constructor(port: SerialPortLike, options: SerialOptionsLike = CIV_PORT) {
    this.port = port;
    this.options = options;
  }

  get state(): LinkState {
    return this.stateValue;
  }

  /** Listens to the bytes the port delivers, chunk by chunk as they arrive. */
  onData(fn: (bytes: Uint8Array) => void): () => void {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }

  /** Listens for the link ending. */
  onEnd(fn: (end: LinkEnd) => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  /** Opens the port and starts reading. Resolves null once open, or why it did not open. */
  async open(): Promise<OpenError | null> {
    if (this.releasing) await this.releasing;
    if (this.stateValue === 'open') return null;
    if (this.stateValue !== 'closed') return 'failed';
    this.stateValue = 'opening';
    try {
      await this.port.open(this.options);
    } catch (e) {
      this.stateValue = 'closed';
      return errorName(e) === 'NetworkError' ? 'busy' : 'failed';
    }
    this.port.addEventListener('disconnect', this.onDisconnect);
    this.writer = this.port.writable?.getWriter() ?? null;
    this.stateValue = 'open';
    this.reading = this.readLoop();
    return null;
  }

  /** Writes bytes after those written before. Rejects when the link is not open or the port fails. */
  async write(bytes: Uint8Array): Promise<void> {
    const w = this.writer;
    if (this.stateValue !== 'open' || !w) throw new LinkClosedError();
    await w.write(bytes);
  }

  /** Closes the port once what was written has gone out. Ends the link with `closed`. */
  async close(): Promise<void> {
    if (this.stateValue !== 'open') {
      if (this.releasing) await this.releasing;
      return;
    }
    this.stateValue = 'closing';
    await this.release(true);
    this.stateValue = 'closed';
    this.emitEnd('closed');
  }

  private async readLoop(): Promise<void> {
    let previous: ReadableStream<Uint8Array> | null = null;
    while (this.stateValue === 'open') {
      const readable = this.port.readable;
      // No stream, or the one that just failed again: the port is gone.
      if (!readable || readable === previous) break;
      previous = readable;
      const reader = readable.getReader();
      this.reader = reader;
      let recoverable = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) this.emitData(value);
        }
      } catch (e) {
        recoverable = RECOVERABLE.has(errorName(e));
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
      // A stream that ended or failed while open, other than by a recoverable line error, means
      // the port is gone.
      if (!recoverable) break;
    }
    this.lose();
  }

  /** Ends the link with `lost`: listeners hear it first, then the port is released. */
  private lose() {
    if (this.stateValue !== 'open') return;
    this.stateValue = 'closing';
    this.emitEnd('lost');
    void this.release(false).then(() => {
      this.stateValue = 'closed';
    });
  }

  /** Stops reading, lets the writer go (flushing what was written when `flush`) and closes the port. */
  private release(flush: boolean): Promise<void> {
    this.releasing ??= (async () => {
      this.port.removeEventListener('disconnect', this.onDisconnect);
      try {
        await this.reader?.cancel();
      } catch {
        // The stream already failed.
      }
      await this.reading;
      const w = this.writer;
      this.writer = null;
      try {
        if (flush) await w?.close();
        else await w?.abort();
      } catch {
        // The stream already failed; the lock still goes.
      }
      try {
        w?.releaseLock();
      } catch {
        // Already released.
      }
      try {
        await this.port.close();
      } catch {
        // A port that went away closes itself.
      }
    })().finally(() => {
      this.releasing = null;
      this.reading = null;
    });
    return this.releasing;
  }

  private emitData(bytes: Uint8Array) {
    for (const l of this.dataListeners) l(bytes);
  }

  private emitEnd(end: LinkEnd) {
    for (const l of this.endListeners) l(end);
  }
}
