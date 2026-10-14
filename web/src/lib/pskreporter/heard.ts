// Who heard you, from PSK Reporter's MQTT feed (https://www.mqtt.pskreporter.info, read 15
// October 2026). Topics are pskr/filter/v2/{band}/{mode}/{tx}/{rx}/{tx_grid}/{rx_grid}/{tx_dxcc}/
// {rx_dxcc}; a callsign's "/" is "." in a topic (seen in the feed: AI4UC/T as AI4UC.T). Each
// message is one spot as JSON.

/** One report of the operator heard by a receiving station. */
export interface HeardBy {
  /** The receiving station. */
  receiver: string;
  /** Its locator, as it reported it; '' when absent. */
  locator: string;
  /** "20m". */
  band: string;
  mode: string;
  /** SNR the receiver reported, dB; null when it sent none (the feed carries "rp": null). */
  snrDb: number | null;
  frequencyHz: number;
  /** When the transmission started, s since 1970: t_tx when the feed gives it, else t. */
  atS: number;
}

/** The topic for every report of `callsign` as the sender. */
export function heardTopic(callsign: string): string {
  return `pskr/filter/v2/+/+/${callsign.trim().toUpperCase().replace(/\//g, '.')}/#`;
}

const dec = new TextDecoder();

/** Reads one feed message; null when it is not a spot. */
export function parseHeard(payload: Uint8Array): HeardBy | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(dec.decode(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  const n = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : null);
  const receiver = s('rc');
  const at = n('t_tx') ?? n('t');
  if (!receiver || at === null) return null;
  return {
    receiver,
    locator: s('rl') ?? '',
    band: s('b') ?? '',
    mode: s('md') ?? '',
    snrDb: n('rp'),
    frequencyHz: n('f') ?? 0,
    atS: at,
  };
}

/** How long a report stays, ms. */
export const HEARD_KEEP_MS = 30 * 60_000;

/**
 * The reports of the last 30 min, newest first, one per receiver and band: a station that heard
 * you again replaces its earlier report.
 */
export function addHeard(list: readonly HeardBy[], h: HeardBy, nowMs: number): HeardBy[] {
  const fresh = list.filter((x) => nowMs - x.atS * 1000 < HEARD_KEEP_MS && !(x.receiver === h.receiver && x.band === h.band));
  if (nowMs - h.atS * 1000 >= HEARD_KEEP_MS) return fresh;
  return [h, ...fresh].sort((a, b) => b.atS - a.atS);
}
