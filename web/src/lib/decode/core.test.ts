import { describe, expect, it, vi } from 'vitest';
import { DecoderCore, type WasmModule } from './core';
import type { FromDecoder } from './protocol';

function fakeModule(over: Partial<WasmModule> = {}): WasmModule {
  return {
    default: vi.fn(async () => undefined),
    decode_slot: vi.fn(() => '[{"text":"CQ 9M2TRX OJ02","freq_hz":1022,"dt_s":0.1,"snr_db":-10}]'),
    pack_message: () => '{}',
    synthesize: () => new Float32Array(0),
    decode_wspr: vi.fn(() => '[{"text":"K1ABC FN42 37","freq_hz":1500.2,"dt_s":0.3,"drift_hz_per_s":0.01,"snr_db":-22}]'),
    pack_wspr: () => '{"ok":true,"text":"K1ABC FN42 37","message_type":1,"error":null}',
    synthesize_wspr: () => new Float32Array(0),
    version: () => '0.1.0',
    ...over,
  };
}

function setup(loader: (() => Promise<WasmModule>) | null) {
  const posted: FromDecoder[] = [];
  let t = 1000;
  const core = new DecoderCore(loader, (m) => posted.push(m), () => (t += 25));
  return { core, posted };
}

const slot = (id: number) => ({ type: 'decode' as const, id, mode: 'FT8' as const, preset: 'baseline', samples: new Float32Array(180000) });

describe('DecoderCore', () => {
  it('loads the module once and reports its version and load time', async () => {
    const mod = fakeModule();
    const loader = vi.fn(async () => mod);
    const { core, posted } = setup(loader);
    await core.handle({ type: 'load' });
    await core.handle({ type: 'load' });
    expect(loader).toHaveBeenCalledOnce();
    expect(mod.default).toHaveBeenCalledOnce();
    expect(posted).toEqual([{ type: 'ready', version: '0.1.0', loadMs: 25 }]);
  });

  it('decodes a slot with the preset and reports the decodes and the time taken', async () => {
    const mod = fakeModule();
    const { core, posted } = setup(async () => mod);
    await core.handle(slot(7));
    expect(mod.decode_slot).toHaveBeenCalledWith(expect.any(Float32Array), 'FT8', 'baseline');
    expect(posted[1]).toEqual({ type: 'decoded', id: 7, decodes: [{ text: 'CQ 9M2TRX OJ02', freq_hz: 1022, dt_s: 0.1, snr_db: -10 }], ms: 25 });
  });

  it('sets the QSO under way before each slot, and clears it for a slot without one', async () => {
    const calls: string[] = [];
    const set = vi.fn((my: string, dx: string, hz: number) => calls.push(`${my}|${dx}|${hz}`));
    const mod = fakeModule({ set_qso_context: set, decode_slot: vi.fn(() => (calls.push('decode'), '[]')) });
    const { core } = setup(async () => mod);
    await core.handle({ ...slot(1), qso: { myCall: '9V1NE', dxCall: 'K1ABC', dxHz: 1485 } });
    await core.handle(slot(2));
    expect(calls).toEqual(['9V1NE|K1ABC|1485', 'decode', '||0', 'decode']);
    // A module built before a priori decoding decodes as before.
    const old = fakeModule();
    const { core: plain, posted } = setup(async () => old);
    await plain.handle({ ...slot(3), qso: { myCall: '9V1NE', dxCall: '', dxHz: 0 } });
    expect(posted[1]).toMatchObject({ type: 'decoded', id: 3 });
  });

  it('answers slots in the order they came, after one load', async () => {
    let finishLoad!: () => void;
    const mod = fakeModule({ default: () => new Promise<void>((r) => (finishLoad = r)) });
    const { core, posted } = setup(async () => mod);
    const a = core.handle(slot(1));
    const b = core.handle(slot(2));
    await Promise.resolve();
    await Promise.resolve();
    finishLoad();
    await Promise.all([a, b]);
    expect(posted.map((m) => m.type + ('id' in m ? m.id : ''))).toEqual(['ready', 'decoded1', 'decoded2']);
  });

  it('reports a build without the module as missing and refuses slots', async () => {
    const { core, posted } = setup(null);
    await core.handle(slot(3));
    expect(posted[0]).toMatchObject({ type: 'failed', reason: 'missing' });
    expect(posted[1]).toEqual({ type: 'error', id: 3, detail: 'The decoder is not available.' });
  });

  it('reports a module that fails to load', async () => {
    const { core, posted } = setup(async () => fakeModule({ default: async () => Promise.reject(new TypeError('Failed to fetch')) }));
    await core.handle({ type: 'load' });
    expect(posted).toEqual([{ type: 'failed', reason: 'load', detail: 'TypeError: Failed to fetch' }]);
  });

  it('reports a decoder error for one slot and keeps going', async () => {
    let calls = 0;
    const mod = fakeModule({
      decode_slot: () => {
        if (++calls === 1) throw new Error('unknown preset');
        return '[]';
      },
    });
    const { core, posted } = setup(async () => mod);
    await core.handle(slot(1));
    await core.handle(slot(2));
    expect(posted.slice(1)).toEqual([
      { type: 'error', id: 1, detail: 'Error: unknown preset' },
      { type: 'decoded', id: 2, decodes: [], ms: 25 },
    ]);
  });
});

describe('DecoderCore encoder', () => {
  it('checks messages and synthesises them, transferring the samples', async () => {
    const posted: { m: FromDecoder; transfer?: Transferable[] }[] = [];
    const mod = fakeModule({
      pack_message: (text: string) => JSON.stringify({ ok: true, text: text.toUpperCase(), i3n3: '1.0', error: null }),
      synthesize: (_t: string, _m: string, _f: number, rate: number) => new Float32Array(rate),
    });
    const core = new DecoderCore(async () => mod, (m, transfer) => posted.push({ m, transfer }), () => 0);
    await core.handle({ type: 'pack', id: 1, text: 'cq 9v1ne oj11', mode: 'FT8' });
    await core.handle({ type: 'synth', id: 2, text: 'CQ 9V1NE OJ11', mode: 'FT8', f0Hz: 1500, sampleRate: 48000 });
    expect(posted[1].m).toEqual({ type: 'packed', id: 1, packed: { ok: true, text: 'CQ 9V1NE OJ11', i3n3: '1.0', error: null } });
    const synth = posted[2];
    expect(synth.m).toMatchObject({ type: 'synthesized', id: 2 });
    expect((synth.m as { samples: Float32Array }).samples.length).toBe(48000);
    expect(synth.transfer).toEqual([(synth.m as { samples: Float32Array }).samples.buffer]);
  });

  it('reports what cannot be packed and errors from synthesis', async () => {
    const posted: FromDecoder[] = [];
    const mod = fakeModule({
      pack_message: () => '{"ok":false,"text":"X","i3n3":"","error":"the message is empty"}',
      synthesize: () => {
        throw new Error('base tone 5000 Hz is outside 100 to 3000 Hz');
      },
    });
    const core = new DecoderCore(async () => mod, (m) => posted.push(m), () => 0);
    await core.handle({ type: 'pack', id: 1, text: 'X', mode: 'FT8' });
    await core.handle({ type: 'synth', id: 2, text: 'X', mode: 'FT8', f0Hz: 5000, sampleRate: 48000 });
    expect(posted[1]).toEqual({ type: 'packed', id: 1, packed: { ok: false, text: 'X', i3n3: '', error: 'the message is empty' } });
    expect(posted[2]).toEqual({ type: 'error', id: 2, detail: 'Error: base tone 5000 Hz is outside 100 to 3000 Hz' });
  });
});

describe('DecoderCore for WSPR', () => {
  it('decodes a WSPR slot with its preset and reports the decodes and the time taken', async () => {
    const mod = fakeModule();
    const { core, posted } = setup(async () => mod);
    await core.handle({ type: 'decodeWspr', id: 4, preset: 'wspr', samples: new Float32Array(1_440_000) });
    expect(mod.decode_wspr).toHaveBeenCalledWith(expect.any(Float32Array), 'wspr');
    expect(posted[1]).toEqual({ type: 'decodedWspr', id: 4, decodes: [{ text: 'K1ABC FN42 37', freq_hz: 1500.2, dt_s: 0.3, drift_hz_per_s: 0.01, snr_db: -22 }], ms: 25 });
  });

  it('packs and synthesises WSPR text with the WSPR codec', async () => {
    const synth = vi.fn(() => new Float32Array(3));
    const { core, posted } = setup(async () => fakeModule({ synthesize_wspr: synth, pack_wspr: () => '{"ok":false,"text":"K1ABC FN42 31","message_type":0,"error":"power 31 dBm"}' }));
    await core.handle({ type: 'pack', id: 1, text: 'K1ABC FN42 31', mode: 'WSPR' });
    await core.handle({ type: 'synth', id: 2, text: 'K1ABC FN42 37', mode: 'WSPR', f0Hz: 1500, sampleRate: 48000 });
    expect(posted[1]).toEqual({ type: 'packed', id: 1, packed: { ok: false, text: 'K1ABC FN42 31', i3n3: '', error: 'power 31 dBm' } });
    expect(synth).toHaveBeenCalledWith('K1ABC FN42 37', 1500, 48000);
    expect(posted[2]).toMatchObject({ type: 'synthesized', id: 2 });
  });
});

describe('DecoderCore later stages', () => {
  const d = (text: string) => ({ text, freq_hz: 1000, dt_s: 0.1, snr_db: -20 });

  /** A session whose preset finds one decode and whose later stage takes `steps` steps, finding `late` on step 2. */
  function sessionModule(steps: number, late = d('CQ 9V1NE OJ11')) {
    const made: { plan: string; steps: number; freed: boolean }[] = [];
    class FakeSession {
      readonly s = { plan: '', steps: 0, freed: false };
      constructor(_samples: Float32Array, _mode: string, plan: string) {
        this.s.plan = plan;
        made.push(this.s);
      }
      next_stage() {
        return JSON.stringify([d('CQ K1ABC FN42')]);
      }
      step() {
        if (this.s.freed) throw new Error('null pointer passed to rust');
        this.s.steps++;
        const done = this.s.steps >= steps;
        return JSON.stringify({ decodes: this.s.steps === 2 ? [late] : [], stage: 1, stage_done: this.s.steps === 2 || done, done });
      }
      get done() {
        return this.s.steps >= steps;
      }
      free() {
        this.s.freed = true;
      }
    }
    return { mod: fakeModule({ DecoderSession: FakeSession }), made };
  }

  function deepSetup(mod: WasmModule, pause: () => Promise<void> = async () => undefined) {
    const posted: FromDecoder[] = [];
    let t = 1000;
    const core = new DecoderCore(async () => mod, (m) => posted.push(m), () => (t += 5), pause);
    return { core, posted };
  }

  const deepSlot = (id: number, budgetMs = 2000) => ({ ...slot(id), deep: { plan: 'subtract-3-osd2 spectrogram.time_osr=4', budgetMs } });

  it('posts the preset decodes first, then what the later stages add', async () => {
    const { mod, made } = sessionModule(4);
    const { core, posted } = deepSetup(mod);
    await core.handle(deepSlot(5));
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ type: 'decodedMore', done: true }));
    expect(made[0].plan).toBe('baseline; subtract-3-osd2 spectrogram.time_osr=4');
    expect(posted.slice(1).map((m) => [m.type, 'decodes' in m ? m.decodes.map((x) => x.text) : null])).toEqual([
      ['decoded', ['CQ K1ABC FN42']],
      ['decodedMore', ['CQ 9V1NE OJ11']],
      ['decodedMore', []],
    ]);
    expect(made[0]).toMatchObject({ steps: 4, freed: true });
    expect(mod.decode_slot).not.toHaveBeenCalled();
  });

  it('stops the later stages when the budget has passed', async () => {
    const { mod, made } = sessionModule(1_000_000);
    const { core, posted } = deepSetup(mod);
    await core.handle(deepSlot(6, 300));
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ type: 'decodedMore', id: 6, done: true }));
    const last = posted.at(-1) as { ms: number };
    // The clock advances 5 ms per reading: the budget ends the work within one step of 300 ms.
    expect(last.ms).toBeGreaterThanOrEqual(300);
    expect(last.ms).toBeLessThan(330);
    expect(made[0].freed).toBe(true);
  });

  it('answers encoder requests between slices and ends the later stages when the next slot arrives', async () => {
    const { mod, made } = sessionModule(1_000_000);
    let release!: () => void;
    const { core, posted } = deepSetup(mod, () => new Promise<void>((r) => (release = r)));
    await core.handle(deepSlot(7, 60_000));
    // The first slice ran and the work waits for the message loop.
    expect(made[0].steps).toBeGreaterThan(0);
    await core.handle({ type: 'pack', id: 8, text: 'CQ 9V1NE OJ11', mode: 'FT8' });
    expect(posted.at(-1)).toMatchObject({ type: 'packed', id: 8 });
    await core.handle(slot(9));
    // The session was freed before the next slot was decoded, and its last message says done.
    expect(made[0].freed).toBe(true);
    expect(posted.slice(-2).map((m) => m.type + ('id' in m ? m.id : ''))).toEqual(['decodedMore7', 'decoded9']);
    release();
    await Promise.resolve();
    expect(posted.filter((m) => m.type === 'decodedMore')).toHaveLength(2);
  });

  it('decodes FT8 without later stages when the module has no sessions', async () => {
    const mod = fakeModule();
    const { core, posted } = deepSetup(mod);
    await core.handle(deepSlot(10));
    expect(mod.decode_slot).toHaveBeenCalledOnce();
    expect(posted.slice(1).map((m) => m.type)).toEqual(['decoded']);
  });
});
