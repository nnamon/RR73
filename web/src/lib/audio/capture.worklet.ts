// AudioWorklet: takes the microphone input at the context rate, picks the channel that carries
// signal, resamples to 12000 Hz and posts chunks stamped with the audio-clock time of their
// first sample. The node has no outputs, so nothing it receives can reach the headphone contact.
//
// Stamps follow currentFrame, the context frame of each block. A browser may skip process() for
// some render quanta (silent input, no input connected) while the context clock runs on. Counting
// samples alone would then stamp every later chunk early by the time skipped, so each block's
// frame is checked: a gap up to 0.1 s is filled with silence, and after a longer gap the stream
// starts over at the new frame with a break in the chunk index.

import { ChannelSelector, channelName } from './channels';
import { LevelMeter } from './level';
import { CAPTURE_PROCESSOR, CHUNK_SAMPLES, type CaptureMessage } from './messages';
import { DECODER_RATE, Resampler } from './resampler';

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** Longest gap filled with silence, s. Longer gaps restart the stream. */
const MAX_FILL_S = 0.1;

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new Resampler(sampleRate, DECODER_RATE);
  private readonly selector = new ChannelSelector(sampleRate);
  private readonly meter = new LevelMeter();
  private readonly silence = new Float32Array(128);
  /** Context frame of the first input sample of the current stream. */
  private frameOrigin: number | null = null;
  /** 12 kHz index at frameOrigin. */
  private indexOrigin = 0;
  /** Context frame the next input sample belongs to. */
  private nextFrame = 0;
  private chunk = new Float32Array(CHUNK_SAMPLES);
  private chunkLen = 0;
  /** 12 kHz index of chunk[0]. */
  private chunkIndex = 0;
  private channels = 0;
  private used = -1;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    // No source connected: nothing to capture, but stay alive for the next connection.
    if (!input || input.length === 0 || input[0].length === 0) return true;
    const frame = currentFrame;
    if (this.frameOrigin === null) {
      this.frameOrigin = frame;
      this.nextFrame = frame;
    } else if (frame !== this.nextFrame) this.bridge(frame);
    const channel = this.selector.select(input);
    if (input.length !== this.channels || this.selector.index !== this.used) {
      this.channels = input.length;
      this.used = this.selector.index;
      this.post({ type: 'format', channels: this.channels, channelUsed: channelName(this.used, this.channels), sampleRate });
    }
    this.meter.add(channel);
    this.append(this.resampler.process(channel));
    this.nextFrame = frame + channel.length;
    return true;
  }

  /** Bridges frames this processor never saw, from nextFrame to `frame`. */
  private bridge(frame: number) {
    const gap = frame - this.nextFrame;
    if (gap > 0 && gap <= MAX_FILL_S * sampleRate) {
      for (let left = gap; left > 0; left -= this.silence.length) {
        this.append(this.resampler.process(left >= this.silence.length ? this.silence : this.silence.subarray(0, left)));
      }
      return;
    }
    // A long gap, or a frame that went backwards: post what is buffered and start a new stream
    // here. The index skips ahead by the gap, so receivers see the break.
    if (this.chunkLen > 0) this.flush();
    this.resampler.reset();
    this.chunkIndex += Math.max(1, Math.round((gap * DECODER_RATE) / sampleRate));
    this.indexOrigin = this.chunkIndex;
    this.frameOrigin = frame;
  }

  private append(out: Float32Array) {
    for (let i = 0; i < out.length; ) {
      const n = Math.min(out.length - i, CHUNK_SAMPLES - this.chunkLen);
      this.chunk.set(out.subarray(i, i + n), this.chunkLen);
      this.chunkLen += n;
      i += n;
      if (this.chunkLen === CHUNK_SAMPLES) this.flush();
    }
  }

  /** Posts the chunk; a partial one (before a restart) goes out at its length. */
  private flush() {
    const samples = this.chunkLen === CHUNK_SAMPLES ? this.chunk : this.chunk.slice(0, this.chunkLen);
    const index = this.chunkIndex;
    const contextTime = (this.frameOrigin! + this.resampler.inputPosition(index - this.indexOrigin)) / sampleRate;
    const { peakDb, rmsDb } = this.meter.read();
    this.post({ type: 'chunk', samples, index, contextTime, peakDb, rmsDb }, [samples.buffer]);
    this.chunkIndex += this.chunkLen;
    this.chunk = new Float32Array(CHUNK_SAMPLES);
    this.chunkLen = 0;
  }

  private post(m: CaptureMessage, transfer: Transferable[] = []) {
    this.port.postMessage(m, transfer);
  }
}

registerProcessor(CAPTURE_PROCESSOR, CaptureProcessor);
