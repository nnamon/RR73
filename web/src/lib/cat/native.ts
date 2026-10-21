/**
 * Serial ports in the desktop app (docs/design/desktop.md), in Web Serial's shape: SerialLink
 * (serial.ts) and rig control (lib/state/cat.svelte.ts) run on them unchanged.
 *
 * The Rust side (desktop/src/lib.rs) opens a port and lowers DTR and RTS before the open call
 * returns, reads on a thread of its own and sends each chunk over a channel, and reports a port
 * that went away once. Here a port turns those into Web Serial's streams: chunks into `readable`,
 * a loss into an error on it and a `disconnect` event.
 *
 * Web Serial's permission model is kept: Connect radio shows RR73's own port chooser
 * (`requestPort`), the chosen port is remembered on this computer, `getPorts` gives the remembered
 * ports that are plugged in, `forget` drops one, and `connect` fires when a remembered port
 * appears, checked every CONNECT_POLL_MS.
 */

import type { DesktopBridge, ChannelLike } from '../app/desktop';
import type { SerialApiLike, SerialOptionsLike, SerialPortInfoLike, SerialPortLike, SerialSignalsLike } from './serial';

/** A port as the desktop app lists it. */
export interface NativePortInfo {
  /** The system's name: COM4, /dev/ttyACM0, /dev/cu.usbmodem14101. */
  name: string;
  usbVendorId: number | null;
  usbProductId: number | null;
  /** The device's product or maker text, where the system gives one. */
  label: string | null;
}

/** What the Rust side sends on a port's channel. */
export type NativeEvent = { type: 'data'; bytes: number[] } | { type: 'lost' };

/** The ports the operator chose, by system name. */
export interface GrantStore {
  load(): string[];
  save(names: string[]): void;
}

/** Shows the port chooser; resolves with the port chosen, or null when the operator cancels. */
export type PortChooser = (ports: NativePortInfo[]) => Promise<NativePortInfo | null>;

/** How often the list of ports is read for `connect`, ms. */
export const CONNECT_POLL_MS = 2000;

const STORE_KEY = 'rr73.desktop.ports';

/** Remembers the chosen ports in localStorage. Storage that fails keeps them for this session. */
export function localGrants(storage: () => Storage | null = () => globalThis.localStorage ?? null): GrantStore {
  let memory: string[] = [];
  return {
    load() {
      try {
        const v: unknown = JSON.parse(storage()?.getItem(STORE_KEY) ?? 'null');
        if (Array.isArray(v)) memory = v.filter((x): x is string => typeof x === 'string');
      } catch {
        // Unreadable storage: the session's list stands.
      }
      return [...memory];
    },
    save(names) {
      memory = [...names];
      try {
        storage()?.setItem(STORE_KEY, JSON.stringify(names));
      } catch {
        // Storage refused: the choice lasts this session.
      }
    },
  };
}

function domError(name: string, message: string): Error {
  return typeof DOMException === 'function' ? new DOMException(message, name) : Object.assign(new Error(message), { name });
}

/** The Rust side's refusal of an open: `{ kind: 'busy' }` or `{ kind: 'failed', detail }`. */
function openKind(e: unknown): string {
  return e && typeof e === 'object' && 'kind' in e ? String((e as { kind: unknown }).kind) : '';
}

export class NativePort extends EventTarget implements SerialPortLike {
  info: NativePortInfo;
  private readonly bridge: () => Promise<DesktopBridge>;
  private readonly onForget: (port: NativePort) => void;
  private id: number | null = null;
  private readableValue: ReadableStream<Uint8Array> | null = null;
  private writableValue: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  /** Kept so the channel stays alive while the port is open. */
  private channel: ChannelLike<NativeEvent> | null = null;

  constructor(info: NativePortInfo, bridge: () => Promise<DesktopBridge>, onForget: (port: NativePort) => void = () => {}) {
    super();
    this.info = info;
    this.bridge = bridge;
    this.onForget = onForget;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.readableValue;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.writableValue;
  }

  getInfo(): SerialPortInfoLike {
    const i: SerialPortInfoLike = {};
    if (this.info.usbVendorId !== null) i.usbVendorId = this.info.usbVendorId;
    if (this.info.usbProductId !== null) i.usbProductId = this.info.usbProductId;
    return i;
  }

  /** Opens the port. Rejects with a NetworkError when another program has it, as Web Serial does. */
  async open(options: SerialOptionsLike): Promise<void> {
    if (this.id !== null) throw domError('InvalidStateError', 'The port is already open.');
    const b = await this.bridge();
    const settings = {
      baudRate: options.baudRate,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
      hardwareFlow: options.flowControl === 'hardware',
    };
    // Events can come before invoke resolves: the stream exists first and takes them.
    this.readableValue = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    this.channel = b.channel<NativeEvent>((m) => this.event(m));
    let opened: { id: number; linesLow: boolean };
    try {
      opened = await b.invoke<{ id: number; linesLow: boolean }>('serial_open', { name: this.info.name, settings, events: this.channel });
    } catch (e) {
      this.reset();
      throw openKind(e) === 'busy' ? domError('NetworkError', 'The port is in use.') : domError('InvalidStateError', 'The port did not open.');
    }
    const id = opened.id;
    this.id = id;
    this.writableValue = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await b.invoke('serial_write', { id, bytes: Array.from(chunk) });
      },
    });
  }

  private event(m: NativeEvent) {
    const c = this.controller;
    if (!c) return;
    if (m.type === 'data') {
      try {
        c.enqueue(new Uint8Array(m.bytes));
      } catch {
        // The stream was cancelled: the link is closing.
      }
      return;
    }
    this.controller = null;
    try {
      c.error(domError('NetworkError', 'The device has been lost.'));
    } catch {
      // Already closed.
    }
    this.dispatchEvent(new Event('disconnect'));
  }

  /** Sets DTR and RTS. Rejects when the system refuses. */
  async setSignals(signals: SerialSignalsLike): Promise<void> {
    if (this.id === null) throw domError('InvalidStateError', 'The port is not open.');
    const b = await this.bridge();
    await b.invoke('serial_lines', { id: this.id, dtr: signals.dataTerminalReady ?? null, rts: signals.requestToSend ?? null });
  }

  /** Closes the port. Closing a port that is not open does nothing. */
  async close(): Promise<void> {
    const id = this.id;
    const c = this.controller;
    this.reset();
    try {
      c?.close();
    } catch {
      // Cancelled or errored already.
    }
    if (id === null) return;
    const b = await this.bridge();
    await b.invoke('serial_close', { id });
  }

  /** Forgets the operator's choice of this port: it no longer opens without the chooser. */
  async forget(): Promise<void> {
    this.onForget(this);
  }

  private reset() {
    this.id = null;
    this.controller = null;
    this.channel = null;
    this.readableValue = null;
    this.writableValue = null;
  }
}

export class NativeSerialApi implements SerialApiLike {
  private readonly bridge: () => Promise<DesktopBridge>;
  private readonly choose: PortChooser;
  private readonly grants: GrantStore;
  private readonly every: (fn: () => void, ms: number) => void;
  /** One object per system name, so a port is the same object in every list, as in Web Serial. */
  private readonly ports = new Map<string, NativePort>();
  private polling = false;

  constructor(
    bridge: () => Promise<DesktopBridge>,
    choose: PortChooser,
    grants: GrantStore = localGrants(),
    every: (fn: () => void, ms: number) => void = (fn, ms) => void setInterval(fn, ms),
  ) {
    this.bridge = bridge;
    this.choose = choose;
    this.grants = grants;
    this.every = every;
  }

  /** The ports there are now. An error reads as none. */
  async list(): Promise<NativePortInfo[]> {
    try {
      return await (await this.bridge()).invoke<NativePortInfo[]>('serial_list');
    } catch {
      return [];
    }
  }

  private portFor(info: NativePortInfo): NativePort {
    let p = this.ports.get(info.name);
    if (p) p.info = info;
    else {
      p = new NativePort(info, this.bridge, (gone) => this.grants.save(this.grants.load().filter((n) => n !== gone.info.name)));
      this.ports.set(info.name, p);
    }
    return p;
  }

  /** RR73's port chooser. Rejects with NotFoundError when the operator cancels, as Web Serial does. */
  async requestPort(): Promise<SerialPortLike> {
    const chosen = await this.choose(await this.list());
    if (!chosen) throw domError('NotFoundError', 'No port chosen.');
    const names = this.grants.load();
    if (!names.includes(chosen.name)) this.grants.save([...names, chosen.name]);
    return this.portFor(chosen);
  }

  /** The chosen ports that are there now. */
  async getPorts(): Promise<SerialPortLike[]> {
    const names = new Set(this.grants.load());
    return (await this.list()).filter((i) => names.has(i.name)).map((i) => this.portFor(i));
  }

  /** `connect` fires when a chosen port appears that was not there at the last look. */
  addEventListener(type: 'connect', listener: () => void): void {
    if (type !== 'connect' || this.polling) return;
    this.polling = true;
    let seen: Set<string> | null = null;
    const look = async () => {
      const names = new Set(this.grants.load());
      const now = new Set((await this.list()).map((i) => i.name).filter((n) => names.has(n)));
      const appeared = seen !== null && [...now].some((n) => !seen?.has(n));
      seen = now;
      if (appeared) listener();
    };
    void look();
    this.every(() => void look(), CONNECT_POLL_MS);
  }
}
