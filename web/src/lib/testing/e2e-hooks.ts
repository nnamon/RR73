// Hooks for the Playwright tests, in builds made with VITE_E2E=1 only (the Playwright web server
// sets it; the GitHub Pages build does not). They put the app into states that need a band full
// of stations: decodes arrive as if from the decoder, a QSO goes to the log, and a transmission
// shows as sent. They also read
// the audio clock mapping, for the timing tests.

import { logQso } from '../log/log.svelte';
import type { LogQsoRecord } from '../log/types';
import type { Decode } from '../decode/types';
import { qso } from '../state/qso.svelte';
import { settings } from '../state/settings.svelte';
import { audioOut, deliverDecodes, deliverWspr, noteHeardBack, onAudioChunk } from '../state/station.svelte';
import { isFt } from '../clock/slots';
import type { WsprDecode } from '../wspr/spots';
import { TX_SECONDS } from '../wspr/schedule';
import { wspr } from '../state/wspr.svelte';
import { keyboard, session, tuneMark } from '../state/keyboard.svelte';
import type { ModemEvent } from '../keyboard/modem';

export interface E2eHooks {
  /** Decodes for the slot starting at `slotStartMs`, UTC ms. */
  decoded(slotStartMs: number, decodes: Decode[]): void;
  /** Logs a QSO as the sequencer does, with the Logged notice. */
  logged(record: LogQsoRecord): Promise<void>;
  /** Shows `text` as sent in the slot starting at `slotStartMs`, as the scheduler does once it is on air. */
  sent(slotStartMs: number, text: string): void;
  /** UTC the clock mapping gives the audio clock now, minus Date.now(), ms; null without a mapping. */
  clockErrorMs(): number | null;
  /** UTC stamped on the end of the last captured chunk, minus Date.now() when it arrived, ms. */
  rxLagMs(): number | null;
  /** The messages sent, newest first (the last 20). */
  transmitted(): string[];
  /** Decodes of a slot RR73 transmitted `text` in at `f0Hz`, as if from the decoder. */
  heardBack(slotStartMs: number, text: string, f0Hz: number, decodes: Decode[]): void;
  /** A WSPR slot's decodes, as if from the decoder. */
  wsprDecoded(slotStartMs: number, decodes: WsprDecode[]): void;
  /** Shows the beacon on air with `text` in the slot starting at `slotStartMs`, or nothing on air with null. No audio plays. */
  wsprOnAir(slotStartMs: number, text: string | null): void;
  /** Shows `text` as sent by the beacon in the slot starting at `slotStartMs`. */
  wsprSent(slotStartMs: number, text: string): void;
  /** The beacon now: on air (UTC ms), the next Tx slot, and the slots with spots. */
  wsprState(): { onAir: { text: string; slotStartMs: number; startMs: number } | null; next: number | null; on: boolean; slots: { startUtcMs: number; spots: number; ms: number }[] };
  /** Received RTTY text, as if from the receiver; characters in `uncertain` print as uncertain. */
  rttyReceived(text: string, uncertain?: string): void;
  /** Text added to the RTTY pane as it is, one kind per character: r received, u uncertain, t sent. */
  rttyText(text: string, kinds: string): void;
  /** Shows Operate as with the keyboard up (the review build cannot open the iOS keyboard). */
  rttyKeyboardUp(up: boolean | null): void;
  /** Stops capture reaching the RTTY receiver, so only the text added through rttyText prints. */
  rttyDeaf(): void;
  /** The RTTY receiver's signal report, dB in 3000 Hz. */
  rttySignal(snrDb: number, squelchOpen: boolean): void;
  /** Moves the RTTY pair to a mark tone, Hz. */
  rttyTune(markHz: number): void;
  /** The keyboard session now, and the last transmission's underruns and frames. */
  rttyState(): { tx: string; field: string; call: string; fields: Record<string, string>; lastTx: { underrunFrames: number; playedFrames: number } | null; notice: string | null };
}

declare global {
  interface Window {
    __rr73?: E2eHooks;
  }
}

export function installE2eHooks() {
  let rxLag: number | null = null;
  onAudioChunk((c) => {
    rxLag = c.utcMs + (c.samples.length / 12000) * 1000 - Date.now();
  });
  window.__rr73 = {
    decoded: (slotStartMs, decodes) => deliverDecodes({ startUtcMs: slotStartMs, mode: isFt(settings.mode) ? settings.mode : 'FT8', decodes, ms: 40 }),
    logged: async (record) => {
      await logQso(record);
    },
    sent: (slotStartMs, text) => {
      qso.sent = [{ slotStartMs, text, freqHz: settings.txHz }, ...qso.sent];
    },
    clockErrorMs: () => {
      const out = audioOut();
      return out ? out.mapper.toUtcMs(out.ctx.currentTime) - Date.now() : null;
    },
    rxLagMs: () => rxLag,
    transmitted: () => qso.sent.map((s) => s.text),
    heardBack: (slotStartMs, text, f0Hz, decodes) => noteHeardBack(slotStartMs, { text, f0Hz }, decodes),
    wsprDecoded: (slotStartMs, decodes) => deliverWspr({ startUtcMs: slotStartMs, decodes, ms: 400 }),
    wsprOnAir: (slotStartMs, text) => {
      const start = slotStartMs + 1000;
      wspr.onAir = text === null ? null : { text, slotStartMs, startMs: start, endMs: start + TX_SECONDS * 1000 };
    },
    wsprSent: (slotStartMs, text) => {
      wspr.sent = [{ slotStartMs, text, freqHz: settings.wspr.txHz, complete: true }, ...wspr.sent];
    },
    rttyReceived: (text, uncertain = '') => {
      const events: ModemEvent[] = [...text].map((ch) => ({ type: 'char', ch, snrDb: -6, quality: uncertain.includes(ch) ? 0.2 : 0.95, framingError: false }));
      session.receive(events);
    },
    rttyText: (text, kinds) => session.addText(text, kinds),
    rttyKeyboardUp: (up) => {
      keyboard.forceKeyboard = up;
      keyboard.keyboardUp = up ?? false;
    },
    rttyDeaf: () => {
      keyboard.listening = false;
    },
    rttySignal: (snrDb, squelchOpen) => session.receive([{ type: 'signal', snrDb, squelchOpen }]),
    rttyTune: (markHz) => tuneMark(markHz),
    rttyState: () => ({
      tx: session.tx,
      field: session.field,
      call: session.draft.fields.call,
      fields: { ...session.draft.fields },
      lastTx: keyboard.lastTx,
      notice: session.notice?.text ?? null,
    }),
    wsprState: () => ({
      onAir: wspr.onAir && { text: wspr.onAir.text, slotStartMs: wspr.onAir.slotStartMs, startMs: wspr.onAir.startMs },
      next: wspr.next?.slotStartMs ?? null,
      on: wspr.beacon.on,
      slots: wspr.slots.map((s) => ({ startUtcMs: s.startUtcMs, spots: s.spots.length, ms: s.ms })),
    }),
  };
}
