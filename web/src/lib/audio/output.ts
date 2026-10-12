/**
 * The only path from RR73 to the headphone contact, which keys the radio by VOX. In this
 * version only Tune plays: a 1500 Hz tone for 10 s. halt() stops output at once, from any state.
 *
 * Tone edges ramp over 5 ms so the transmitter does not splatter; Halt ramps over 3 ms and
 * stops the oscillator 1 ms later.
 */

export interface TuneOptions {
  /** Tone frequency, Hz. */
  hz: number;
  /** Duration, s. */
  seconds: number;
  /** Output level, 0 to 1. */
  level: number;
}

export type TuneEnd = 'finished' | 'halted';

export interface TuneHandle {
  /** performance.now() time the tone ends unless halted, ms. */
  endsAtMs: number;
  /** Resolves when the tone has stopped. */
  done: Promise<TuneEnd>;
}

export const TUNE: TuneOptions = { hz: 1500, seconds: 10, level: 0.5 };

const RAMP_S = 0.005;

export class TransmitOutput {
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private finish: ((end: TuneEnd) => void) | null = null;
  private listeners = new Set<(active: boolean) => void>();

  /** True while anything plays. */
  get active(): boolean {
    return this.osc !== null;
  }

  onChange(fn: (active: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Plays the Tune tone. Call from a tap, with a running context. */
  tune(ctx: AudioContext, o: TuneOptions = TUNE): TuneHandle {
    this.halt();
    const level = Math.max(0, Math.min(1, o.level));
    const t0 = ctx.currentTime + 0.02;
    const t1 = t0 + o.seconds;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = o.hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + RAMP_S);
    gain.gain.setValueAtTime(level, t1 - RAMP_S);
    gain.gain.linearRampToValueAtTime(0, t1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.001);
    this.osc = osc;
    this.gain = gain;
    const done = new Promise<TuneEnd>((resolve) => {
      this.finish = resolve;
    });
    osc.onended = () => {
      if (this.osc === osc) this.release('finished');
    };
    this.emit();
    return { endsAtMs: performance.now() + (t1 - ctx.currentTime) * 1000, done };
  }

  /** Stops all output at once. Safe to call at any time. */
  halt() {
    const osc = this.osc;
    const gain = this.gain;
    if (!osc || !gain) return;
    const ctx = osc.context;
    const now = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.003);
      osc.stop(now + 0.004);
    } catch {
      // The oscillator has already stopped.
    }
    // Disconnect once the ramp is through, so nothing can reach the output after Halt.
    setTimeout(() => {
      osc.disconnect();
      gain.disconnect();
    }, 50);
    this.release('halted');
  }

  private release(end: TuneEnd) {
    const f = this.finish;
    this.osc = null;
    this.gain = null;
    this.finish = null;
    f?.(end);
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l(this.active);
  }
}
