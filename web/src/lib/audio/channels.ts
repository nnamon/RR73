/**
 * Picks the input channel that carries the radio audio.
 *
 * With echo cancellation off, WebKit can deliver stereo with the signal in the left channel only
 * (reported on iOS 17.6). A plain down-mix would then lose 6 dB, and a silent right channel
 * picked by default would lose everything. The selector tracks the energy of each channel and
 * uses the strongest; it switches only when another channel is 10 dB stronger for 1 s, so
 * ordinary level changes never make it flap.
 */

export type ChannelUse = 'mono' | 'left' | 'right' | `channel ${number}`;

/** Energy averaging time constant, s. */
const TIME_CONSTANT_S = 0.5;
/** Margin another channel needs before a switch, as an energy ratio (10 dB). */
const SWITCH_RATIO = 10;
/** Time the margin must hold before a switch, s. */
const HOLD_S = 1;

export function channelName(index: number, count: number): ChannelUse {
  if (count <= 1) return 'mono';
  if (count === 2) return index === 0 ? 'left' : 'right';
  return `channel ${index + 1}`;
}

export class ChannelSelector {
  private energy: number[] = [];
  private current = 0;
  private challengerSince = 0;
  private elapsed = 0;
  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  /** Index of the channel in use. */
  get index(): number {
    return this.current;
  }

  /**
   * Updates the energies with one block (one array per channel, equal lengths) and returns the
   * channel to use for this block.
   */
  select(channels: Float32Array[]): Float32Array {
    const count = channels.length;
    if (count === 0) throw new RangeError('No input channels.');
    if (count === 1) {
      this.current = 0;
      return channels[0];
    }
    if (this.energy.length !== count) {
      this.energy = new Array<number>(count).fill(0);
      this.current = Math.min(this.current, count - 1);
      this.challengerSince = 0;
    }
    const n = channels[0].length;
    const a = 1 - Math.exp(-n / (this.sampleRate * TIME_CONSTANT_S));
    for (let c = 0; c < count; c++) {
      const x = channels[c];
      let s = 0;
      for (let i = 0; i < n; i++) s += x[i] * x[i];
      this.energy[c] += a * (s / Math.max(1, n) - this.energy[c]);
    }
    this.elapsed += n / this.sampleRate;
    let best = this.current;
    for (let c = 0; c < count; c++) if (this.energy[c] > this.energy[best]) best = c;
    const cur = this.energy[this.current];
    if (best !== this.current && this.energy[best] > SWITCH_RATIO * cur + 1e-20) {
      if (!this.challengerSince) this.challengerSince = this.elapsed;
      if (this.elapsed - this.challengerSince >= HOLD_S) {
        this.current = best;
        this.challengerSince = 0;
      }
    } else this.challengerSince = 0;
    return channels[this.current];
  }
}
