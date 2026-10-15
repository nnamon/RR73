/**
 * The keyboard runtime: wires one KeyboardSession (lib/keyboard/session.svelte.ts) to the station
 * while a keyboard mode (RTTY) is in use. Capture chunks go to the keyboard worker and its
 * events to the session; transmissions go through the stream worklet on the capture engine's
 * AudioContext. Halt, audio stopping, the page hiding and a change of mode stop a transmission
 * at once and keep the text typed ahead; a change of band ends it and adds a divider to the text.
 */

import { untrack } from 'svelte';
import { playClip, silentClipUri } from '../audio/unlock';
import { isKeyboard } from '../clock/slots';
import { slotStem } from '../clock/format';
import { KeyboardClient, type KeyboardStatus } from '../keyboard/client';
import { KeyboardSession, type SessionConfig } from '../keyboard/session.svelte';
import { logQso } from '../log/log.svelte';
import { STATUS } from '../qso/status';
import { rttyDialHz, dial4 } from '../rtty/dial';
import { charSeconds, clampMark, presetLabel, spaceHz, type RttySettings } from '../rtty/settings';
import { saveSlot, type SaveResult } from '../slots/share';
import { encodeWav16 } from '../slots/wav';
import { features } from './features.svelte';
import { log } from '../log/log.svelte';
import { txLevel } from './practice.svelte';
import { settings, updateSettings } from './settings.svelte';
import { dialNow, onRadioNotice, rigGate, txKeyer } from './radio.svelte';
import { onAudioChunk, onAudioStatus, onHalt, outputContext } from './station.svelte';
import { PTT_SETTLE_MS, keyFailedText, pause, tailMs, type Keying } from '../tx/keyer';

/** Audio kept for Save 2 min of audio, s at 12 kHz. */
const KEEP_S = 120;
/** A tap on the waterfall searches this far either side, Hz. */
export const FIND_RANGE_HZ = 100;

export const client = new KeyboardClient();

/** What the runtime shows besides the session: the worker's state and the pair now. */
export const keyboard = $state({
  status: { state: 'idle' } as KeyboardStatus,
  /** The worker holds a modem: it receives and encodes. False until the first configure is done. */
  modemReady: false,
  /** The receiver's mark now, Hz: AFC and taps move it. */
  markHz: 1585,
  /** The keyboard is up (visualViewport shorter than the window): Operate shrinks the waterfall. */
  keyboardUp: false,
  /** Transmissions recorded as they left the stream node, review build only. */
  record: false,
  lastRecording: null as Float32Array | null,
  lastRecordingRate: 0,
  /** Underruns and frames of the last transmission. */
  lastTx: null as { underrunFrames: number; playedFrames: number } | null,
  /** Capture goes to the receiver; the review build turns it off to show only the text it adds. */
  listening: true,
  /** The review build's keyboard: up or down whatever the viewport says; null follows the viewport. */
  forceKeyboard: null as boolean | null,
});

function station(): { call: string; grid: string } {
  const a = features.activations ? log.current : null;
  return { call: a?.callsign || settings.callsign, grid: a?.grid || settings.grid };
}

/** The dial in RTTY on the current band, Hz: the radio's while rig control reads it. */
export function currentDialHz(): number {
  return dialNow(rttyDialHz(settings.band, settings.rtty.dialHz)) ?? 0;
}

function config(): SessionConfig {
  const r = settings.rtty;
  const k = settings.keyboard;
  const s = station();
  return {
    charS: charSeconds(r),
    upperCaseOnly: true,
    newLineFirst: r.newLineFirst,
    idleStopS: r.idleStopS,
    watchdogMin: r.watchdogMin,
    repeatGapS: r.repeatGapS,
    macros: k.macros[k.set],
    set: k.set,
    myCall: s.call,
    myName: settings.myName,
    myQth: settings.myQth,
    myGrid: s.grid,
    exchange: k.exchange,
    nextSerial: k.nextSerial,
    serialDigits: k.serialDigits,
    contestId: k.contestId,
    mode: 'RTTY',
    band: settings.band,
    dialHz: currentDialHz(),
    markHz: Math.round(keyboard.markHz),
  };
}

export const session = new KeyboardSession({
  now: () => Date.now(),
  config,
  async startTx(cb) {
    const ctx = outputContext();
    if (!ctx) return STATUS.audioOff;
    const why = rigGate();
    if (why) return why;
    // With rig control keying the radio: PTT on, the radio's OK, then the stream 0.1 s later. A
    // stream has no set length, so PTT is held until it drains, and the output's latency and 0.1 s
    // after, or until it stops (docs/design/cat.md).
    const keyer = txKeyer();
    let keying: Keying | null = null;
    if (keyer) {
      keying = keyer.key(Infinity);
      const answer = await keying.result;
      if (answer !== 'ok') {
        keying.release();
        return keyFailedText(answer);
      }
      await pause(PTT_SETTLE_MS);
      // Halt, or a fault, took PTT back during the wait: the stream never starts.
      if (!keying.held) {
        keying.release();
        return STATUS.pttTaken;
      }
    }
    try {
      const stream = await client.startTx(
        ctx,
        txLevel(settings.outputLevel),
        {
          started: cb.started,
          drained: (underrunFrames, playedFrames) => {
            keyboard.lastTx = { underrunFrames, playedFrames };
            client.reset();
            keying?.release(tailMs(ctx));
            cb.drained();
          },
          recording: (samples) => {
            keyboard.lastRecording = samples;
            keyboard.lastRecordingRate = ctx.sampleRate;
          },
        },
        keyboard.record,
      );
      if (!keying) return stream;
      const k = keying;
      return {
        ...stream,
        stop: () => {
          stream.stop();
          k.release();
        },
      };
    } catch {
      keying?.release();
      return STATUS.encode;
    }
  },
  async log(r) {
    try {
      await logQso(r);
      return true;
    } catch {
      return false;
    }
  },
  stepSerial() {
    const k = settings.keyboard;
    void updateSettings({ keyboard: { ...k, nextSerial: Math.min(9999, k.nextSerial + 1) } });
  },
});

client.onStatus((s) => (keyboard.status = s));
// The character tables come back once the worker has built the modem.
client.onTables((t) => {
  session.tables = t;
  keyboard.modemReady = true;
});
client.onTx((r) => session.txReport(r.queuedS));
client.onEvents((events) => {
  for (const e of events) {
    if (e.type === 'tones' && e.hz.length) keyboard.markHz = e.hz[0];
    else if (e.type === 'shift' && e.hz !== settings.rtty.shiftHz) {
      session.notice = { text: STATUS.shiftFound(Math.round(e.hz)), atMs: Date.now() };
      void updateSettings({ rtty: { ...settings.rtty, shiftHz: Math.round(e.hz), markHz: keyboard.markHz } });
    }
  }
  session.receive(events);
});

// ---- Receive audio: to the worker, and the last 2 minutes for Save 2 min of audio ----

const ring = new Float32Array(KEEP_S * 12000);
let ringAt = 0;
let ringFilled = 0;
let ringEndMs = 0;

function keep(samples: Float32Array, endMs: number) {
  for (let i = 0; i < samples.length; ) {
    const n = Math.min(samples.length - i, ring.length - ringAt);
    ring.set(samples.subarray(i, i + n), ringAt);
    ringAt = (ringAt + n) % ring.length;
    i += n;
  }
  ringFilled = Math.min(ring.length, ringFilled + samples.length);
  ringEndMs = endMs;
}

/** True when there is received audio to save. */
export function hasAudio(): boolean {
  return ringFilled > 0;
}

/** Saves the last 2 minutes of received audio as a 12 kHz WAV with a JSON sidecar. Call from the tap. */
export function saveAudio(): Promise<SaveResult> | null {
  if (!ringFilled) return null;
  const out = new Float32Array(ringFilled);
  const start = (ringAt - ringFilled + ring.length) % ring.length;
  for (let i = 0; i < ringFilled; i++) out[i] = ring[(start + i) % ring.length];
  const startMs = ringEndMs - (ringFilled / 12000) * 1000;
  const r = settings.rtty;
  const json = {
    mode: 'RTTY',
    band: settings.band,
    dial_hz: currentDialHz(),
    mark_hz: Math.round(keyboard.markHz),
    space_hz: Math.round(spaceHz(r, keyboard.markHz)),
    baud: r.baud,
    shift_hz: r.shiftHz,
    reverse: r.reverse,
    start_utc: new Date(startMs).toISOString(),
    seconds: ringFilled / 12000,
    sample_rate_hz: 12000,
    app_version: `${__APP_VERSION__} (${__APP_BUILD__})`,
  };
  return saveSlot({ stem: `rtty_${slotStem(startMs)}`, wav: encodeWav16(out, 12000), json: `${JSON.stringify(json, null, 2)}\n` });
}

// ---- Operator actions on the pair and the modem ----

/** Moves the pair so its mark is at `markHz` (a drag on the waterfall, keeping the shift). */
export function tuneMark(markHz: number) {
  const m = clampMark(settings.rtty, markHz);
  keyboard.markHz = m;
  client.tune(m);
}

/** A tap on the waterfall at `hz`: the pair moves to the strongest signal within 100 Hz, or to the tap. */
export function tapToTune(hz: number) {
  const r = settings.rtty;
  const mark = clampMark(r, r.reverse ? hz - r.shiftHz / 2 : hz + r.shiftHz / 2);
  tuneMark(mark);
  client.find(hz, FIND_RANGE_HZ);
  session.notice = { text: STATUS.tuned(mark), atMs: Date.now() };
  settle();
}

/** Stores the pair once a tap or a drag has ended, so a reload starts on it. */
export function settle() {
  setTimeout(() => {
    if (Math.round(keyboard.markHz) !== settings.rtty.markHz) void updateSettings({ rtty: { ...settings.rtty, markHz: Math.round(keyboard.markHz) } });
  }, 1500);
}

export function setRtty(patch: Partial<RttySettings>, notice?: string) {
  void updateSettings({ rtty: { ...settings.rtty, markHz: Math.round(keyboard.markHz), ...patch } });
  if (notice) session.notice = { text: notice, atMs: Date.now() };
}

/** Rev: the pair stays over the same signal, so the mark moves to the other tone. */
export function setReverse(on: boolean) {
  const r = settings.rtty;
  const centre = (keyboard.markHz + spaceHz(r, keyboard.markHz)) / 2;
  const mark = on ? centre - r.shiftHz / 2 : centre + r.shiftHz / 2;
  keyboard.markHz = mark;
  setRtty({ reverse: on, markHz: Math.round(mark) }, STATUS.reverse(on));
}

export function setPreset(baud: number, shiftHz: number) {
  setRtty({ baud, shiftHz }, STATUS.speedShift(baud, shiftHz));
}

export function setSquelch(db: number | null) {
  setRtty({ squelchDb: db }, STATUS.squelch(db === null ? 'off' : `${db < 0 ? '−' : ''}${Math.abs(db)} dB`));
}

export function setAfc(on: boolean) {
  setRtty({ afc: on }, STATUS.afc(on));
}

/** ••• › Macros: steps between the QSO set and the Contest set. */
export function stepMacroSet() {
  const k = settings.keyboard;
  const set = k.set === 'qso' ? 'contest' : 'qso';
  void updateSettings({ keyboard: { ...k, set } });
  session.notice = { text: STATUS.macroSet(set === 'qso' ? 'QSO' : 'Contest'), atMs: Date.now() };
}

/** The speed and shift chip: "45.45 · 170". */
export function presetText(): string {
  return presetLabel(settings.rtty.baud, settings.rtty.shiftHz);
}

/** The mark frequency on the air, Hz: dial plus mark tone (USB). */
export function markRfHz(): number {
  return currentDialHz() + keyboard.markHz;
}

/** Turns iOS output on inside a tap, as for FT8 and WSPR. */
export function unmute() {
  playClip(silentClipUri());
}

// ---- Wiring ----

let started = false;

/** Wires the runtime to the station. Idempotent; runs on the first keyboard mode. */
export function startKeyboard() {
  if (started || typeof window === 'undefined') return;
  started = true;
  keyboard.markHz = settings.rtty.markHz;
  onAudioChunk((c) => {
    if (!isKeyboard(settings.mode)) return;
    keep(c.samples, c.utcMs + (c.samples.length / 12000) * 1000);
    // The radio's own transmission is no copy: the receiver hears nothing while on air.
    if (session.tx === 'off' && keyboard.listening) client.push(c.samples);
  });
  onHalt(() => session.halt());
  // The radio's port lost ends a transmission, as audio stopping does; Tune refused says why.
  onRadioNotice((text, txOff, always) => {
    if (!isKeyboard(settings.mode)) return;
    const on = session.tx !== 'off';
    if (txOff && on) session.halt();
    if (on || !txOff || always) session.notice = { text, atMs: Date.now() };
  });
  onAudioStatus((s) => {
    if ((s === 'stopped' || s === 'failed') && session.tx !== 'off') {
      session.halt();
      session.notice = { text: STATUS.audioStopped, atMs: Date.now() };
    }
  });
  setInterval(() => {
    if (isKeyboard(settings.mode) || session.tx !== 'off' || session.repeat.on) session.tick();
  }, 1000);
  watchViewport();
  $effect.root(() => {
    // The receiver follows the settings that shape it, rebuilt at the pair's mark when one
    // changes. AFC and the pair itself move without a rebuild.
    let shaped = '';
    $effect(() => {
      if (!isKeyboard(settings.mode)) {
        shaped = '';
        return;
      }
      const r = settings.rtty;
      // A write of other RTTY settings (the pair, a dial) replaces the object: only a change in
      // these values rebuilds the receiver, which loses the character it is reading.
      const key = JSON.stringify([r.baud, r.shiftHz, r.stopBits, r.reverse, r.figures, r.usos, r.squelchDb, r.preambleS, r.tailChars, r.idle]);
      if (key === shaped) return;
      shaped = key;
      untrack(() => {
        const snap = $state.snapshot(settings.rtty) as RttySettings;
        keyboard.markHz = clampMark(snap, keyboard.markHz);
        client.configure('RTTY', { ...snap, markHz: keyboard.markHz });
      });
    });
    $effect(() => {
      const on = settings.rtty.afc;
      if (isKeyboard(settings.mode)) untrack(() => client.afc(on));
    });
    // A change of mode ends a transmission; a change of band ends it too and marks the text.
    let mode = settings.mode;
    let band = settings.band;
    $effect(() => {
      const m = settings.mode;
      const b = settings.band;
      untrack(() => {
        if (m !== mode && isKeyboard(mode)) session.halt();
        if (b !== band && isKeyboard(m)) {
          session.halt();
          session.divider(`${b} · ${dial4(rttyDialHz(b, settings.rtty.dialHz) ?? 0)}`);
        }
        mode = m;
        band = b;
      });
    });
  });
}

/** Tracks the on-screen keyboard: iOS overlays it on a home-screen app and shrinks only the visual viewport. */
function watchViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inPane = document.activeElement instanceof HTMLElement && !!document.activeElement.closest('[data-keyboard-pane]');
    const up = keyboard.forceKeyboard ?? (inPane && window.innerHeight - vv.height > 120);
    keyboard.keyboardUp = up;
    if (up) document.documentElement.style.setProperty('--rr-app-h', `${Math.round(vv.height)}px`);
    else document.documentElement.style.removeProperty('--rr-app-h');
  };
  vv.addEventListener('resize', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 0));
  update();
}

/** Forgets the session's state; tests use it to start again. */
export function resetKeyboard() {
  session.halt();
  session.clearText();
  session.clearField();
  session.clearDraft();
}

