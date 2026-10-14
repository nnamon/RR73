import { describe, expect, it } from 'vitest';
import { PLAYOUT_S, WebSdrInput, type WebSdrStatus } from './sdr-input';
import type { FetchFn } from './qsp';

/** An audio context that records each buffer's start time and offset. */
function fakeContext() {
  const starts: { when: number; offset: number; stopped: boolean }[] = [];
  const ctx = {
    state: 'running',
    currentTime: 100,
    sampleRate: 48000,
    createGain: () => ({ connect: () => undefined, disconnect: () => undefined }),
    createBuffer: (_ch: number, length: number) => ({ length, copyToChannel: () => undefined }),
    createBufferSource() {
      const rec = { when: NaN, offset: NaN, stopped: false };
      return {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect: () => undefined,
        disconnect: () => undefined,
        start(when: number, offset: number) {
          rec.when = when;
          rec.offset = offset;
          starts.push(rec);
        },
        stop() {
          rec.stopped = true;
        },
      };
    },
  };
  return { ctx: ctx as unknown as AudioContext & { currentTime: number }, starts };
}

/** A WebSocket the test drives. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  binaryType = 'blob';
  closed = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  close() {
    this.closed = true;
  }
  send(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

/** A PCM frame of `n` zero samples at `utcMs`. */
function frame(seq: number, utcMs: number, n = 512, flags = 0): ArrayBuffer {
  const b = new ArrayBuffer(20 + 2 * n);
  const v = new DataView(b);
  v.setUint8(0, 1);
  v.setUint8(1, 0);
  v.setUint16(2, flags);
  v.setUint32(4, seq);
  v.setBigInt64(8, BigInt(Math.round(utcMs * 1000)));
  v.setUint32(16, n);
  return b;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const T = Date.UTC(2026, 9, 15, 1, 0, 0);

function setup(post?: () => Response) {
  const { ctx, starts } = fakeContext();
  let now = T;
  const calls: string[] = [];
  const statuses: WebSdrStatus[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push(`${init?.method} ${url}`);
    if (init?.method === 'POST') {
      if (post) return post();
      return new Response(JSON.stringify({ id: 's1', receiver: 'r', dialHz: 14074000, encoding: 'ima-adpcm', state: 'waiting', stream: '/v1/sdr/sessions/s1/stream?ticket=t' }), { status: 201 });
    }
    return new Response(null, { status: 204 });
  };
  const input = new WebSdrInput(
    {
      base: () => 'https://relay.test/qsp',
      key: () => '',
      receiver: () => 'r',
      receiverName: () => 'Stand-in',
      dialHz: () => 14074000,
      listener: () => '9V1NE',
      status: (s) => statuses.push(s),
    },
    () => now,
    (url) => new FakeSocket(url) as unknown as WebSocket,
    fetchFn,
  );
  let ended = 0;
  return { ctx, starts, input, calls, statuses, setNow: (ms: number) => (now = ms), ended: () => ended, events: { ended: () => ended++, muted: () => undefined } };
}

describe('the web SDR input', () => {
  it('takes the playout delay back off capture’s timestamps', () => {
    expect(setup().input.offsetS).toBe(-PLAYOUT_S);
  });

  it('opens a session, streams, and plays each frame its playout delay after its time, frames joined sample for sample', async () => {
    const s = setup();
    const opened = await s.input.open(s.ctx, null, s.events);
    await settle();
    expect(s.calls).toEqual(['POST https://relay.test/qsp/v1/sdr/sessions']);
    const ws = FakeSocket.last!;
    expect(ws.url).toBe('wss://relay.test/qsp/v1/sdr/sessions/s1/stream?ticket=t');
    ws.send(JSON.stringify({ type: 'status', state: 'streaming' }));
    expect(s.statuses.map((x) => x.state)).toEqual(['connecting', 'streaming']);
    // A frame stamped 0.4 s ago arrives now: it plays 1.1 s from now.
    ws.send(frame(0, T - 400));
    expect(s.starts[0].when).toBeCloseTo(100 + 1.1, 6);
    // 47.7 ms later on the audio clock and 12 ms more on the UTC clock: the next frame still
    // joins the first sample for sample.
    s.ctx.currentTime = 100.0477;
    s.setNow(T + 47.7 + 12);
    ws.send(frame(1, T - 400 + (512 / 12000) * 1000));
    expect(s.starts[1].when).toBeCloseTo(s.starts[0].when + 512 / 12000, 6);
    // Once the clocks part by more than 20 ms, the mapping follows them.
    s.ctx.currentTime = 100.09;
    s.setNow(T + 90 + 25);
    ws.send(frame(2, T - 400 + 2 * (512 / 12000) * 1000));
    expect(s.starts[2].when).toBeCloseTo(100.09 + (1100 + 2 * (512 / 12) - 115) / 1000, 6);
    opened.close();
    await settle();
    expect(s.calls[1]).toBe('DELETE https://relay.test/qsp/v1/sdr/sessions/s1');
    expect(ws.closed).toBe(true);
  });

  it('drops a frame that arrives after its playout time, and maps again after a gap', async () => {
    const s = setup();
    await s.input.open(s.ctx, null, s.events);
    await settle();
    const ws = FakeSocket.last!;
    ws.send(frame(0, T - 400));
    // 2 s old: past its playout time and its length.
    ws.send(frame(1, T - 2000));
    expect(s.starts).toHaveLength(1);
    // After a gap the mapping follows the clocks again.
    s.setNow(T + 10_000);
    s.ctx.currentTime = 110.5;
    ws.send(frame(2, T + 10_000 - 300, 512, 2));
    expect(s.starts[1].when).toBeCloseTo(110.5 + 1.2, 6);
  });

  it('ends the input when the relay refuses or the session ends, and says why', async () => {
    const s = setup();
    await s.input.open(s.ctx, null, s.events);
    await settle();
    FakeSocket.last!.send(JSON.stringify({ type: 'status', state: 'ended', reason: 'busy', message: 'The receiver has no free channel.' }));
    expect(s.ended()).toBe(1);
    expect(s.statuses.at(-1)).toEqual({ state: 'ended', reason: 'busy', message: 'The receiver has no free channel.' });
    // A close after that does not end it twice.
    FakeSocket.last!.onclose?.();
    expect(s.ended()).toBe(1);
  });

  it('says the relay refused a session it will not start, apart from a busy receiver and a gateway failure', async () => {
    const ended = async (status: number, body: unknown) => {
      const s = setup(() => new Response(JSON.stringify(body), { status }));
      await s.input.open(s.ctx, null, s.events);
      await settle();
      return s.statuses.at(-1);
    };
    const gone = 'This relay has no receiver r.';
    expect(await ended(404, { error: { code: 'not-found', message: gone } })).toEqual({ state: 'ended', reason: 'relay-refused', message: gone });
    expect(await ended(401, { error: { code: 'unauthorised', message: 'x' } })).toMatchObject({ reason: 'relay-refused' });
    expect(await ended(429, { error: { code: 'rate-limited', message: 'Too many requests. Try again in a minute.' } })).toMatchObject({ reason: 'relay-refused' });
    expect(await ended(409, { error: { code: 'receiver-busy', message: 'All of this relay’s sessions on r are in use. Try again later.' } })).toMatchObject({ reason: 'busy' });
    expect(await ended(502, null)).toMatchObject({ reason: 'relay' });
  });
});
