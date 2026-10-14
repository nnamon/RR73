import { describe, expect, it } from 'vitest';
import { TxPump } from './pump';
import type { ModemTx } from './modem';
import type { ToStream } from './protocol';

/** A transmitter of `total` samples once finished, idling forever before. */
function fakeTx(total: number): ModemTx & { rendered: number } {
  let finished = false;
  const tx = {
    rendered: 0,
    queuedS: 0,
    get done() {
      return finished && tx.rendered >= total;
    },
    pushText: (t: string) => (t.includes('@') ? 1 : 0),
    render(n: number) {
      const k = finished ? Math.max(0, Math.min(n, total - tx.rendered)) : n;
      tx.rendered += k;
      return new Float32Array(k).fill(0.5);
    },
    finish() {
      finished = true;
    },
    free() {},
  };
  return tx;
}

/** Records a message as the worklet gets it and empties the transferred array, as postMessage does. */
function detach(m: ToStream, transfer?: Transferable[]): ToStream {
  if (m.type !== 'block') return m;
  const copy = { type: 'block' as const, samples: m.samples.slice() };
  if (transfer?.length) structuredClone(transfer[0], { transfer: transfer as ArrayBuffer[] });
  return copy;
}

describe('the transmit pump', () => {
  it('keeps 0.3 s rendered ahead of the worklet in 0.1 s blocks', () => {
    const sent: ToStream[] = [];
    const p = new TxPump(fakeTx(1e9), 48000, (m, transfer) => sent.push(detach(m, transfer)), () => undefined);
    p.fill(0);
    expect(sent.map((m) => (m.type === 'block' ? m.samples.length : 'end'))).toEqual([4800, 4800, 4800]);
    p.fill(4800);
    expect(sent.length).toBe(4);
    p.fill(4800);
    expect(sent.length).toBe(4);
    p.fill(4 * 4800);
    expect(sent.length).toBe(7);
  });

  it('sends the last short block and an end marker once the transmitter ends', () => {
    const sent: ToStream[] = [];
    const reports: [number, boolean][] = [];
    const tx = fakeTx(12000);
    const p = new TxPump(tx, 48000, (m, transfer) => sent.push(detach(m, transfer)), (_q, skipped, done) => reports.push([skipped, done]));
    p.text('CQ @');
    p.finish();
    p.fill(0);
    expect(sent.map((m) => (m.type === 'block' ? m.samples.length : 'end'))).toEqual([4800, 4800, 2400, 'end']);
    expect(p.done).toBe(true);
    expect(reports).toEqual([
      [1, false],
      [0, true],
    ]);
    p.fill(1e6);
    expect(sent.length).toBe(4);
  });
});
