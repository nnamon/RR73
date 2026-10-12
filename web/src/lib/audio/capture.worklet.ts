// AudioWorklet: takes the microphone input at the context rate, picks the channel that carries
// signal, resamples to 12000 Hz and posts chunks stamped with the audio-clock time of their
// first sample. The node has no outputs, so nothing it receives can reach the headphone contact.

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

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new Resampler(sampleRate, DECODER_RATE);
  private readonly selector = new ChannelSelector(sampleRate);
  private readonly meter = new LevelMeter();
  /** Context frame of the first input sample. */
  private frameOrigin: number | null = null;
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
    if (this.frameOrigin === null) this.frameOrigin = currentFrame;
    const channel = this.selector.select(input);
    if (input.length !== this.channels || this.selector.index !== this.used) {
      this.channels = input.length;
      this.used = this.selector.index;
      this.post({ type: 'format', channels: this.channels, channelUsed: channelName(this.used, this.channels), sampleRate });
    }
    this.meter.add(channel);
    const out = this.resampler.process(channel);
    for (let i = 0; i < out.length; ) {
      const n = Math.min(out.length - i, CHUNK_SAMPLES - this.chunkLen);
      this.chunk.set(out.subarray(i, i + n), this.chunkLen);
      this.chunkLen += n;
      i += n;
      if (this.chunkLen === CHUNK_SAMPLES) this.flush();
    }
    return true;
  }

  private flush() {
    const samples = this.chunk;
    const index = this.chunkIndex;
    const contextTime = (this.frameOrigin! + this.resampler.inputPosition(index)) / sampleRate;
    const { peakDb, rmsDb } = this.meter.read();
    this.post({ type: 'chunk', samples, index, contextTime, peakDb, rmsDb }, [samples.buffer]);
    this.chunk = new Float32Array(CHUNK_SAMPLES);
    this.chunkLen = 0;
    this.chunkIndex += CHUNK_SAMPLES;
  }

  private post(m: CaptureMessage, transfer: Transferable[] = []) {
    this.port.postMessage(m, transfer);
  }
}

registerProcessor(CAPTURE_PROCESSOR, CaptureProcessor);
