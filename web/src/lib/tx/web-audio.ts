/**
 * TxAudio on a real AudioContext: a buffer source through a gain to the destination. Halt
 * ramps the gain to 0 over one render quantum (128 frames, 2.7 ms at 48 kHz) and stops the
 * source at the end of it.
 */

import type { AudioClockMapper } from '../clock/mapping';
import type { Playing, TxAudio } from './scheduler';

const QUANTUM = 128;

export function webAudioOut(ctx: AudioContext, mapper: AudioClockMapper): TxAudio {
  return {
    get sampleRate() {
      return ctx.sampleRate;
    },
    get currentTime() {
      return ctx.currentTime;
    },
    get outputLatency() {
      return (ctx as { outputLatency?: number }).outputLatency;
    },
    get baseLatency() {
      return ctx.baseLatency;
    },
    toContextTime(utcMs) {
      const base = mapper.baseMs;
      return base === null ? null : (utcMs - base) / 1000;
    },
    toUtcMs(t) {
      const base = mapper.baseMs;
      return base === null ? null : t * 1000 + base;
    },
    play(samples, when, level): Playing {
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, level));
      src.connect(gain).connect(ctx.destination);
      src.start(when);
      const playing: Playing = {
        onended: null,
        stop() {
          const now = ctx.currentTime;
          const end = now + QUANTUM / ctx.sampleRate;
          try {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, end);
            src.stop(end);
          } catch {
            // Already stopped.
          }
          setTimeout(() => {
            src.disconnect();
            gain.disconnect();
          }, 50);
        },
      };
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        playing.onended?.();
      };
      return playing;
    },
  };
}
