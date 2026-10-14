// What RR73 reports to PSK Reporter from a slot's decodes (docs/design/qsp.md, PSK Reporter):
// the sending station of each message, once per slot, with its locator when the message carries
// one. Hashed callsigns (<...>) are left out: the decoder has not heard them in full.

import type { FtMode } from '../clock/slots';
import type { Decode } from '../decode/types';
import { parseParts } from '../qso/messages';

/** One station heard, as QSP takes it. */
export interface PskSpot {
  /** The sender's callsign, upper case. */
  callsign: string;
  /** The sender's 4-character grid; '' when its messages carried none. */
  locator: string;
  /** RF frequency: dial plus audio, Hz. */
  frequencyHz: number;
  /** SNR in 2500 Hz, dB. */
  snrDb: number;
  mode: FtMode;
  /** The slot's start, s since 1970. */
  time: number;
}

/** The senders in one slot's decodes, each once, at `dialHz` in `mode`. */
export function spotsOf(decodes: readonly Decode[], slotStartMs: number, dialHz: number, mode: FtMode): PskSpot[] {
  const out = new Map<string, PskSpot>();
  for (const d of decodes) {
    for (const part of parseParts(d.text)) {
      const call = part.from;
      if (!call || call.includes('<')) continue;
      const locator = part.grid ?? '';
      const seen = out.get(call);
      if (seen) {
        if (!seen.locator && locator) seen.locator = locator;
        continue;
      }
      out.set(call, {
        callsign: call,
        locator,
        frequencyHz: Math.round(dialHz + d.freq_hz),
        snrDb: Math.round(d.snr_db),
        mode,
        time: Math.floor(slotStartMs / 1000),
      });
    }
  }
  return [...out.values()];
}
