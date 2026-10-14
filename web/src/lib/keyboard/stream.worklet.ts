// AudioWorklet: plays a keyboard mode's transmission as the keyboard worker renders it. Blocks
// arrive from the worker on a linked MessagePort; the processor plays them back to back and
// tells the worker how far it has played, so the worker keeps 0.3 s rendered ahead. Silence
// played between blocks after the first is an underrun, a gap in the keying, and is counted.
// After the end marker the last block plays out, the app hears "drained", and the node stops.
//
// The review build can record what the node outputs (the "record" message), so a test can
// decode the audio exactly as it left the node.

import { STREAM_PROCESSOR, type FromStreamNode, type StreamNeed, type ToStream, type ToStreamNode } from './protocol';

declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** How often the worklet reports its counts to the app while it plays, in render quanta (about 0.5 s at 48 kHz). */
const STATS_EVERY = 188;

class StreamProcessor extends AudioWorkletProcessor {
  private blocks: Float32Array[] = [];
  private offset = 0;
  private taken = 0;
  private link: MessagePort | null = null;
  private started = false;
  private ended = false;
  private stopped = false;
  private underrun = 0;
  private played = 0;
  private quanta = 0;
  private recording: Float32Array[] | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToStreamNode>) => {
      const m = e.data;
      if (m.type === 'link') {
        this.link = m.port;
        this.link.onmessage = (ev: MessageEvent<ToStream>) => this.take(ev.data);
      } else if (m.type === 'stop') {
        this.stopped = true;
        this.blocks = [];
      } else if (m.type === 'record') this.recording = m.on ? [] : null;
    };
  }

  private take(m: ToStream) {
    if (this.stopped) return;
    if (m.type === 'block') this.blocks.push(m.samples);
    else this.ended = true;
  }

  private buffered(): number {
    let n = -this.offset;
    for (const b of this.blocks) n += b.length;
    return n;
  }

  private send(m: FromStreamNode, transfer: Transferable[] = []) {
    this.port.postMessage(m, transfer);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return !this.stopped;
    let i = 0;
    let finishedBlock = false;
    while (i < out.length && this.blocks.length) {
      const b = this.blocks[0];
      const n = Math.min(out.length - i, b.length - this.offset);
      out.set(b.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= b.length) {
        this.blocks.shift();
        this.offset = 0;
        finishedBlock = true;
      }
    }
    if (i < out.length) out.fill(0, i);
    if (i > 0 && !this.started) {
      this.started = true;
      this.send({ type: 'started' });
    }
    if (this.started) {
      this.played += i;
      if (i < out.length && !this.ended && !this.stopped) this.underrun += out.length - i;
    }
    this.taken += i;
    if (this.recording && this.started) this.recording.push(out.slice());
    if (finishedBlock) this.link?.postMessage({ type: 'need', takenFrames: this.taken } satisfies StreamNeed);
    if (++this.quanta % STATS_EVERY === 0) this.send({ type: 'stats', underrunFrames: this.underrun, playedFrames: this.played, bufferedFrames: this.buffered() });
    if ((this.ended && !this.blocks.length) || this.stopped) {
      if (this.recording) {
        const total = this.recording.reduce((a, b) => a + b.length, 0);
        const all = new Float32Array(total);
        let o = 0;
        for (const r of this.recording) {
          all.set(r, o);
          o += r.length;
        }
        this.send({ type: 'recording', samples: all }, [all.buffer]);
        this.recording = null;
      }
      this.send({ type: 'drained', underrunFrames: this.underrun, playedFrames: this.played });
      this.link?.close();
      this.link = null;
      return false;
    }
    return true;
  }
}

registerProcessor(STREAM_PROCESSOR, StreamProcessor);
