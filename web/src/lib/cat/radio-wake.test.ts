// CatRadio's own timers on the wake timers (lib/clock/wake.ts), against a fake wake clock: the
// worker fires each timeout on time, while the page's clock never gets there, as in a hidden page
// whose timers Chromium throttles. The keying's limit, PTT off's retries and its confirming read,
// and a reply's timeout all keep time. The radio is the simulated IC-705 (CatSimForTests).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadWasm, type Wasm } from '../../../e2e/wasm';
import { wasmCodec, type CatWasm } from './protocol';
import type { LinkEnd } from './serial';
import type { FromWake, ToWake, WakeWorker } from '../clock/wake';

/** The fake wake clock: the test moves it, and the worker's timeouts fire on it. */
const clock = vi.hoisted(() => {
  const timers: { at: number; fn: () => void }[] = [];
  return {
    t: 0,
    timers,
    set(fn: () => void, ms: number) {
      const h = { at: this.t + ms, fn };
      timers.push(h);
      return h;
    },
    clear(h: unknown) {
      const i = timers.indexOf(h as never);
      if (i >= 0) timers.splice(i, 1);
    },
  };
});

// The app's wake timers, with a worker on the fake clock. The page's own timeouts stay on the real
// clock, which the test never waits for.
vi.mock('../clock/wake', async (original) => {
  const m = await original<typeof import('../clock/wake')>();
  const handles = new Map<number, unknown>();
  const worker: WakeWorker = {
    onmessage: null,
    onerror: null,
    postMessage(msg: ToWake) {
      if (msg.type === 'set') handles.set(msg.id, clock.set(() => worker.onmessage?.({ data: { type: 'due', id: msg.id } } as MessageEvent<FromWake>), msg.ms));
      else clock.clear(handles.get(msg.id));
    },
  };
  return { ...m, wake: new m.WakeTimers(() => worker) };
});

const { CatRadio, DRAIN_MS, REPLY_MS, UNKEY_ACK_MS, UNKEY_TRIES } = await import('./radio');

interface Sim {
  receive(bytes: Uint8Array): Uint8Array;
  readonly transmit: boolean;
}

let wasm: Wasm & CatWasm & { CatSimForTests: new () => Sim };

beforeAll(async () => {
  const w = await loadWasm();
  expect(w, 'the wasm package in src/wasm/pkg').not.toBeNull();
  wasm = w as typeof wasm;
});

afterEach(() => {
  vi.restoreAllMocks();
  clock.timers.splice(0);
  clock.t = 0;
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Moves the fake clock `ms`, running each timeout as it falls due. */
async function advance(ms: number) {
  const end = clock.t + ms;
  await settle();
  for (;;) {
    const due = clock.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock.timers.splice(clock.timers.indexOf(due), 1);
    clock.t = due.at;
    due.fn();
    await settle();
  }
  clock.t = end;
  await settle();
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** The simulated IC-705 answering 10 ms after each frame, on the fake clock. */
function setup() {
  vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
  const sim = new wasm.CatSimForTests();
  const written: { at: number; frame: string }[] = [];
  const data = new Set<(b: Uint8Array) => void>();
  const port = {
    silent: false,
    /** PTT off goes unanswered, and the radio keeps transmitting. */
    ignoreOff: false,
    async write(bytes: Uint8Array) {
      const frame = hex(bytes);
      written.push({ at: clock.t, frame });
      if (port.silent || (port.ignoreOff && frame === 'FE FE A4 E0 1C 00 00 FD')) return;
      const reply = sim.receive(bytes);
      clock.set(() => {
        for (const l of data) l(reply);
      }, 10);
    },
    onData(fn: (b: Uint8Array) => void) {
      data.add(fn);
      return () => data.delete(fn);
    },
    onEnd(_fn: (e: LinkEnd) => void) {
      return () => undefined;
    },
  };
  // No timers given: the radio's own, on the wake timers.
  const radio = new CatRadio({ codec: wasmCodec(wasm), transport: port });
  const ptt = () => written.filter((w) => /^FE FE A4 E0 1C 00 0[01] FD$/.test(w.frame)).map((w) => ({ at: w.at, on: w.frame === 'FE FE A4 E0 1C 00 01 FD' }));
  return { sim, port, radio, written, ptt };
}

describe('CatRadio on the wake timers', () => {
  it('ends a keying at its limit on time though the page clock never gets there', async () => {
    const { sim, radio, ptt } = setup();
    radio.start();
    await advance(400);
    const k = radio.key(1000);
    await advance(50);
    expect(await k.result).toBe('ok');
    expect(sim.transmit).toBe(true);
    await advance(1000);
    // PTT on at 400 ms; off at the limit, 1000 ms later.
    expect(ptt().map((p) => [p.at, p.on])).toEqual([
      [400, true],
      [1400, false],
    ]);
    expect(sim.transmit).toBe(false);
    radio.close();
  });

  it('sends PTT off again 100 ms apart and reads transmit or receive after, on time', async () => {
    const { port, radio, ptt, written } = setup();
    radio.start();
    await advance(400);
    const k = radio.key(10_000);
    await advance(50);
    expect(await k.result).toBe('ok');
    port.ignoreOff = true;
    k.release();
    await advance(UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS + 50);
    const offs = ptt().filter((p) => !p.on);
    expect(offs.map((p) => p.at - offs[0].at)).toEqual([0, 100, 200, 300]);
    // Then the read that must say receive, once the last PTT off's wait and the drain after it end.
    const read = written.filter((w) => w.frame === 'FE FE A4 E0 1C 00 FD' && w.at > offs[0].at);
    expect(read[0]?.at).toBe(offs[0].at + UNKEY_TRIES * UNKEY_ACK_MS + DRAIN_MS);
    radio.close();
  });

  it('times a request out after REPLY_MS on time', async () => {
    const { port, radio } = setup();
    radio.start();
    await advance(400);
    port.silent = true;
    let answer: unknown = null;
    const asked = clock.t;
    void radio.request({ type: 'read_frequency' }).then((r) => (answer = { r, at: clock.t }));
    await advance(REPLY_MS + 10);
    expect(answer).toEqual({ r: { ok: false, why: 'timeout' }, at: asked + REPLY_MS });
    radio.close();
  });
});
