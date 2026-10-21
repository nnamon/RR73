/**
 * Who heard you: PSK Reporter's live reports of the operator's callsign, straight from its MQTT
 * feed (lib/pskreporter/mqtt.ts, docs/design/qsp.md). No relay is involved. Off by default, kept
 * in IndexedDB under "heardyou". The feed is open while the switch is on, a callsign is set and
 * the practice band is off; it reconnects after 5 s, doubling to 5 min.
 */

import { getKv, mergeKv, peekKv } from './db';
import { practice } from './practice.svelte';
import { settings } from './settings.svelte';
import { HEARD_KEEP_MS, addHeard, heardTopic, parseHeard, type HeardBy } from '../pskreporter/heard';
import { openFeed } from '../pskreporter/mqtt';
import { utcNow } from '../clock/utc';

/** PSK Reporter's MQTT feed over WebSocket and TLS, the port for pages on https. */
export const FEED_URL = 'wss://mqtt.pskreporter.info:1886';
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const KEY = 'heardyou';

export const heardYou = $state<{ on: boolean }>({ on: false });

/** The feed's state and the reports of the last 30 min, newest first. */
export const heard = $state<{ feed: 'off' | 'connecting' | 'live' | 'retrying' | 'refused'; list: HeardBy[] }>({ feed: 'off', list: [] });

let changed = false;

export async function loadHeardYou(): Promise<void> {
  try {
    const peeked = await peekKv<unknown>(KEY);
    const stored = (peeked ? peeked.value : await getKv<unknown>(KEY)) as { on?: unknown } | undefined;
    if (!changed && typeof stored?.on === 'boolean') heardYou.on = stored.on;
  } catch {
    // No storage: off.
  }
}

export async function setHeardYou(on: boolean): Promise<void> {
  changed = true;
  heardYou.on = on;
  try {
    await mergeKv(KEY, { on });
  } catch {
    // As in loadHeardYou.
  }
}

let started = false;

/** At app start: keeps the feed open while it is wanted. */
export function initHeardYou(socket?: (url: string) => WebSocket) {
  if (started) return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      const call = settings.callsign.trim();
      if (!heardYou.on || !call || practice.on) {
        heard.feed = 'off';
        return;
      }
      let stop: (() => void) | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let wait = RETRY_MIN_MS;
      let live = true;
      const connect = () => {
        heard.feed = 'connecting';
        stop = openFeed(
          FEED_URL,
          [heardTopic(call)],
          {
            open: () => {
              heard.feed = 'live';
              wait = RETRY_MIN_MS;
            },
            message: (_topic, payload) => {
              const h = parseHeard(payload);
              if (h) heard.list = addHeard(heard.list, h, utcNow());
            },
            closed: (refused) => {
              stop = null;
              if (!live) return;
              heard.feed = refused ? 'refused' : 'retrying';
              retry = setTimeout(connect, wait);
              wait = Math.min(wait * 2, RETRY_MAX_MS);
            },
          },
          socket,
        );
      };
      connect();
      // Reports age out of the list while the feed is quiet.
      const prune = setInterval(() => {
        const now = utcNow();
        if (heard.list.some((h) => now - h.atS * 1000 >= HEARD_KEEP_MS)) heard.list = heard.list.filter((h) => now - h.atS * 1000 < HEARD_KEEP_MS);
      }, 60_000);
      return () => {
        live = false;
        clearInterval(prune);
        if (retry) clearTimeout(retry);
        stop?.();
        heard.list = [];
      };
    });
  });
}
