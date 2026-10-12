import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DecoderBusyError, DecoderUnavailableError, PRESET, WorkerDecoder, type WorkerLike } from './worker-client';
import type { FromDecoder, ToDecoder } from './protocol';
import type { DecoderStatus } from './types';

class FakeWorker implements WorkerLike {
  sent: { m: ToDecoder; transfer?: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<FromDecoder>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(m: ToDecoder, transfer?: Transferable[]) {
    this.sent.push({ m, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: FromDecoder) {
    this.onmessage?.({ data: m } as MessageEvent<FromDecoder>);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const d = new WorkerDecoder(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  const states: DecoderStatus[] = [];
  d.onStatus((s) => states.push(s));
  return { d, workers, states };
}

const slot = () => ({ mode: 'FT8' as const, startUtcMs: 0, samples: new Float32Array(180000) });

describe('WorkerDecoder', () => {
  it('starts one worker, asks it to load and reports ready with version and load time', () => {
    const { d, workers, states } = setup();
    expect(d.status).toEqual({ state: 'idle' });
    d.load();
    d.load();
    expect(workers).toHaveLength(1);
    expect(workers[0].sent[0].m).toEqual({ type: 'load' });
    workers[0].reply({ type: 'ready', version: '0.1.0', loadMs: 84 });
    expect(states).toEqual([{ state: 'loading' }, { state: 'ready', version: '0.1.0', loadMs: 84 }]);
    expect(d.available).toBe(true);
  });

  it('transfers the slot audio and resolves with the decodes', async () => {
    const { d, workers } = setup();
    const s = slot();
    const done = d.decodeSlot(s);
    const sent = workers[0].sent[1];
    expect(sent.m).toMatchObject({ type: 'decode', id: 1, mode: 'FT8', preset: PRESET });
    expect(sent.transfer).toEqual([s.samples.buffer]);
    workers[0].reply({ type: 'decoded', id: 1, decodes: [{ text: 'CQ K1ABC FN42', freq_hz: 500, dt_s: 0, snr_db: -3 }], ms: 380 });
    await expect(done).resolves.toEqual([{ text: 'CQ K1ABC FN42', freq_hz: 500, dt_s: 0, snr_db: -3 }]);
  });

  it('matches answers to their slots by id', async () => {
    const { d, workers } = setup();
    const a = d.decodeSlot(slot());
    const b = d.decodeSlot(slot());
    workers[0].reply({ type: 'decoded', id: 2, decodes: [], ms: 1 });
    workers[0].reply({ type: 'error', id: 1, detail: 'bad' });
    await expect(b).resolves.toEqual([]);
    await expect(a).rejects.toThrow('bad');
  });

  it('refuses a third waiting slot', async () => {
    const { d } = setup();
    void d.decodeSlot(slot());
    void d.decodeSlot(slot());
    await expect(d.decodeSlot(slot())).rejects.toBeInstanceOf(DecoderBusyError);
  });

  it('reports a failed load, rejects waiting slots and refuses new ones', async () => {
    const { d, workers } = setup();
    const waiting = d.decodeSlot(slot());
    workers[0].reply({ type: 'failed', reason: 'load', detail: 'TypeError: Failed to fetch' });
    await expect(waiting).rejects.toBeInstanceOf(DecoderUnavailableError);
    expect(d.status).toEqual({ state: 'failed', reason: 'load', detail: 'TypeError: Failed to fetch' });
    expect(d.available).toBe(false);
    expect(workers[0].terminated).toBe(true);
    await expect(d.decodeSlot(slot())).rejects.toBeInstanceOf(DecoderUnavailableError);
  });

  it('reports a worker that stops after loading as crashed', () => {
    const { d, workers } = setup();
    d.load();
    workers[0].reply({ type: 'ready', version: '0.1.0', loadMs: 1 });
    workers[0].onerror?.({ message: 'out of memory', preventDefault() {} } as ErrorEvent);
    expect(d.status).toMatchObject({ state: 'failed', reason: 'crashed' });
  });

  it('reports a worker that cannot start', () => {
    const d = new WorkerDecoder(() => {
      throw new Error('no workers');
    });
    d.load();
    expect(d.status).toMatchObject({ state: 'failed', reason: 'worker' });
  });
});

describe('shipped preset', () => {
  it('has a CI gate file recorded for the same preset', () => {
    const gate = new URL(`../../../../bench/${PRESET}.json`, import.meta.url);
    expect(existsSync(gate)).toBe(true);
    expect(JSON.parse(readFileSync(gate, 'utf8')).preset).toBe(PRESET);
  });
});
