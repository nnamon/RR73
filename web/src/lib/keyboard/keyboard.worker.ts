// Keyboard worker: the modem of the keyboard mode in use (RTTY: rr73-wasm's RttyReceiver and
// RttyTransmitter). It decodes each capture chunk as it arrives and renders transmit audio
// straight to the stream worklet (protocol.ts). The WebAssembly module is optional at build
// time, as in the decoder worker; without it the worker reports failed.

import type { KeyboardModem } from './modem';
import { charTables } from './modem';
import { TxPump } from './pump';
import type { FromKeyboard, StreamNeed, ToKeyboard, ToStream } from './protocol';
import { RttyModem, type RttyWasm } from '../rtty/modem';

type Module = RttyWasm & { default: (input?: unknown) => Promise<unknown>; version: () => string };

const modules = import.meta.glob<Module>('../../wasm/pkg/rr73_wasm.js');
const loader = Object.values(modules)[0] ?? null;

const scope = self as unknown as {
  postMessage(m: FromKeyboard, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToKeyboard>) => void) | null;
};

const post = (m: FromKeyboard, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

let wasm: Promise<Module | null> | null = null;
let modem: KeyboardModem | null = null;
let pump: TxPump | null = null;
let link: MessagePort | null = null;

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function load(): Promise<Module | null> {
  wasm ??= (async () => {
    if (!loader) {
      post({ type: 'failed', detail: 'This build has no WebAssembly module.' });
      return null;
    }
    try {
      const m = await loader();
      await m.default();
      post({ type: 'ready', version: m.version() });
      return m;
    } catch (e) {
      post({ type: 'failed', detail: describe(e) });
      return null;
    }
  })();
  return wasm;
}

function stopTx() {
  pump = null;
  if (link) {
    link.onmessage = null;
    link.close();
  }
  link = null;
}

async function handle(m: ToKeyboard) {
  if (m.type === 'load') {
    await load();
    return;
  }
  if (m.type === 'configure') {
    const w = await load();
    if (!w) return;
    try {
      const next = new RttyModem(w, m.rtty);
      modem?.free();
      modem = next;
      post({ type: 'tables', tables: charTables(next) });
    } catch (e) {
      post({ type: 'failed', detail: describe(e) });
    }
    return;
  }
  if (m.type === 'encode') {
    await load();
    let samples: Float32Array | null = null;
    try {
      samples = modem ? modem.encode(m.text, m.hz) : null;
    } catch {
      samples = null;
    }
    post({ type: 'encoded', id: m.id, samples }, samples ? [samples.buffer] : []);
    return;
  }
  if (m.type === 'txStart') {
    stopTx();
    if (!modem) {
      m.port.close();
      post({ type: 'tx', queuedS: 0, skipped: 0, done: true });
      return;
    }
    link = m.port;
    const tx = modem.transmitter(m.sampleRate, m.level);
    const p = new TxPump(
      tx,
      m.sampleRate,
      (s: ToStream, transfer?: Transferable[]) => link?.postMessage(s, transfer ?? []),
      (queuedS, skipped, done) => post({ type: 'tx', queuedS, skipped, done }),
    );
    pump = p;
    link.onmessage = (e: MessageEvent<StreamNeed>) => {
      if (pump === p && e.data.type === 'need') p.fill(e.data.takenFrames);
    };
    p.fill(0);
    return;
  }
  if (m.type === 'txText') pump?.text(m.text);
  else if (m.type === 'txFinish') {
    pump?.finish();
    pump?.fill();
  } else if (m.type === 'txStop') stopTx();
  else if (!modem) return;
  else if (m.type === 'push') post({ type: 'events', events: modem.push(m.samples) });
  else if (m.type === 'flush') post({ type: 'events', events: modem.flush() });
  else if (m.type === 'tune') modem.tune(m.hz);
  else if (m.type === 'find') modem.find(m.hz, m.rangeHz);
  else if (m.type === 'afc') modem.setAfc(m.on);
  else if (m.type === 'reset') modem.reset();
}

// Messages are handled in order: a chunk never overtakes the configure before it.
let chain: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  chain = chain.then(() => handle(e.data)).catch(() => undefined);
};
