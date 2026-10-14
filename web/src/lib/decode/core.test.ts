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
