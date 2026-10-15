import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DEEP, DecoderBusyError, DecoderUnavailableError, PRESET, WorkerDecoder, type WorkerLike } from './worker-client';
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

  it('sends the QSO under way with the slot', () => {
    const { d, workers } = setup();
    void d.decodeSlot({ ...slot(), qso: { myCall: '9V1NE', dxCall: 'K1ABC', dxHz: 1485 } }).catch(() => undefined);
    void d.decodeSlot(slot()).catch(() => undefined);
    expect(workers[0].sent[1].m).toMatchObject({ type: 'decode', qso: { myCall: '9V1NE', dxCall: 'K1ABC', dxHz: 1485 } });
    expect(workers[0].sent[2].m).not.toHaveProperty('qso');
  });

  it('runs the later stages for FT8 slots that ask for them and passes on what they find', async () => {
    const { d, workers } = setup();
    const more: string[][] = [];
    const done = d.decodeSlot(slot(), (x) => more.push(x.map((m) => m.text)));
    expect(workers[0].sent[1].m).toMatchObject({ type: 'decode', id: 1, deep: DEEP });
    workers[0].reply({ type: 'decoded', id: 1, decodes: [], ms: 90 });
    await expect(done).resolves.toEqual([]);
    // The slot no longer counts as waiting while its later stages run.
    void d.decodeSlot(slot());
    void d.decodeSlot(slot());
    workers[0].reply({ type: 'decodedMore', id: 1, decodes: [{ text: 'CQ 9V1NE OJ11', freq_hz: 900, dt_s: 0.2, snr_db: -22 }], ms: 400, done: false });
    workers[0].reply({ type: 'decodedMore', id: 1, decodes: [], ms: 600, done: true });
    workers[0].reply({ type: 'decodedMore', id: 1, decodes: [{ text: 'CQ K1ABC FN42', freq_hz: 500, dt_s: 0, snr_db: -3 }], ms: 700, done: true });
    expect(more).toEqual([['CQ 9V1NE OJ11']]);
  });

  it('runs no later stages for FT4, for a partial slot, or without a listener', () => {
    const { d, workers } = setup();
    void d.decodeSlot({ ...slot(), mode: 'FT4', samples: new Float32Array(90000) }, () => undefined);
    void d.decodeSlot(slot());
    expect(workers[0].sent.slice(1).map((s) => 'deep' in s.m)).toEqual([false, false]);
    const { d: d2, workers: w2 } = setup();
    void d2.decodeSlot({ ...slot(), samples: new Float32Array(162000), partial: true }, () => undefined);
    expect(w2[0].sent[1].m).toMatchObject({ type: 'decode', partial: true });
    expect(w2[0].sent[1].m).not.toHaveProperty('deep');
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

  it('has a CI gate file recorded for the same later stages', () => {
    const gate = new URL(`../../../../bench/${PRESET}-deep.json`, import.meta.url);
    expect(existsSync(gate)).toBe(true);
    const recorded = JSON.parse(readFileSync(gate, 'utf8')) as { preset: string; then: string[] };
    expect(recorded.preset).toBe(PRESET);
    expect(recorded.then).toEqual(DEEP.plan.split(';').map((s) => s.trim()));
  });
});

describe('WorkerDecoder encoder', () => {
  it('packs and synthesises through the worker, without the decode limit', async () => {
    const { d, workers } = setup();
    void d.decodeSlot(slot());
    void d.decodeSlot(slot());
    const packed = d.pack('cq 9v1ne oj11', 'FT8');
    const audio = d.synthesize('CQ 9V1NE OJ11', 'FT8', 1500, 48000);
    const [p, s] = workers[0].sent.slice(-2).map((x) => x.m);
    expect(p).toEqual({ type: 'pack', id: 3, text: 'cq 9v1ne oj11', mode: 'FT8' });
    expect(s).toEqual({ type: 'synth', id: 4, text: 'CQ 9V1NE OJ11', mode: 'FT8', f0Hz: 1500, sampleRate: 48000 });
    workers[0].reply({ type: 'packed', id: 3, packed: { ok: true, text: 'CQ 9V1NE OJ11', i3n3: '1.0', error: null } });
    workers[0].reply({ type: 'synthesized', id: 4, samples: new Float32Array(10), ms: 4 });
    await expect(packed).resolves.toMatchObject({ ok: true, text: 'CQ 9V1NE OJ11' });
    await expect(audio).resolves.toHaveLength(10);
  });

  it('rejects encoder requests that fail', async () => {
    const { d, workers } = setup();
    const audio = d.synthesize('X', 'FT8', 1500, 48000);
    workers[0].reply({ type: 'error', id: 1, detail: 'bad' });
    await expect(audio).rejects.toThrow('bad');
    workers[0].reply({ type: 'failed', reason: 'load', detail: 'gone' });
    await expect(d.pack('X', 'FT8')).rejects.toBeInstanceOf(DecoderUnavailableError);
  });
});

describe('WorkerDecoder for WSPR', () => {
  it('transfers a WSPR slot with the wspr preset and resolves with its decodes and decoder time', async () => {
    const { d, workers } = setup();
    const samples = new Float32Array(1_440_000);
    const done = d.decodeWspr(samples);
    const { m, transfer } = workers[0].sent.at(-1)!;
    expect(m).toMatchObject({ type: 'decodeWspr', id: 1, preset: 'wspr' });
    expect(transfer).toEqual([samples.buffer]);
    const decodes = [{ text: 'K1ABC FN42 37', freq_hz: 1500.2, dt_s: 0.3, drift_hz_per_s: 0.01, snr_db: -22 }];
    workers[0].reply({ type: 'decodedWspr', id: 1, decodes, ms: 812 });
    await expect(done).resolves.toEqual({ decodes, ms: 812 });
  });

  it('shares the limit of waiting slots with FT8', async () => {
    const { d } = setup();
    void d.decodeWspr(new Float32Array(10));
    void d.decodeWspr(new Float32Array(10));
    await expect(d.decodeWspr(new Float32Array(10))).rejects.toBeInstanceOf(DecoderBusyError);
  });

  it('has a CI gate file recorded for the WSPR preset', () => {
    const gate = new URL('../../../../bench/wspr.json', import.meta.url);
    expect(JSON.parse(readFileSync(gate, 'utf8')).preset).toBe('wspr');
  });
});
