// A subscribe-only MQTT 3.1.1 client over WebSocket, for PSK Reporter's MQTT feed
// (https://www.mqtt.pskreporter.info, read 15 October 2026): wss://mqtt.pskreporter.info:1886,
// WebSocket subprotocol "mqtt". It connects with a clean session, subscribes at QoS 0, reads
// PUBLISH packets and pings every 50 s. Written from the MQTT 3.1.1 specification (OASIS).

/** Seconds the broker may wait without a packet before it drops the connection. */
const KEEP_ALIVE_S = 60;
/** Ping interval, ms: inside the keep-alive. */
const PING_MS = 50_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}

function packet(type: number, body: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([type, ...varint(body.length), ...body]);
}

/** CONNECT with a clean session and no credentials. */
export function connectPacket(clientId: string): Uint8Array<ArrayBuffer> {
  return packet(0x10, [...str('MQTT'), 4, 0x02, KEEP_ALIVE_S >> 8, KEEP_ALIVE_S & 0xff, ...str(clientId)]);
}

/** SUBSCRIBE to `topics` at QoS 0. */
export function subscribePacket(id: number, topics: readonly string[]): Uint8Array<ArrayBuffer> {
  return packet(0x82, [id >> 8, id & 0xff, ...topics.flatMap((t) => [...str(t), 0])]);
}

export const PINGREQ: Uint8Array<ArrayBuffer> = Uint8Array.from([0xc0, 0]);
export const DISCONNECT: Uint8Array<ArrayBuffer> = Uint8Array.from([0xe0, 0]);

/** One packet read from the stream. */
export type Packet = { type: 'connack'; code: number } | { type: 'suback'; granted: number[] } | { type: 'publish'; topic: string; payload: Uint8Array } | { type: 'pingresp' } | { type: 'other'; first: number };

/**
 * Splits the bytes the broker sends into packets. WebSocket messages may hold several packets
 * or part of one, so what is left over waits for the next message.
 */
export class PacketReader {
  private buf = new Uint8Array(0);

  push(data: Uint8Array): Packet[] {
    const joined = new Uint8Array(this.buf.length + data.length);
    joined.set(this.buf);
    joined.set(data, this.buf.length);
    this.buf = joined;
    const out: Packet[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let len = 0;
      let mul = 1;
      let i = 1;
      for (;;) {
        if (i >= this.buf.length || i > 4) return out;
        const b = this.buf[i++];
        len += (b & 0x7f) * mul;
        mul *= 128;
        if (!(b & 0x80)) break;
      }
      if (this.buf.length < i + len) break;
      out.push(read(this.buf[0], this.buf.subarray(i, i + len)));
      this.buf = this.buf.slice(i + len);
    }
    return out;
  }
}

function read(first: number, body: Uint8Array): Packet {
  switch (first >> 4) {
    case 2:
      return { type: 'connack', code: body[1] ?? 255 };
    case 9:
      return { type: 'suback', granted: [...body.subarray(2)] };
    case 3: {
      const n = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + n));
      // QoS above 0 adds a packet id; the feed sends QoS 0.
      const at = 2 + n + ((first >> 1) & 3 ? 2 : 0);
      return { type: 'publish', topic, payload: body.subarray(at) };
    }
    case 13:
      return { type: 'pingresp' };
    default:
      return { type: 'other', first };
  }
}

export interface FeedEvents {
  message(topic: string, payload: Uint8Array): void;
  /** Connected and subscribed. */
  open(): void;
  /** The connection closed or failed; `refused` when the broker turned it away. */
  closed(refused: boolean): void;
}

/** One connection: connect, subscribe, read, ping. Reconnecting is the caller's. */
export function openFeed(url: string, topics: readonly string[], events: FeedEvents, socket: (url: string) => WebSocket = (u) => new WebSocket(u, 'mqtt')): () => void {
  const ws = socket(url);
  ws.binaryType = 'arraybuffer';
  const reader = new PacketReader();
  let ping: ReturnType<typeof setInterval> | null = null;
  let done = false;
  const finish = (refused: boolean) => {
    if (done) return;
    done = true;
    if (ping) clearInterval(ping);
    ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // Already closed.
    }
    events.closed(refused);
  };
  ws.onopen = () => ws.send(connectPacket(`rr73-${Math.random().toString(36).slice(2, 10)}`));
  ws.onmessage = (e: MessageEvent) => {
    if (!(e.data instanceof ArrayBuffer)) return;
    for (const p of reader.push(new Uint8Array(e.data))) {
      if (p.type === 'connack') {
        if (p.code !== 0) return finish(true);
        ws.send(subscribePacket(1, topics));
        ping = setInterval(() => ws.send(PINGREQ), PING_MS);
      } else if (p.type === 'suback') {
        if (p.granted.some((g) => g === 0x80)) return finish(true);
        events.open();
      } else if (p.type === 'publish') {
        events.message(p.topic, p.payload);
      }
    }
  };
  ws.onclose = () => finish(false);
  ws.onerror = () => finish(false);
  return () => {
    if (done) return;
    if (ws.readyState === WebSocket.OPEN) ws.send(DISCONNECT);
    done = true;
    if (ping) clearInterval(ping);
    ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
  };
}
