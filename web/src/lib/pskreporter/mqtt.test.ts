import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCONNECT, PINGREQ, PacketReader, connectPacket, openFeed, subscribePacket } from './mqtt';
import { HEARD_KEEP_MS, addHeard, heardTopic, parseHeard } from './heard';

const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string) => [...new TextEncoder().encode(s)];

function publish(topic: string, payload: string): Uint8Array {
  const body = [topic.length >> 8, topic.length & 0xff, ...ascii(topic), ...ascii(payload)];
  return Uint8Array.from([0x30, ...(body.length < 128 ? [body.length] : [(body.length % 128) | 0x80, Math.floor(body.length / 128)]), ...body]);
}

describe('MQTT packets', () => {
  it('connect with a clean session, keep-alive 60 s and no credentials', () => {
    expect([...connectPacket('rr73-ab')]).toEqual([0x10, 19, 0, 4, ...ascii('MQTT'), 4, 0x02, 0, 60, 0, 7, ...ascii('rr73-ab')]);
  });

  it('subscribe at QoS 0, and ping and disconnect in two bytes', () => {
    expect([...subscribePacket(1, ['a/b'])]).toEqual([0x82, 8, 0, 1, 0, 3, ...ascii('a/b'), 0]);
    expect([...PINGREQ]).toEqual([0xc0, 0]);
    expect([...DISCONNECT]).toEqual([0xe0, 0]);
  });

  it('are read whole across WebSocket messages, several to a message or one split over two', () => {
    const r = new PacketReader();
    const long = publish('pskr/filter/v2/20m/FT8/9V1NE/K1ABC/OJ11/FN42/381/291', 'x'.repeat(200));
    const all = Uint8Array.from([0x20, 2, 0, 0, 0x90, 3, 0, 1, 0, ...long, 0xd0, 0]);
    expect(r.push(all.subarray(0, 12)).map((p) => p.type)).toEqual(['connack', 'suback']);
    expect(r.push(all.subarray(12, 100))).toEqual([]);
    const rest = r.push(all.subarray(100));
    expect(rest.map((p) => p.type)).toEqual(['publish', 'pingresp']);
    const p = rest[0] as { topic: string; payload: Uint8Array };
    expect(p.topic).toBe('pskr/filter/v2/20m/FT8/9V1NE/K1ABC/OJ11/FN42/381/291');
    expect(p.payload).toHaveLength(200);
  });
});

/** A WebSocket the test drives: what the client sends, and the broker's answers. */
class FakeSocket {
  static last: FakeSocket;
  readyState = 1;
  binaryType = 'blob';
  sent: number[][] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(b: Uint8Array) {
    this.sent.push([...b]);
  }
  close() {
    this.closed = true;
  }
  deliver(b: Uint8Array) {
    this.onmessage?.({ data: b.slice().buffer } as MessageEvent);
  }
}

describe('the feed connection', () => {
  afterEach(() => vi.useRealTimers());

  it('connects, subscribes, passes on messages, pings, and disconnects', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    let opened = 0;
    const stop = openFeed('wss://feed.test:1886', [heardTopic('9V1NE/P')], { message: (t) => got.push(t), open: () => opened++, closed: () => got.push('closed') }, (u) => new FakeSocket(u) as unknown as WebSocket);
    const ws = FakeSocket.last;
    ws.onopen?.();
    expect(ws.sent[0][0]).toBe(0x10);
    ws.deliver(bytes(0x20, 2, 0, 0));
    expect(ws.sent[1]).toEqual([...subscribePacket(1, ['pskr/filter/v2/+/+/9V1NE.P/#'])]);
    ws.deliver(bytes(0x90, 3, 0, 1, 0));
    expect(opened).toBe(1);
    ws.deliver(publish('pskr/filter/v2/20m/FT8/9V1NE.P/K1ABC/OJ11/FN42/381/291', '{}'));
    expect(got).toEqual(['pskr/filter/v2/20m/FT8/9V1NE.P/K1ABC/OJ11/FN42/381/291']);
    vi.advanceTimersByTime(50_000);
    expect(ws.sent.at(-1)).toEqual([0xc0, 0]);
    stop();
    expect(ws.sent.at(-1)).toEqual([0xe0, 0]);
    expect(ws.closed).toBe(true);
  });

  it('reports a refused connection or subscription', () => {
    let refused: boolean | null = null;
    openFeed('wss://feed.test:1886', ['t'], { message: () => undefined, open: () => undefined, closed: (r) => (refused = r) }, (u) => new FakeSocket(u) as unknown as WebSocket);
    FakeSocket.last.onopen?.();
    FakeSocket.last.deliver(bytes(0x20, 2, 0, 5));
    expect(refused).toBe(true);
  });
});

describe('who heard you', () => {
  // The payload as the feed's page documents it.
  const page = '{"sq":30142870791,"f":21074653,"md":"FT8","rp":-5,"t":1662407712,"t_tx":1662407700,"sc":"SP2EWQ","sl":"JO93fn42","rc":"CU3AT","rl":"HM68jp36","sa":269,"ra":149,"b":"15m"}';

  it('reads the feed’s spot, at the transmission’s start when the feed knows it', () => {
    expect(parseHeard(new TextEncoder().encode(page))).toEqual({ receiver: 'CU3AT', locator: 'HM68jp36', band: '15m', mode: 'FT8', snrDb: -5, frequencyHz: 21_074_653, atS: 1_662_407_700 });
    const noTx = JSON.parse(page) as Record<string, unknown>;
    delete noTx.t_tx;
    expect(parseHeard(new TextEncoder().encode(JSON.stringify(noTx)))?.atS).toBe(1_662_407_712);
    // Seen in the feed: a receiver that sends no SNR.
    expect(parseHeard(new TextEncoder().encode('{"f":18101437,"md":"FT8","rp":null,"t":1792004235,"t_tx":1792004235,"rc":"KX4AZ/T","rl":"EN74gc","b":"17m"}'))?.snrDb).toBeNull();
    expect(parseHeard(new TextEncoder().encode('{"rc":"K1ABC"}'))).toBeNull();
    expect(parseHeard(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('keeps one report per receiver and band for 30 min, newest first', () => {
    const now = 1_792_000_000_000;
    const h = (receiver: string, band: string, ago: number, snrDb = -10) => ({ receiver, locator: '', band, mode: 'FT8', snrDb, frequencyHz: 0, atS: (now - ago) / 1000 });
    let list = addHeard([], h('K1ABC', '20m', 60_000), now);
    list = addHeard(list, h('JA1XYZ', '20m', 30_000), now);
    list = addHeard(list, h('K1ABC', '20m', 0, -3), now);
    list = addHeard(list, h('K1ABC', '40m', 10_000), now);
    expect(list.map((x) => [x.receiver, x.band, x.snrDb])).toEqual([
      ['K1ABC', '20m', -3],
      ['K1ABC', '40m', -10],
      ['JA1XYZ', '20m', -10],
    ]);
    expect(addHeard(list, h('VK3QRP', '20m', HEARD_KEEP_MS), now)).toHaveLength(3);
    const later = now + HEARD_KEEP_MS + 1;
    expect(addHeard(list, { ...h('VK3QRP', '20m', 0), atS: later / 1000 }, later).map((x) => x.receiver)).toEqual(['VK3QRP']);
  });
});
