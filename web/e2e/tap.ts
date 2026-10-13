// Records what the app plays through the output, in the page: every node connected to the
// destination is also connected to a recording worklet. Each transmission (sound followed by
// 0.5 s of silence) is kept with the UTC times its first and last samples are heard, each from
// AudioContext.getOutputTimestamp() read as it happens, because the audio clock can drift
// against UTC. Decoded in Node with the app's own wasm decoder.
import type { Page } from '@playwright/test';
import { Resampler } from '../src/lib/audio/resampler';
import type { Wasm } from './wasm';
import { PRESET } from '../src/lib/decode/worker-client';

declare global {
  interface Window {
    __tx: { startUtc: number; endUtc: number; frames: number; sampleRate: number; samples: Float32Array }[];
    __b64: (x: Float32Array) => string;
  }
}

const PROCESSOR = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.rec = null; this.quiet = 0; this.last = 0; }
  process(inputs) {
    // With nothing connected the input has no channels: that is silence too.
    const x = (inputs[0] && inputs[0][0]) || new Float32Array(128);
    let loud = -1;
    for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 1e-4) { loud = i; break; }
    if (loud >= 0) {
      if (!this.rec) {
        let k = 0;
        while (Math.abs(x[k]) <= 1e-4) k++;
        this.rec = { start: currentFrame + k, parts: [x.slice(k)] };
        // Timestamped now, with the clock mapping of this moment.
        this.port.postMessage({ onset: currentFrame + k, rate: sampleRate });
      } else this.rec.parts.push(x.slice());
      this.last = currentFrame + loud;
      this.quiet = 0;
    } else if (this.rec) {
      this.rec.parts.push(x.slice());
      if (++this.quiet * 128 > sampleRate * 0.5) {
        const n = this.rec.parts.reduce((a, p) => a + p.length, 0);
        const out = new Float32Array(n);
        let at = 0;
        for (const p of this.rec.parts) { out.set(p, at); at += p.length; }
        this.port.postMessage({ start: this.rec.start, end: this.last, rate: sampleRate, samples: out }, [out.buffer]);
        this.rec = null;
        this.quiet = 0;
      }
    }
    return true;
  }
}
registerProcessor('rr73-test-tap', Tap);`;

export async function installTap(page: Page) {
  await page.addInitScript((source) => {
    window.__tx = [];
    window.__b64 = (x: Float32Array) => {
      const bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const taps = new WeakMap<BaseAudioContext, Promise<AudioWorkletNode>>();
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(o?: AudioContextOptions) {
        super(o);
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        taps.set(
          this,
          this.audioWorklet.addModule(url).then(() => {
            const node = new AudioWorkletNode(this, 'rr73-test-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
            let onsetUtc = 0;
            node.port.onmessage = (e: MessageEvent<{ onset?: number; start: number; end: number; rate: number; samples: Float32Array }>) => {
              const ts = this.getOutputTimestamp();
              const base = Date.now() - performance.now() + (ts.performanceTime ?? 0) - (ts.contextTime ?? 0) * 1000;
              if (e.data.onset !== undefined) {
                onsetUtc = base + (e.data.onset / e.data.rate) * 1000;
                return;
              }
              const { start, end, rate, samples } = e.data;
              window.__tx.push({ startUtc: onsetUtc, endUtc: base + (end / rate) * 1000, frames: end - start + 1, sampleRate: rate, samples });
            };
            return node;
          }),
        );
      }
    };
    const connect = AudioNode.prototype.connect as (this: AudioNode, d: AudioNode, ...r: number[]) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, dest: AudioNode | AudioParam, ...rest: number[]) {
      const r = connect.call(this, dest as AudioNode, ...rest);
      const tap = taps.get(this.context);
      if (dest instanceof AudioDestinationNode && tap) void tap.then((node) => connect.call(this, node));
      return r;
    } as typeof AudioNode.prototype.connect;
  }, PROCESSOR);
}

export interface Captured {
  /** When the first sample is heard, UTC ms (mapped at that moment). */
  startUtc: number;
  /** When the last sample is heard, UTC ms (mapped at that moment). */
  endUtc: number;
  /** Frames from the first to the last sound: the length on the audio clock. */
  frames: number;
  sampleRate: number;
  samples: Float32Array;
}

/** Transmissions recorded so far. */
export async function captured(page: Page): Promise<Captured[]> {
  const raw = await page.evaluate(() => window.__tx.map((t) => ({ startUtc: t.startUtc, endUtc: t.endUtc, frames: t.frames, sampleRate: t.sampleRate, b64: window.__b64(t.samples) })));
  return raw.map((t) => {
    const bytes = Buffer.from(t.b64, 'base64');
    return { startUtc: t.startUtc, endUtc: t.endUtc, frames: t.frames, sampleRate: t.sampleRate, samples: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4) };
  });
}

export const SLOT_MS = 15000;

/**
 * Start of the FT8 slot a transmission belongs to, UTC ms: the slot whose start + 0.5 s is
 * nearest. A start a fraction of a millisecond early still belongs to its own slot.
 */
export function slotOf(t: Captured): number {
  return Math.round((t.startUtc - 500) / SLOT_MS) * SLOT_MS;
}

/** Decodes a captured transmission with the app's decoder, placed in its slot at its real offset. */
export function decodeCaptured(wasm: Wasm, t: Captured): { text: string; dt_s: number; freq_hz: number }[] {
  const r = new Resampler(t.sampleRate, 12000);
  const at12 = r.process(t.samples);
  const slot = new Float32Array(180000);
  const offset = Math.min(179_999, Math.max(0, Math.round(((t.startUtc - slotOf(t)) / 1000) * 12000)));
  slot.set(at12.subarray(0, 180000 - offset), offset);
  return JSON.parse(wasm.decode_slot(slot, 'FT8', PRESET)) as { text: string; dt_s: number; freq_hz: number }[];
}
