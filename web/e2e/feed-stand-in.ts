// A stand-in for PSK Reporter's MQTT feed (https://www.mqtt.pskreporter.info) on
// page.routeWebSocket: it answers CONNECT and SUBSCRIBE and publishes spots in the feed's format.
// No test reaches the real feed.
import type { Page, WebSocketRoute } from '@playwright/test';

export const FEED = 'wss://mqtt.pskreporter.info:1886';

/** An MQTT PUBLISH at QoS 0. */
export function publish(topic: string, payload: object): Buffer {
  const t = Buffer.from(topic);
  const p = Buffer.from(JSON.stringify(payload));
  const body = Buffer.concat([Buffer.from([t.length >> 8, t.length & 0xff]), t, p]);
  const len = body.length < 128 ? [body.length] : [(body.length % 128) | 0x80, body.length >> 7];
  return Buffer.concat([Buffer.from([0x30, ...len]), body]);
}

/** One spot of `tx` heard by `rc`, `agoS` before `nowS`, as the feed sends it. */
export function feedSpot(nowS: number, tx: string, rc: string, rl: string, rp: number | null, band: string, agoS: number) {
  return { sq: 1, f: band === '20m' ? 14_075_500 : 7_075_500, md: 'FT8', rp, t: nowS - agoS + 13, t_tx: nowS - agoS, sc: tx, sl: 'OJ11', rc, rl, sa: 381, ra: 339, b: band };
}

/** Routes the feed; returns the topics subscribed and the connection, once open. */
export async function routeFeed(page: Page, onSubscribed?: (ws: WebSocketRoute, topic: string) => void) {
  const state: { subscribed: string[]; ws: WebSocketRoute | null } = { subscribed: [], ws: null };
  await page.routeWebSocket(FEED, (ws) => {
    state.ws = ws;
    ws.onMessage((m) => {
      const b = typeof m === 'string' ? Buffer.from(m) : m;
      if (b[0] === 0x10) ws.send(Buffer.from([0x20, 2, 0, 0]));
      if (b[0] === 0x82) {
        const n = (b[4] << 8) | b[5];
        const topic = b.subarray(6, 6 + n).toString();
        state.subscribed.push(topic);
        ws.send(Buffer.from([0x90, 3, b[2], b[3], 0]));
        onSubscribed?.(ws, topic);
      }
    });
  });
  return state;
}
