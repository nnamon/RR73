/**
 * Keeps the stream worklet fed: renders the transmitter in blocks until AHEAD_S of audio waits
 * ahead of the audio thread, each time the worklet reports how far it has played. When the
 * transmitter ends, the last short block goes with an end marker.
 */

import type { ModemTx } from './modem';
import { AHEAD_S, BLOCK_S, type ToStream } from './protocol';

export class TxPump {
  private sentFrames = 0;
  private takenFrames = 0;
  private ended = false;
  private skipped = 0;

  constructor(
    private readonly tx: ModemTx,
    private readonly rate: number,
    private readonly send: (m: ToStream, transfer?: Transferable[]) => void,
    private readonly report: (queuedS: number, skipped: number, done: boolean) => void,
  ) {}

  get done(): boolean {
    return this.ended;
  }

  /** Queues text; characters the mode cannot send are counted for the next report. */
  text(t: string) {
    if (this.ended) return;
    this.skipped += this.tx.pushText(t);
    this.report(this.tx.queuedS, this.takeSkipped(), false);
  }

  finish() {
    if (!this.ended) this.tx.finish();
  }

  /** The worklet has taken `takenFrames` frames so far: render until AHEAD_S waits again. */
  fill(takenFrames = this.takenFrames) {
    this.takenFrames = Math.max(this.takenFrames, takenFrames);
    if (this.ended) return;
    const block = Math.round(BLOCK_S * this.rate);
    const target = Math.round(AHEAD_S * this.rate);
    let rendered = false;
    while (!this.ended && this.sentFrames - this.takenFrames < target) {
      const samples = this.tx.render(block);
      // Read before the transfer, which empties the array.
      const n = samples.length;
      rendered = true;
      if (n) {
        this.sentFrames += n;
        this.send({ type: 'block', samples }, [samples.buffer]);
      }
      if (n < block || this.tx.done) {
        this.ended = true;
        this.send({ type: 'end' });
      }
    }
    if (rendered) this.report(this.tx.queuedS, this.takeSkipped(), this.ended);
  }

  private takeSkipped(): number {
    const n = this.skipped;
    this.skipped = 0;
    return n;
  }
}
