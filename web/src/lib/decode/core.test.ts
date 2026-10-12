import { describe, expect, it, vi } from 'vitest';
import { DecoderCore, type WasmModule } from './core';
import type { FromDecoder } from './protocol';

function fakeModule(over: Partial<WasmModule> = {}): WasmModule {
  return {
    default: vi.fn(async () => undefined),
    decode_slot: vi.fn(() => '[{"text":"CQ 9M2TRX OJ02","freq_hz":1022,"dt_s":0.1,"snr_db":-10}]'),
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
